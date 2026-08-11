/* ===========================
   Store Goal — Meta de LUCRO da loja no mês, multi-produto.

   Duas camadas, deliberadamente separadas:

   1) REALIZADO — nível da LOJA, sem quebra por país.
      O gasto de ads no diário é por produto/dia e NÃO carrega país. Ratear
      esse gasto entre países produziria um lucro que parece exato e não é.
      Por isso o realizado nunca é filtrado por país.

   2) PLANEJAMENTO POR PAÍS — projeção pura (ticket, custo, imposto).
      Break-even e CPA-alvo saem de aritmética do produto, sem depender de
      atribuição de gasto. É onde o corte por país é legítimo.
   =========================== */

const StoreGoalModule = (() => {

    const STORAGE_KEY = 'etracker_store_goals';

    const _state = {
        goals: [],
        selectedId: '',
        breakdown: 'dia',      // dia | semana | mes
        // Overrides de ticket por país que o usuário digita na tabela de plano.
        // Vivem por meta, não no produto — simular não pode alterar cadastro.
        ticketOverrides: {},
        _cache: { key: '', dados: null },
        carregando: false,
    };

    // ══════════════════════════════════════════════════════════════
    //  Persistência
    // ══════════════════════════════════════════════════════════════

    function _load() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            _state.goals = Array.isArray(raw.goals) ? raw.goals : [];
            _state.ticketOverrides = raw.ticketOverrides || {};
        } catch (e) { console.warn('[MetaLoja] load falhou:', e); }
    }

    function _save() {
        const gravar = () => localStorage.setItem(STORAGE_KEY,
            JSON.stringify({ goals: _state.goals, ticketOverrides: _state.ticketOverrides }));
        try {
            if (window.StorageManager?.withReclaim) StorageManager.withReclaim(gravar);
            else gravar();
        } catch (e) { console.warn('[MetaLoja] save falhou:', e); }
    }

    // ══════════════════════════════════════════════════════════════
    //  Datas — sempre em horário LOCAL.
    //  Misturar meia-noite local com toISOString desloca o mês inteiro
    //  em fusos a leste de Greenwich (o mesmo bug que existia no shopify.js).
    // ══════════════════════════════════════════════════════════════

    function _iso(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function _rangeDoMes(mes) {                     // mes = 'YYYY-MM'
        const [a, m] = String(mes || '').split('-').map(Number);
        if (!a || !m) return { from: '', to: '' };
        return { from: _iso(new Date(a, m - 1, 1)), to: _iso(new Date(a, m, 0)) };
    }

    function _diasDoMes(mes) {
        const { from, to } = _rangeDoMes(mes);
        if (!from) return [];
        const out = [];
        const fim = new Date(to + 'T00:00:00');
        for (let d = new Date(from + 'T00:00:00'); d <= fim; d.setDate(d.getDate() + 1)) out.push(_iso(d));
        return out;
    }

    function _mesAtual() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    // Segunda-feira da semana de uma data (rótulo de agrupamento semanal)
    function _inicioSemana(iso) {
        const d = new Date(iso + 'T00:00:00');
        const dow = (d.getDay() + 6) % 7;           // 0 = segunda
        d.setDate(d.getDate() - dow);
        return _iso(d);
    }

    // ══════════════════════════════════════════════════════════════
    //  Câmbio — falha explícita
    //  convertToUSD devolve o valor SEM converter quando não há cotação.
    //  Somar moedas assim produz um total errado em silêncio, então
    //  auditamos antes e avisamos na tela.
    // ══════════════════════════════════════════════════════════════

    function _semCotacao(moedas) {
        const faltando = new Set();
        moedas.forEach(m => {
            const c = String(m || '').toUpperCase();
            if (!c || c === 'USD') return;
            if (typeof getExchangeRate !== 'function' || !getExchangeRate(c)) faltando.add(c);
        });
        return [...faltando];
    }

    function _usd(v, moeda) {
        return (typeof convertToUSD === 'function') ? convertToUSD(Number(v) || 0, moeda || 'USD') : (Number(v) || 0);
    }

    // ══════════════════════════════════════════════════════════════
    //  Custo por país
    //  countryPrices[].cost === null significa "usar o custo padrão".
    // ══════════════════════════════════════════════════════════════

    function custoDoProduto(product, countryCode) {
        if (!product) return { value: 0, currency: 'USD', fonte: 'nenhum' };
        const cc = String(countryCode || '').toUpperCase();
        const cp = (product.countryPrices || []).find(x => String(x.country).toUpperCase() === cc);
        if (cp && cp.cost != null && cp.cost !== '') {
            return { value: Number(cp.cost) || 0, currency: cp.currency || product.costCurrency || 'USD', fonte: 'pais' };
        }
        return { value: Number(product.cost) || 0, currency: product.costCurrency || 'USD', fonte: 'padrao' };
    }

    function ticketDoProduto(product, countryCode) {
        const cc = String(countryCode || '').toUpperCase();
        const cp = (product?.countryPrices || []).find(x => String(x.country).toUpperCase() === cc);
        const preco = cp?.tiers?.[0]?.price || cp?.price || 0;
        if (preco > 0) return { value: Number(preco), currency: cp.currency || product.priceCurrency || 'USD', fonte: 'pais' };
        return { value: Number(product?.price) || 0, currency: product?.priceCurrency || 'USD', fonte: 'padrao' };
    }

    // Margem unitária ANTES do custo de anúncio, em USD.
    // É exatamente o CPA de break-even: pagar mais que isso dá prejuízo.
    function margemBrutaUSD(product, countryCode, ticketOverride) {
        if (!product) return 0;
        const t = ticketOverride != null && ticketOverride !== ''
            ? { value: Number(ticketOverride), currency: ticketDoProduto(product, countryCode).currency }
            : ticketDoProduto(product, countryCode);
        const c = custoDoProduto(product, countryCode);
        const precoUSD = _usd(t.value, t.currency);
        const custoUSD = _usd(c.value, c.currency);
        const imposto = (Number(product.tax) || 0) / 100;
        const varCost = (Number(product.variableCosts) || 0) / 100;
        return precoUSD * (1 - imposto - varCost) - custoUSD;
    }

    // ══════════════════════════════════════════════════════════════
    //  Vínculo produto Shopify → produto local
    // ══════════════════════════════════════════════════════════════

    function _norm(s) {
        return String(s || '').toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
    }

    function _mapaProdutos() {
        const locais = AppState.allProducts || AppState.products || [];
        const porShopify = new Map();
        const porNome = new Map();
        locais.forEach(p => {
            if (typeof ShopifyModule !== 'undefined' && ShopifyModule.getLink) {
                const sid = ShopifyModule.getLink(p.id);
                if (sid) porShopify.set(String(sid), p);
            }
            porNome.set(_norm(p.name), p);
        });
        return { porShopify, porNome };
    }

    function _produtoLocalDaLinha(li, mapa) {
        const porId = mapa.porShopify.get(String(li.product_id || ''));
        if (porId) return porId;
        return mapa.porNome.get(_norm(li.title)) || null;
    }

    // ══════════════════════════════════════════════════════════════
    //  REALIZADO — nível da loja
    // ══════════════════════════════════════════════════════════════

    function _gastoPorDia(from, to, productIds) {
        // Filtro triplo: sub-entradas de campanha (isCampaign/parentId) somam ao
        // pai, e entradas de PERÍODO empilham em cima dos dias. Contar qualquer
        // uma delas dobraria o gasto.
        const ehPeriodo = (e) => {
            if (typeof DiaryModule !== 'undefined' && DiaryModule._isRangeEntry) return DiaryModule._isRangeEntry(e);
            return !!(e.periodStart && e.periodEnd && e.periodStart !== e.periodEnd);
        };
        const filtro = new Set((productIds || []).map(String));
        const porDia = {};
        const moedas = new Set();
        (AppState.allDiary || []).forEach(e => {
            if (!e || e.isCampaign || e.parentId || ehPeriodo(e)) return;
            if (!e.date || e.date < from || e.date > to) return;
            if (filtro.size && !filtro.has(String(e.productId))) return;
            const moeda = e.budgetCurrency || 'USD';
            moedas.add(moeda);
            porDia[e.date] = (porDia[e.date] || 0) + _usd(e.budget, moeda);
        });
        return { porDia, moedas: [...moedas] };
    }

    async function calcularRealizado(goal) {
        const { from, to } = _rangeDoMes(goal.month);
        if (!from) return null;

        const conectado = typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured && ShopifyModule.isConfigured();
        const mapa = _mapaProdutos();
        const filtro = new Set((goal.productIds || []).map(String));

        let orders = [];
        let erroPedidos = '';
        if (conectado) {
            try { orders = await ShopifyModule.fetchOrders(from, to) || []; }
            catch (err) { erroPedidos = err.message || 'Falha ao buscar pedidos'; }
        } else {
            erroPedidos = 'Shopify não conectado — sem vendas reais.';
        }

        const porDia = {};
        const moedasVistas = new Set();
        let semVinculo = 0;

        const bucket = (d) => (porDia[d] = porDia[d] || { receita: 0, cogs: 0, impostos: 0, vendas: 0, pedidos: 0, gasto: 0 });

        orders.forEach(o => {
            const dia = (typeof ShopifyModule?._orderDateInShopTz === 'function')
                ? ShopifyModule._orderDateInShopTz(o.created_at)
                : String(o.created_at || '').slice(0, 10);
            if (!dia || dia < from || dia > to) return;   // guarda contra fuso da loja empurrar pra fora
            const b = bucket(dia);
            const cc = (o.shipping_address?.country_code || '').toUpperCase();
            const moeda = o.currency || 'USD';
            moedasVistas.add(moeda);
            let temItem = false;

            (o.line_items || []).forEach(li => {
                const prod = _produtoLocalDaLinha(li, mapa);
                if (filtro.size && (!prod || !filtro.has(String(prod.id)))) return;
                const qtd = Number(li.quantity) || 0;
                if (!qtd) return;
                temItem = true;

                // Preço realmente cobrado (com desconto de linha aplicado)
                const unit = parseFloat(li.discounted_price ?? li.price) || 0;
                const receitaUSD = _usd(unit * qtd, moeda);
                b.receita += receitaUSD;
                b.vendas += qtd;

                if (prod) {
                    const c = custoDoProduto(prod, cc);
                    moedasVistas.add(c.currency);
                    b.cogs += _usd(c.value, c.currency) * qtd;
                    const imp = ((Number(prod.tax) || 0) + (Number(prod.variableCosts) || 0)) / 100;
                    b.impostos += receitaUSD * imp;
                } else {
                    semVinculo += qtd;   // sem produto local não há custo: fica explícito
                }
            });
            if (temItem) b.pedidos++;
        });

        const gasto = _gastoPorDia(from, to, goal.productIds);
        Object.entries(gasto.porDia).forEach(([d, v]) => { bucket(d).gasto += v; });

        // Série completa do mês (dias sem venda entram como zero)
        const dias = _diasDoMes(goal.month).map(d => {
            const b = porDia[d] || { receita: 0, cogs: 0, impostos: 0, vendas: 0, pedidos: 0, gasto: 0 };
            return { data: d, ...b, lucro: b.receita - b.cogs - b.impostos - b.gasto };
        });

        const soma = dias.reduce((a, d) => ({
            receita: a.receita + d.receita, cogs: a.cogs + d.cogs, impostos: a.impostos + d.impostos,
            vendas: a.vendas + d.vendas, pedidos: a.pedidos + d.pedidos, gasto: a.gasto + d.gasto,
            lucro: a.lucro + d.lucro,
        }), { receita: 0, cogs: 0, impostos: 0, vendas: 0, pedidos: 0, gasto: 0, lucro: 0 });

        const avisos = [];
        const faltando = _semCotacao([...moedasVistas, ...gasto.moedas]);
        if (faltando.length) avisos.push(`Sem cotação para ${faltando.join(', ')} — esses valores entraram SEM conversão e o total está errado.`);
        if (erroPedidos) avisos.push(erroPedidos);
        if (semVinculo > 0) avisos.push(`${semVinculo} unidade(s) vendida(s) sem produto vinculado no app: entraram na receita, mas sem custo — o lucro está otimista.`);
        if (!conectado) avisos.push('Conecte a Shopify para o realizado refletir vendas reais.');
        // O diário só recebe gasto do importador do Facebook.
        if (soma.gasto > 0) avisos.push('O gasto considerado é o do Diário (importação do Facebook). Google Ads não entra.');

        return { dias, soma, avisos, from, to };
    }

    // ══════════════════════════════════════════════════════════════
    //  PLANEJAMENTO POR PAÍS — projeção, sem atribuição de gasto
    // ══════════════════════════════════════════════════════════════

    // Participação histórica de vendas por país, para dividir a meta.
    function _shareHistoricoPorPais(dias, ordersPorPais) {
        const total = [...ordersPorPais.values()].reduce((s, v) => s + v, 0);
        if (!total) return null;
        const out = {};
        ordersPorPais.forEach((v, cc) => { out[cc] = v / total; });
        return out;
    }

    function planejarPorPais(goal, realizado, ordersPorPais) {
        const produtos = (AppState.allProducts || AppState.products || [])
            .filter(p => !(goal.productIds || []).length || goal.productIds.includes(p.id));

        // Países que aparecem no cadastro dos produtos do escopo
        const paises = new Set();
        produtos.forEach(p => (p.countryPrices || []).forEach(cp => cp.country && paises.add(String(cp.country).toUpperCase())));
        if (!paises.size) return { linhas: [], semPaises: true };

        const share = _shareHistoricoPorPais(realizado?.dias, ordersPorPais || new Map());
        const metaUSD = _usd(goal.targetProfit, goal.currency);
        const faltaUSD = Math.max(0, metaUSD - (realizado?.soma.lucro || 0));

        const linhas = [];
        paises.forEach(cc => {
            produtos.forEach(p => {
                const temPais = (p.countryPrices || []).some(cp => String(cp.country).toUpperCase() === cc);
                if (!temPais) return;

                const chave = `${goal.id}|${cc}|${p.id}`;
                const override = _state.ticketOverrides[chave];
                const t = override != null && override !== ''
                    ? { value: Number(override), currency: ticketDoProduto(p, cc).currency, fonte: 'manual' }
                    : ticketDoProduto(p, cc);
                const c = custoDoProduto(p, cc);
                const margem = margemBrutaUSD(p, cc, override);

                // Fatia da meta que cabe a este país (histórico; sem histórico, divide igual)
                const fatia = share ? (share[cc] || 0) : (1 / paises.size);
                const metaDoPais = faltaUSD * fatia;
                // Vendas necessárias assumindo CPA = 70% da margem (folga de 30%).
                // É só um ponto de partida editável — o número que importa é o CPA.
                const vendasParaMeta = margem > 0 ? Math.ceil(metaDoPais / (margem * 0.30)) : null;
                // CPA máximo que ainda entrega a fatia da meta com essas vendas
                const cpaAlvo = (margem > 0 && vendasParaMeta > 0) ? margem - (metaDoPais / vendasParaMeta) : null;

                linhas.push({
                    chave, cc, produto: p, ticket: t, custo: c,
                    margemUSD: margem,
                    cpaBreakEvenUSD: margem,          // pagar acima disso = prejuízo
                    cpaAlvoUSD: cpaAlvo,
                    fatiaMeta: fatia,
                    metaDoPaisUSD: metaDoPais,
                    vendasParaMeta,
                });
            });
        });

        linhas.sort((a, b) => b.margemUSD - a.margemUSD);
        return { linhas, faltaUSD, metaUSD, usouHistorico: !!share };
    }

    // ══════════════════════════════════════════════════════════════
    //  Interface
    // ══════════════════════════════════════════════════════════════

    function _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }
    function _moeda(usd, moedaAlvo) {
        const v = (typeof convertCurrency === 'function' && moedaAlvo && moedaAlvo !== 'USD')
            ? convertCurrency(usd, 'USD', moedaAlvo) : usd;
        return (typeof formatCurrency === 'function') ? formatCurrency(v, moedaAlvo || 'USD')
            : `${(moedaAlvo || 'USD')} ${(Number(v)||0).toFixed(2)}`;
    }
    function _num(n) { return (Number(n) || 0).toLocaleString('pt-BR'); }
    function _icones() { if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {} }

    function metaAtual() {
        return _state.goals.find(g => g.id === _state.selectedId) || _state.goals[0] || null;
    }

    function _agrupar(dias, modo) {
        if (modo === 'mes') {
            const s = dias.reduce((a, d) => ({
                receita:a.receita+d.receita, cogs:a.cogs+d.cogs, impostos:a.impostos+d.impostos,
                vendas:a.vendas+d.vendas, gasto:a.gasto+d.gasto, lucro:a.lucro+d.lucro,
            }), { receita:0,cogs:0,impostos:0,vendas:0,gasto:0,lucro:0 });
            return [{ rotulo: 'Mês inteiro', ...s }];
        }
        if (modo === 'semana') {
            const m = new Map();
            dias.forEach(d => {
                const k = _inicioSemana(d.data);
                const e = m.get(k) || { rotulo:`Semana de ${k.slice(8,10)}/${k.slice(5,7)}`, receita:0,cogs:0,impostos:0,vendas:0,gasto:0,lucro:0 };
                e.receita+=d.receita; e.cogs+=d.cogs; e.impostos+=d.impostos;
                e.vendas+=d.vendas; e.gasto+=d.gasto; e.lucro+=d.lucro;
                m.set(k, e);
            });
            return [...m.values()];
        }
        return dias.map(d => ({ rotulo: `${d.data.slice(8,10)}/${d.data.slice(5,7)}`, ...d }));
    }

    async function render() {
        const wrap = document.getElementById('store-goal-body');
        if (!wrap) return;
        const goal = metaAtual();

        _renderSeletor();

        if (!goal) {
            wrap.innerHTML = `<div class="empty-state"><p>Nenhuma meta de loja criada.</p>
                <p class="sg-hint">Crie uma meta mensal de lucro para acompanhar o realizado e descobrir o CPA máximo por país.</p></div>`;
            return;
        }

        wrap.innerHTML = `<div class="sg-loading"><i data-lucide="loader-2" style="width:18px;height:18px;animation:spin 1s linear infinite"></i> Calculando o mês…</div>`;
        _icones();

        let real;
        try { real = await calcularRealizado(goal); }
        catch (err) {
            wrap.innerHTML = `<div class="sg-erro">Falha ao calcular: ${_esc(err.message || err)}</div>`;
            return;
        }
        if (!real) { wrap.innerHTML = '<div class="sg-erro">Mês inválido.</div>'; return; }

        // Participação por país, só para dividir a META (não o gasto realizado)
        const porPais = new Map();
        try {
            if (typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured?.()) {
                const orders = await ShopifyModule.fetchOrders(real.from, real.to) || [];
                orders.forEach(o => {
                    const cc = (o.shipping_address?.country_code || '').toUpperCase();
                    if (!cc) return;
                    const q = (o.line_items || []).reduce((s, li) => s + (Number(li.quantity) || 0), 0);
                    porPais.set(cc, (porPais.get(cc) || 0) + q);
                });
            }
        } catch { /* sem histórico, divide igual */ }

        const plano = planejarPorPais(goal, real, porPais);
        const M = goal.currency || 'USD';
        const metaUSD = _usd(goal.targetProfit, M);
        const pct = metaUSD > 0 ? (real.soma.lucro / metaUSD) * 100 : 0;
        const falta = Math.max(0, metaUSD - real.soma.lucro);

        const hoje = _iso(new Date());
        const diasTotais = real.dias.length;
        const diasCorridos = real.dias.filter(d => d.data <= hoje).length || diasTotais;
        const restantes = Math.max(0, diasTotais - diasCorridos);
        const ritmoDia = diasCorridos > 0 ? real.soma.lucro / diasCorridos : 0;
        const projecao = ritmoDia * diasTotais;
        const precisaPorDia = restantes > 0 ? falta / restantes : 0;

        const linhas = _agrupar(real.dias, _state.breakdown);
        const metaPorLinha = metaUSD / (linhas.length || 1);

        wrap.innerHTML = `
            ${real.avisos.length ? `<div class="sg-avisos">${real.avisos.map(a => `<div><i data-lucide="alert-triangle" style="width:13px;height:13px;vertical-align:-2px"></i> ${_esc(a)}</div>`).join('')}</div>` : ''}

            <div class="sg-kpis">
                <div class="sg-kpi"><label>Meta de lucro</label><strong>${_moeda(metaUSD, M)}</strong></div>
                <div class="sg-kpi ${real.soma.lucro >= 0 ? 'sg-ok' : 'sg-ruim'}"><label>Lucro realizado</label><strong>${_moeda(real.soma.lucro, M)}</strong></div>
                <div class="sg-kpi"><label>Falta</label><strong>${_moeda(falta, M)}</strong></div>
                <div class="sg-kpi"><label>Vendas</label><strong>${_num(real.soma.vendas)}</strong><span>${_num(real.soma.pedidos)} pedidos</span></div>
                <div class="sg-kpi"><label>Receita</label><strong>${_moeda(real.soma.receita, M)}</strong></div>
                <div class="sg-kpi"><label>Gasto em ads</label><strong>${_moeda(real.soma.gasto, M)}</strong></div>
            </div>

            <div class="sg-barra-wrap">
                <div class="sg-barra"><span style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></span></div>
                <div class="sg-barra-txt">
                    <span><strong>${pct.toFixed(1)}%</strong> da meta</span>
                    <span>Projeção no ritmo atual: <strong class="${projecao >= metaUSD ? 'sg-ok-txt' : 'sg-ruim-txt'}">${_moeda(projecao, M)}</strong></span>
                    ${restantes > 0 ? `<span>Faltam ${restantes} dia(s) — precisa de <strong>${_moeda(precisaPorDia, M)}</strong>/dia</span>` : ''}
                </div>
            </div>

            <div class="sg-sub">
                <div class="sg-tabs">
                    ${['dia','semana','mes'].map(k => `<button class="sg-tab ${_state.breakdown===k?'active':''}" data-bd="${k}">${k==='dia'?'Por dia':k==='semana'?'Por semana':'Mês'}</button>`).join('')}
                </div>
                <div class="sg-table-wrap">
                    <table class="sg-table">
                        <thead><tr><th>Período</th><th class="num">Vendas</th><th class="num">Receita</th><th class="num">Custo prod.</th><th class="num">Gasto ads</th><th class="num">Lucro</th><th class="num">vs meta</th></tr></thead>
                        <tbody>${linhas.map(l => {
                            const dif = l.lucro - metaPorLinha;
                            return `<tr class="${l.lucro >= metaPorLinha ? 'sg-linha-ok' : (l.lucro < 0 ? 'sg-linha-ruim' : '')}">
                                <td>${_esc(l.rotulo)}</td>
                                <td class="num">${_num(l.vendas)}</td>
                                <td class="num">${_moeda(l.receita, M)}</td>
                                <td class="num">${_moeda(l.cogs + l.impostos, M)}</td>
                                <td class="num">${_moeda(l.gasto, M)}</td>
                                <td class="num"><strong>${_moeda(l.lucro, M)}</strong></td>
                                <td class="num ${dif >= 0 ? 'sg-ok-txt' : 'sg-ruim-txt'}">${dif >= 0 ? '+' : ''}${_moeda(dif, M)}</td>
                            </tr>`;
                        }).join('')}</tbody>
                    </table>
                </div>
            </div>

            <div class="sg-sub">
                <h4><i data-lucide="globe" style="width:15px;height:15px;vertical-align:-2px"></i> Plano por país — quanto posso pagar por venda
                    <small>projeção a partir de ticket e custo; não usa rateio de gasto</small></h4>
                ${plano.semPaises
                    ? `<p class="sg-hint">Nenhum produto do escopo tem países cadastrados. Adicione preços e custos por país no produto.</p>`
                    : `<div class="sg-table-wrap">
                    <table class="sg-table">
                        <thead><tr><th>País</th><th>Produto</th><th class="num">Ticket</th><th class="num">Custo</th><th class="num">Margem/venda</th><th class="num">CPA break-even</th><th class="num">CPA alvo</th><th class="num">Vendas p/ meta</th></tr></thead>
                        <tbody>${plano.linhas.map(l => `
                            <tr>
                                <td><strong>${_esc(l.cc)}</strong></td>
                                <td class="sg-prod">${_esc(l.produto.name)}</td>
                                <td class="num"><input type="text" class="input input-sm sg-ticket" data-chave="${_esc(l.chave)}" value="${l.ticket.value}" title="Ticket para simular (${l.ticket.currency})"><span class="sg-cur">${_esc(l.ticket.currency)}</span></td>
                                <td class="num">${_moeda(_usd(l.custo.value, l.custo.currency), M)}${l.custo.fonte === 'pais' ? ` <span class="sg-tag">${_esc(l.cc)}</span>` : ` <span class="sg-tag sg-tag-pad" title="Sem custo cadastrado para este país; usando o padrão do produto">padrão</span>`}</td>
                                <td class="num">${_moeda(l.margemUSD, M)}</td>
                                <td class="num sg-be">${_moeda(l.cpaBreakEvenUSD, M)}</td>
                                <td class="num sg-alvo">${l.cpaAlvoUSD != null && l.cpaAlvoUSD > 0 ? _moeda(l.cpaAlvoUSD, M) : '--'}</td>
                                <td class="num">${l.vendasParaMeta != null ? _num(l.vendasParaMeta) : '--'}</td>
                            </tr>`).join('')}</tbody>
                    </table>
                    </div>
                    <p class="sg-hint"><strong>CPA break-even</strong>: acima disso a venda dá prejuízo. <strong>CPA alvo</strong>: o máximo que ainda entrega a fatia da meta desse país${plano.usouHistorico ? ' (fatia calculada pelo histórico de vendas do mês)' : ' (sem histórico ainda — meta dividida igualmente entre os países)'}.</p>`}
            </div>`;

        _icones();

        wrap.querySelectorAll('.sg-tab').forEach(b => b.addEventListener('click', () => {
            _state.breakdown = b.dataset.bd; render();
        }));
        wrap.querySelectorAll('.sg-ticket').forEach(inp => {
            if (typeof NumFmt !== 'undefined') NumFmt.attach(inp);
            inp.addEventListener('change', () => {
                const v = (typeof NumFmt !== 'undefined') ? NumFmt.val(inp) : parseFloat(inp.value);
                _state.ticketOverrides[inp.dataset.chave] = v > 0 ? v : '';
                _save();
                render();
            });
        });
    }

    function _renderSeletor() {
        const sel = document.getElementById('store-goal-select');
        if (!sel) return;
        sel.innerHTML = _state.goals.map(g =>
            `<option value="${_esc(g.id)}"${g.id === _state.selectedId ? ' selected' : ''}>${_esc(g.month)} — meta ${g.targetProfit} ${_esc(g.currency)}</option>`).join('');
        sel.style.display = _state.goals.length ? '' : 'none';
    }

    function novaMeta() {
        const mes = prompt('Mês da meta (AAAA-MM):', _mesAtual());
        if (!mes || !/^\d{4}-\d{2}$/.test(mes)) { if (mes) showToast('Formato inválido. Use AAAA-MM.', 'error'); return; }
        const alvo = prompt('Meta de LUCRO no mês (só números):', '10000');
        const valor = (typeof NumFmt !== 'undefined') ? NumFmt.parse(alvo) : parseFloat(alvo);
        if (!valor || valor <= 0) { if (alvo) showToast('Valor inválido.', 'error'); return; }
        const moeda = prompt('Moeda (BRL, USD, EUR, GBP):', 'BRL');
        const g = {
            id: 'sg_' + Date.now(), month: mes, targetProfit: valor,
            currency: String(moeda || 'BRL').toUpperCase(), productIds: [],
            createdAt: new Date().toISOString(),
        };
        _state.goals.unshift(g);
        _state.selectedId = g.id;
        _save();
        render();
        showToast(`Meta de ${mes} criada.`, 'success');
    }

    function excluirMeta() {
        const g = metaAtual();
        if (!g) return;
        if (!confirm(`Excluir a meta de ${g.month}?`)) return;
        _state.goals = _state.goals.filter(x => x.id !== g.id);
        _state.selectedId = _state.goals[0]?.id || '';
        _save();
        render();
    }

    function init() {
        _load();
        if (!_state.selectedId && _state.goals[0]) _state.selectedId = _state.goals[0].id;
        document.getElementById('btn-store-goal-new')?.addEventListener('click', () => novaMeta());
        document.getElementById('btn-store-goal-del')?.addEventListener('click', () => excluirMeta());
        document.getElementById('store-goal-select')?.addEventListener('change', (e) => {
            _state.selectedId = e.target.value; render();
        });
        const toggle = document.getElementById('store-goal-toggle');
        const body = document.getElementById('store-goal-card-body');
        toggle?.addEventListener('click', () => {
            const aberto = body.style.display !== 'none';
            body.style.display = aberto ? 'none' : '';
            toggle.textContent = aberto ? '▶' : '▼';
        });
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (t) => { if (t === 'goals') render(); });
            EventBus.on('productsChanged', () => { if (metaAtual()) render(); });
        }
        render();
    }

    return {
        STORAGE_KEY, _state,
        init, render, novaMeta, excluirMeta, metaAtual,
        _load, _save, _iso, _rangeDoMes, _diasDoMes, _mesAtual, _inicioSemana, _agrupar,
        _semCotacao, _usd, _gastoPorDia, _mapaProdutos, _produtoLocalDaLinha,
        custoDoProduto, ticketDoProduto, margemBrutaUSD,
        calcularRealizado, planejarPorPais,
    };
})();

window.StoreGoalModule = StoreGoalModule;
document.addEventListener('DOMContentLoaded', () => StoreGoalModule.init());
