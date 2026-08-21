/* telegram-cron — Worker agendado do Cloudflare.
   Manda o lucro do dia (total e por produto) + alertas de variação pro
   Telegram MESMO COM O APP FECHADO. Lê o Supabase (tabelas diary/products,
   as mesmas que o app sincroniza) e usa o KV compartilhado pra guardar
   snapshots intradiários e comparar leituras.

   Espelha o mesmo cálculo de lucro do app (js/diary.js getEntryProfit):
     lucroUSD = receitaUSD - custoUSD*vendas - receita*imposto% - receita*custosVar% - gastoUSD

   Config (wrangler.toml [vars]):
     SUPABASE_URL, TZ (ex.: America/Sao_Paulo), SUMMARY_HOURS ("9,12,15,18,21"),
     QUIET_START/QUIET_END ("23"/"7"), USER_ID (opcional, filtra por usuário)
   Secrets (wrangler secret put):
     TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_KEY (service_role se houver RLS)
   Bindings:
     SHOPIFY_TOKENS (KV) — reaproveitado pra estado; opcional (degrada sem ele).
*/

const DEFAULT_RATES = { BRL: 5.2, GBP: 0.79, EUR: 0.92, USD: 1 };
const THR = { dropAbs: 100, dropPct: 15, marginDropPp: 5, marginMin: 15, spendNoSaleAbs: 80, cooldownMin: 90 };

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env).catch((e) => console.error('telegram-cron erro:', e && e.message)));
  },
  // Endpoint manual pra testar: GET ...worker.dev/?run=1
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.searchParams.get('run') === '1') {
      try { const r = await run(env, { force: url.searchParams.get('force') === '1' }); return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } }); }
      catch (e) { return new Response('erro: ' + (e && e.message), { status: 500 }); }
    }
    return new Response('telegram-cron vivo');
  },
};

async function run(env, opts = {}) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return { skip: 'sem TELEGRAM_BOT_TOKEN/CHAT_ID' };
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return { skip: 'sem SUPABASE_URL/KEY' };

  const tz = env.TZ || 'America/Sao_Paulo';
  const day = dateInTz(tz);
  const hour = Number(hourInTz(tz));
  const hhmm = hhmmInTz(tz);
  const quiet = inQuiet(env, hour);

  const rates = await fetchRates();
  const data = await computeByProduct(env, day, rates);

  // snapshots + alertas
  const snaps = await kvGet(env, `telegram:snap:${day}`, []);
  const alerts = analyze(env, data, snaps);
  const now = Date.now();
  snaps.push(snapshotFrom(data, hhmm, now));
  while (snaps.length > 96) snaps.shift();
  await kvPut(env, `telegram:snap:${day}`, snaps, 60 * 60 * 48);

  let sent = [];
  const summaryHours = (env.SUMMARY_HOURS || '9,12,15,18,21').split(',').map((s) => parseInt(s, 10));
  const isSummaryHour = summaryHours.includes(hour);

  if (opts.force || (isSummaryHour && !quiet && data.products.length)) {
    const st = await kvGet(env, `telegram:sent:${day}`, {});
    if (opts.force || !st[hour]) {
      await sendTelegram(env, buildDaily(day, data, snaps.slice(0, -1), hhmm));
      st[hour] = true; await kvPut(env, `telegram:sent:${day}`, st, 60 * 60 * 48);
      sent.push('resumo');
    }
  }
  if ((opts.force || !quiet) && alerts.length) {
    await sendTelegram(env, `🚨 <b>Alertas de variação</b> — ${dmy(day)} ${hhmm}\n\n` + alerts.join('\n'));
    sent.push(`${alerts.length} alerta(s)`);
  }
  return { day, hhmm, produtos: data.products.length, sent };
}

// ── Supabase → lucro por produto (em BRL) ─────────────────────────────
async function computeByProduct(env, day, rates) {
  const userFilter = env.USER_ID ? `&user_id=eq.${encodeURIComponent(env.USER_ID)}` : '';
  const diary = await sb(env, `diary?date=eq.${day}${userFilter}&select=id,date,product_id,budget,budget_currency,sales,revenue,revenue_currency,is_campaign`);
  const prods = await sb(env, `products?${env.USER_ID ? `user_id=eq.${encodeURIComponent(env.USER_ID)}&` : ''}select=id,name,cost,cost_currency,tax,variable_costs`);
  const pmap = new Map(prods.map((p) => [p.id, p]));

  // dedup por date|product_id, ignora sub-entradas de campanha
  const seen = new Map();
  diary.forEach((e) => { if (e && !e.is_campaign) seen.set(`${e.date}|${e.product_id}`, e); });

  const byPid = new Map();
  for (const e of seen.values()) {
    const p = pmap.get(e.product_id);
    const revenueUSD = toUSD(e.revenue, e.revenue_currency, rates);
    const budgetUSD = toUSD(e.budget, e.budget_currency, rates);
    let profitUSD;
    if (p) {
      const costUSD = toUSD(p.cost, p.cost_currency, rates);
      profitUSD = revenueUSD - costUSD * (e.sales || 0) - revenueUSD * ((p.tax || 0) / 100) - revenueUSD * ((p.variable_costs || 0) / 100) - budgetUSD;
    } else {
      profitUSD = revenueUSD - budgetUSD;
    }
    const pid = e.product_id || '—';
    const acc = byPid.get(pid) || { productId: pid, name: (p && p.name) || (pid === '__STORE__' ? 'Loja' : 'Sem produto'), profitUSD: 0, revenueUSD: 0, spendUSD: 0, sales: 0 };
    acc.profitUSD += profitUSD; acc.revenueUSD += revenueUSD; acc.spendUSD += budgetUSD; acc.sales += e.sales || 0;
    byPid.set(pid, acc);
  }

  const products = [...byPid.values()].map((a) => {
    const revenueBRL = a.revenueUSD * rates.BRL, profitBRL = a.profitUSD * rates.BRL, spendBRL = a.spendUSD * rates.BRL;
    return { productId: a.productId, name: a.name, sales: a.sales, profitBRL, revenueBRL, spendBRL, marginPct: revenueBRL > 0 ? (profitBRL / revenueBRL) * 100 : 0, roas: spendBRL > 0 ? revenueBRL / spendBRL : 0 };
  }).sort((x, y) => y.profitBRL - x.profitBRL);

  const total = products.reduce((t, p) => { t.profitBRL += p.profitBRL; t.revenueBRL += p.revenueBRL; t.spendBRL += p.spendBRL; t.sales += p.sales; return t; }, { profitBRL: 0, revenueBRL: 0, spendBRL: 0, sales: 0 });
  total.marginPct = total.revenueBRL > 0 ? (total.profitBRL / total.revenueBRL) * 100 : 0;
  total.roas = total.spendBRL > 0 ? total.revenueBRL / total.spendBRL : 0;
  return { total, products };
}

// ── Motor de variação (espelha o cliente) ─────────────────────────────
function analyze(env, data, snaps) {
  const prev = snaps.length ? snaps[snaps.length - 1] : null;
  const alerts = [];
  data.products.forEach((p) => {
    const pv = prev && prev.products[p.productId];
    const label = `<b>${esc(p.name)}</b>`;
    if (p.profitBRL < 0 && (!pv || pv.profitBRL >= 0)) alerts.push(`🔴 ${label} entrou no <b>prejuízo</b>: ${brl(p.profitBRL)} (${pct(p.marginPct)}) • gasto ${brl(p.spendBRL)} • ${p.sales} venda(s)`);
    if (pv) {
      const d = p.profitBRL - pv.profitBRL;
      const dropPct = pv.profitBRL > 0 ? (-d / pv.profitBRL) * 100 : 0;
      if (d < 0 && (Math.abs(d) >= THR.dropAbs || dropPct >= THR.dropPct)) alerts.push(`📉 ${label} — lucro caiu de ${brl(pv.profitBRL)} (${pct(pv.marginPct)}) às ${pv.t} → ${brl(p.profitBRL)} (${pct(p.marginPct)}) agora\n   Δ ${sbrl(d)} / ${spp(p.marginPct - pv.marginPct)}`);
      else if (p.marginPct - pv.marginPct <= -THR.marginDropPp) alerts.push(`⚠️ ${label} — margem caiu ${spp(p.marginPct - pv.marginPct)} (${pct(pv.marginPct)} → ${pct(p.marginPct)}) desde ${pv.t}`);
    }
    if (p.revenueBRL > 0 && p.marginPct < THR.marginMin && p.profitBRL >= 0) alerts.push(`🟠 ${label} — margem baixa: ${pct(p.marginPct)} (mín. ${THR.marginMin}%) • lucro ${brl(p.profitBRL)}`);
    if (p.sales === 0 && p.spendBRL >= THR.spendNoSaleAbs) alerts.push(`🟠 ${label} — ${brl(p.spendBRL)} gastos e <b>0 vendas</b> hoje`);
  });
  return alerts;
}
function snapshotFrom(data, t, ts) {
  const products = {};
  data.products.forEach((p) => { products[p.productId] = { name: p.name, profitBRL: p.profitBRL, marginPct: p.marginPct, revenueBRL: p.revenueBRL, spendBRL: p.spendBRL, sales: p.sales }; });
  return { t, ts, total: data.total, products };
}
function buildDaily(day, data, snaps, hhmm) {
  const t = data.total;
  const prev = snaps.length ? snaps[snaps.length - 1] : null;
  let head = `📊 <b>Lucro de hoje</b> (${dmy(day)}) — ${hhmm}\nTotal: <b>${brl(t.profitBRL)}</b> (${pct(t.marginPct)}) • Fat. ${brl(t.revenueBRL)} • Gasto ${brl(t.spendBRL)} • ROAS ${t.roas.toFixed(2).replace('.', ',')} • ${t.sales} venda(s)`;
  if (prev) { const d = t.profitBRL - prev.total.profitBRL; const a = d > 0.005 ? '🔺' : d < -0.005 ? '🔻' : '▪️'; head += `\nvs ${prev.t}: ${a} ${sbrl(d)} (${spp(t.marginPct - prev.total.marginPct)})`; }
  const first = snaps.length ? snaps[0] : null;
  const lines = data.products.slice(0, 15).map((p) => {
    const fv = first && first.products[p.productId]; let delta = '';
    if (fv) { const d = p.profitBRL - fv.profitBRL; const a = d > 0.005 ? '🔺' : d < -0.005 ? '🔻' : '▪️'; if (Math.abs(d) >= 0.01) delta = `  ${a} ${sbrl(d)} desde ${first.t}`; }
    return `• ${esc(p.name)}: <b>${brl(p.profitBRL)}</b> (${pct(p.marginPct)})${delta}`;
  });
  return head + (lines.length ? `\n\n<b>Por produto</b>\n` + lines.join('\n') : '');
}

// ── Helpers ───────────────────────────────────────────────────────────
async function sb(env, path) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` } });
  if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  return (await resp.json().catch(() => [])) || [];
}
async function fetchRates() {
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD');
    const j = await r.json();
    if (j && j.rates) return { USD: 1, BRL: j.rates.BRL || DEFAULT_RATES.BRL, GBP: j.rates.GBP || DEFAULT_RATES.GBP, EUR: j.rates.EUR || DEFAULT_RATES.EUR };
  } catch {}
  return { ...DEFAULT_RATES };
}
function toUSD(v, cur, rates) { v = Number(v || 0); if (!cur || cur === 'USD') return v; const r = rates[cur]; return r ? v / r : v; }
async function sendTelegram(env, text) {
  for (const chunk of split(text, 4096)) {
    const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: chunk, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const d = await resp.json().catch(() => ({}));
    if (!resp.ok || d.ok === false) throw new Error(d.description || `Telegram ${resp.status}`);
  }
}
async function kvGet(env, key, fb) { try { if (!env.SHOPIFY_TOKENS) return fb; const v = await env.SHOPIFY_TOKENS.get(key); return v ? JSON.parse(v) : fb; } catch { return fb; } }
async function kvPut(env, key, val, ttl) { try { if (env.SHOPIFY_TOKENS) await env.SHOPIFY_TOKENS.put(key, JSON.stringify(val), ttl ? { expirationTtl: ttl } : undefined); } catch {} }

function dateInTz(tz) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function hourInTz(tz) { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()).replace(/\D/g, ''); }
function hhmmInTz(tz) { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
function inQuiet(env, hour) { const s = env.QUIET_START != null && env.QUIET_START !== '' ? Number(env.QUIET_START) : null; const e = env.QUIET_END != null && env.QUIET_END !== '' ? Number(env.QUIET_END) : null; if (s == null || e == null) return false; return s < e ? hour >= s && hour < e : hour >= s || hour < e; }

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function brl(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pct(v) { return Number(v || 0).toFixed(1).replace('.', ',') + '%'; }
function sbrl(v) { return (v >= 0 ? '+' : '−') + brl(Math.abs(v)); }
function spp(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + ' p.p.'; }
function dmy(iso) { const [y, m, d] = String(iso || '').split('-'); return d && m ? `${d}/${m}` : iso; }
function split(text, max) { if (text.length <= max) return [text]; const out = []; let cur = ''; for (const line of text.split('\n')) { if ((cur + line + '\n').length > max) { if (cur) out.push(cur); cur = ''; } cur += line + '\n'; } if (cur) out.push(cur); return out; }
