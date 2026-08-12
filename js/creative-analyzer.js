/* ==============================================================
   Analisador de Criativos
   - Agrega criativos de MESMO NOME rodando em várias campanhas
     (média/soma), mostrando os países onde cada um roda e permitindo
     abrir cada instância individual.
   - Classifica cada criativo em Oportunidade de escala / ROAS alto /
     CPA alto ou fora, usando a MARGEM REAL do produto (mesma lógica do
     Simulador de Escala).
   - Métricas de vídeo: Play Rate (3s ÷ impressões), Body Rate
     (reproduções ÷ impressões) e 75% (reproduções 75% ÷ impressões).
   - Fonte canônica de agregação: CreativesModule._adMapGroups() (Mapa de Ads).
     Vídeo vem de ad.dailyVideo (populado no import do CSV do Meta).
   ============================================================== */

const CreativeAnalyzerModule = {
    TAB: 'analisador-criativos',
    CFG_KEY: 'etracker_analyzer_cfg',

    // Estado da tela (não vive no DOM — evita perder valor no re-render)
    _period: 30,            // dias; 0 = tudo
    _productFilter: 'todos',
    _sortBy: 'spend',       // spend|roas|cpa|purchases|playRate|p75Rate|ctr
    _groupByProduct: false,
    _classFilter: 'todos',  // todos|escala|roas|fora|observar
    _byId: {},              // id do criativo -> { linha, g } p/ drill-down
    _inited: false,

    // Regras de classificação (o usuário ajusta na engrenagem)
    cfg: {
        metaMargem: 50,   // % do lucro/unidade que vira CPA-alvo (escala abaixo disso)
        roasAlto: 2,      // ROAS a partir do qual marca "ROAS alto"
        minCompras: 2,    // abaixo disso = poucos dados (Observar)
        minGasto: 15,     // gasto mínimo (na moeda dos ads) p/ classificar
    },

    _SYM: { GBP: '£', USD: '$', EUR: '€', BRL: 'R$', AUD: 'A$', CAD: 'C$' },

    init() {
        if (this._inited) return;
        this._inited = true;
        this._loadCfg();
        // Render preguiçoso: só quando a aba abre, e re-render quando dados mudam.
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (tab) => { if (tab === this.TAB) this.render(); });
            ['creativesChanged', 'dataLoaded', 'storeChanged', 'productsChanged'].forEach(ev =>
                EventBus.on(ev, () => { if (this._isActive()) this.render(); }));
        }
        if (this._isActive()) this.render();
    },

    _isActive() {
        return document.getElementById('tab-' + this.TAB)?.classList.contains('active');
    },

    _loadCfg() {
        try {
            const raw = JSON.parse(localStorage.getItem(this.CFG_KEY) || '{}');
            this.cfg = { ...this.cfg, ...raw };
        } catch {}
    },
    _saveCfg() {
        try { localStorage.setItem(this.CFG_KEY, JSON.stringify(this.cfg)); } catch {}
    },

    // ---- helpers ---------------------------------------------------------
    _moeda() { return (window.AdHierarchyModule?._state?.currency) || 'USD'; },
    _sym() { return this._SYM[this._moeda()] || (this._moeda() + ' '); },
    _fmtMoney(v) {
        const n = Number(v) || 0;
        return this._sym() + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    _fmtNum(v) { return (Number(v) || 0).toLocaleString('pt-BR'); },
    _fmtPct(v) {
        if (v == null || !isFinite(v)) return '—';
        return (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
    },
    _fmtX(v) {
        if (v == null || !isFinite(v)) return '—';
        return (Number(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×';
    },

    _cutoff() {
        if (!this._period) return '';
        const d = new Date();
        d.setDate(d.getDate() - (this._period - 1));
        return d.toISOString().slice(0, 10);
    },

    _countryLabel(code) {
        const c = String(code || '').trim();
        if (!c) return '';
        // RegionTags cobre os mercados de ads em PT; Intl cobre o resto.
        try {
            if (window.RegionTags && RegionTags.labelPlain) {
                const lbl = RegionTags.labelPlain(c);
                if (lbl && lbl !== c) return lbl;
            }
        } catch {}
        try {
            if (/^[A-Z]{2}$/.test(c)) {
                const dn = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
                const nome = dn.of(c);
                if (nome && nome !== c) return nome;
            }
        } catch {}
        return c;
    },

    // ---- dados -----------------------------------------------------------
    // Constrói os mapas conjunto->campanha uma vez por render.
    _maps() {
        const AH = window.AdHierarchyModule;
        if (!AH || !AH._state) return null;
        return {
            AH,
            setById: new Map((AH._state.adsets || []).map(a => [a.id, a])),
            campById: new Map((AH._state.campaigns || []).map(c => [c.id, c])),
        };
    },

    // Soma o diário (tupla core [imp,clk,gasto,lpv,atc,ic,compras]) + vídeo
    // (ad.dailyVideo[dia] = [p3s, plays, p75]) de um conjunto de dias no período.
    _somaDiario(dailyMap, cutoff) {
        const t = { impr: 0, clk: 0, gasto: 0, lpv: 0, atc: 0, ic: 0, compras: 0 };
        Object.entries(dailyMap || {}).forEach(([dia, v]) => {
            if (cutoff && dia < cutoff) return;
            t.impr += Number(v[0]) || 0; t.clk += Number(v[1]) || 0; t.gasto += Number(v[2]) || 0;
            t.lpv += Number(v[3]) || 0; t.atc += Number(v[4]) || 0; t.ic += Number(v[5]) || 0;
            t.compras += Number(v[6]) || 0;
        });
        return t;
    },
    _somaVideo(ads, cutoff) {
        let p3s = 0, plays = 0, p75 = 0, tem = false;
        (ads || []).forEach(ad => {
            const dv = ad.dailyVideo;
            if (!dv) return;
            Object.entries(dv).forEach(([dia, v]) => {
                if (cutoff && dia < cutoff) return;
                tem = true;
                p3s += Number(v[0]) || 0; plays += Number(v[1]) || 0; p75 += Number(v[2]) || 0;
            });
        });
        return { p3s, plays, p75, tem };
    },

    _derivar(core, video, pid) {
        const { impr, clk, gasto, compras } = core;
        const receita = window.CreativesModule?._precoEstimado
            ? CreativesModule._precoEstimado(pid, this._moeda()) * compras : 0;
        return {
            impressions: impr, clicks: clk, spend: gasto, purchases: compras,
            lpv: core.lpv, atc: core.atc, ic: core.ic,
            revenue: receita, revenueEstimated: receita > 0,
            roas: gasto > 0 ? receita / gasto : null,
            cpa: compras > 0 ? gasto / compras : null,
            cpc: clk > 0 ? gasto / clk : null,
            ctr: impr > 0 ? clk / impr : null,
            cpm: impr > 0 ? gasto / impr * 1000 : null,
            playRate: (video.tem && impr > 0) ? video.p3s / impr : null,
            bodyRate: (video.tem && impr > 0) ? video.plays / impr : null,
            p75Rate: (video.tem && impr > 0) ? video.p75 / impr : null,
            temVideo: video.tem,
        };
    },

    // Economia do produto -> CPA-alvo e CPA-breakeven (na moeda dos ads).
    _economia(pid) {
        const p = typeof getProductById === 'function' ? getProductById(pid) : null;
        if (!p || !Number(p.price)) return null;
        const moeda = this._moeda();
        const conv = (v, de) => {
            const val = Number(v) || 0;
            if (!val) return 0;
            de = de || 'USD';
            if (de === moeda) return val;
            try { return convertCurrency(val, de, moeda) || 0; } catch { return val; }
        };
        const preco = conv(p.price, p.priceCurrency);
        const custo = conv(p.cost, p.costCurrency);
        const imposto = preco * (Number(p.tax) || 0) / 100;
        const varc = preco * (Number(p.variableCosts) || 0) / 100;
        const lucroUn = preco - custo - imposto - varc;   // = CPA breakeven
        if (lucroUn <= 0) return { lucroUn, cpaBreak: 0, cpaAlvo: 0 };
        return {
            lucroUn,
            cpaBreak: lucroUn,
            cpaAlvo: lucroUn * (1 - this.cfg.metaMargem / 100),
        };
    },

    // Classificação: verde=escala, azul=ROAS alto/saudável, vermelho=CPA fora,
    // cinza=poucos dados. Usa margem do produto quando existe; senão, ROAS.
    _classificar(d, pid) {
        if ((d.spend || 0) < this.cfg.minGasto || (d.purchases || 0) < this.cfg.minCompras) {
            return { key: 'observar', label: 'Observar', tone: 'muted', dica: 'Poucos dados no período' };
        }
        const eco = this._economia(pid);
        const roasAlto = d.roas != null && d.roas >= this.cfg.roasAlto;
        if (eco && eco.cpaBreak > 0 && d.cpa != null) {
            if (d.cpa <= eco.cpaAlvo) {
                return { key: 'escala', label: 'Oportunidade de escala', tone: 'good',
                         dica: `CPA ${this._fmtMoney(d.cpa)} ≤ alvo ${this._fmtMoney(eco.cpaAlvo)}` };
            }
            if (d.cpa <= eco.cpaBreak) {
                return { key: 'roas', label: roasAlto ? 'ROAS alto' : 'Saudável', tone: 'ok',
                         dica: `Lucrativo · breakeven ${this._fmtMoney(eco.cpaBreak)}` };
            }
            return { key: 'fora', label: 'CPA alto / fora', tone: 'bad',
                     dica: `CPA ${this._fmtMoney(d.cpa)} > breakeven ${this._fmtMoney(eco.cpaBreak)}` };
        }
        // Sem economia do produto: cai pro ROAS puro
        if (d.roas == null) return { key: 'observar', label: 'Observar', tone: 'muted', dica: 'Sem ROAS' };
        if (d.roas >= this.cfg.roasAlto * 1.25) return { key: 'escala', label: 'Oportunidade de escala', tone: 'good', dica: `ROAS ${this._fmtX(d.roas)}` };
        if (d.roas >= 1) return { key: 'roas', label: roasAlto ? 'ROAS alto' : 'Saudável', tone: 'ok', dica: `ROAS ${this._fmtX(d.roas)}` };
        return { key: 'fora', label: 'CPA alto / fora', tone: 'bad', dica: `ROAS ${this._fmtX(d.roas)}` };
    },

    // Linhas agregadas por criativo (nome), já filtradas por período/produto/loja.
    _linhas() {
        const M = this._maps();
        if (!M) return [];
        const dados = window.CreativesModule?._adMapGroups ? CreativesModule._adMapGroups() : null;
        if (!dados || !dados.grupos) return [];
        const cutoff = this._cutoff();
        const lojaAtual = (typeof AppState !== 'undefined') ? AppState.currentStoreId : null;
        this._byId = {};
        const linhas = [];

        dados.grupos.forEach((g, chave) => {
            // Escopo por loja: se o produto é de outra loja, pula.
            const prod = typeof getProductById === 'function' ? getProductById(g.productId) : null;
            if (prod && lojaAtual && prod.storeId && prod.storeId !== lojaAtual) return;
            if (this._productFilter !== 'todos' && g.productId !== this._productFilter) return;

            const core = this._somaDiario(g.diario, cutoff);
            const video = this._somaVideo(g.ads, cutoff);
            // Nada rodou no período -> fora da lista
            if (!core.impr && !core.gasto && !core.compras) return;

            const d = this._derivar(core, video, g.productId);
            const cls = this._classificar(d, g.productId);
            const id = chave;
            const linha = {
                id,
                name: g.name,
                productId: g.productId,
                productName: typeof getProductName === 'function' ? getProductName(g.productId) : '',
                paises: [...g.paises],
                nCampanhas: g.campanhas.size,
                nConjuntos: g.conjuntos.size,
                nInstancias: g.ads.length,
                validado: g.validado,
                thumb: M.AH._mediaForCreative ? (M.AH._mediaForCreative(g.ads[0]) || '') : '',
                cls,
                ...d,
            };
            this._byId[id] = { linha, g };
            linhas.push(linha);
        });
        return linhas;
    },

    // Instâncias individuais de um criativo (uma por anúncio), no período.
    _instancias(g) {
        const M = this._maps();
        const cutoff = this._cutoff();
        return (g.ads || []).map(ad => {
            const set = M.setById.get(ad.adsetId);
            const camp = set ? M.campById.get(set.campaignId) : null;
            const core = this._somaDiario(ad.daily, cutoff);
            const video = this._somaVideo([ad], cutoff);
            const d = this._derivar(core, video, g.productId);
            return {
                campanha: camp?.name || '—',
                conjunto: set?.name || '—',
                pais: this._countryLabel(ad.region) || ad.region || '—',
                status: String(ad.status || '').toUpperCase(),
                ...d,
            };
        }).filter(x => x.impressions || x.spend || x.purchases)
          .sort((a, b) => b.spend - a.spend);
    },

    _kpis(linhas) {
        const t = linhas.reduce((s, l) => {
            s.spend += l.spend || 0; s.revenue += l.revenue || 0; s.purchases += l.purchases || 0;
            s.impr += l.impressions || 0; s.clk += l.clicks || 0;
            if (l.temVideo) { s.p3s += (l.playRate || 0) * (l.impressions || 0); s.p75 += (l.p75Rate || 0) * (l.impressions || 0); s.imprV += l.impressions || 0; }
            return s;
        }, { spend: 0, revenue: 0, purchases: 0, impr: 0, clk: 0, p3s: 0, p75: 0, imprV: 0 });
        return {
            spend: t.spend,
            roas: t.spend > 0 ? t.revenue / t.spend : null,
            cpa: t.purchases > 0 ? t.spend / t.purchases : null,
            playRate: t.imprV > 0 ? t.p3s / t.imprV : null,
            p75Rate: t.imprV > 0 ? t.p75 / t.imprV : null,
            criativos: linhas.length,
        };
    },

    // ---- render ----------------------------------------------------------
    render() {
        const root = document.getElementById('analisador-criativos-root');
        if (!root) return;

        const base = this._linhas();          // período + produto + loja
        const kpis = this._kpis(base);

        // classFilter + ordenação
        let lista = base;
        if (this._classFilter !== 'todos') {
            lista = lista.filter(l => this._classFilter === 'roas'
                ? (l.roas != null && l.roas >= this.cfg.roasAlto)
                : l.cls.key === this._classFilter);
        }
        lista = this._ordenar(lista);

        root.innerHTML =
            this._headerHtml() +
            this._controlsHtml(base) +
            this._kpisHtml(kpis) +
            (base.length ? this._listHtml(lista) : this._emptyHtml());

        this._wire(root);
        if (window.lucide) { try { lucide.createIcons(); } catch {} }
    },

    _ordenar(lista) {
        const dir = (this._sortBy === 'cpa') ? 1 : -1;  // CPA: menor é melhor
        const val = (l) => {
            const v = l[this._sortBy];
            if (v == null || !isFinite(v)) return dir === 1 ? Infinity : -Infinity;
            return v;
        };
        return [...lista].sort((a, b) => (val(a) - val(b)) * dir);
    },

    _headerHtml() {
        return `
        <div class="section-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap">
            <div>
                <h2 class="section-title" style="margin:0"><i data-lucide="scan-search" style="width:20px;height:20px;vertical-align:-3px"></i> Analisador de Criativos</h2>
                <p class="section-subtitle" style="margin:.25rem 0 0">Quais criativos escalar, quais têm ROAS alto e quais estão com CPA fora — com países e métricas de vídeo.</p>
            </div>
            <div style="display:flex;gap:.4rem;align-items:center">
                <button class="btn btn-secondary btn-sm" id="ca-import"><i data-lucide="upload" style="width:14px;height:14px"></i> Importar CSV (com vídeo)</button>
                <button class="btn btn-secondary btn-sm" id="ca-cfg" title="Regras de classificação"><i data-lucide="sliders-horizontal" style="width:14px;height:14px"></i></button>
                <button class="btn btn-secondary btn-sm" id="ca-refresh" title="Atualizar"><i data-lucide="refresh-cw" style="width:14px;height:14px"></i></button>
            </div>
        </div>`;
    },

    _controlsHtml(base) {
        const prods = new Map();
        base.forEach(l => { if (l.productId) prods.set(l.productId, l.productName); });
        // Também os produtos da loja mesmo sem criativo, pra permitir filtrar
        (typeof AppState !== 'undefined' ? (AppState.products || []) : []).forEach(p => {
            if (!prods.has(p.id)) prods.set(p.id, p.name);
        });
        const prodOpts = ['<option value="todos">Todos os produtos</option>']
            .concat([...prods.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])))
                .map(([id, nome]) => `<option value="${id}" ${this._productFilter === id ? 'selected' : ''}>${this._esc(nome || 'Produto')}</option>`))
            .join('');
        const perOpt = (v, t) => `<option value="${v}" ${this._period === v ? 'selected' : ''}>${t}</option>`;
        const sortOpt = (v, t) => `<option value="${v}" ${this._sortBy === v ? 'selected' : ''}>${t}</option>`;
        const chip = (k, t) => `<button class="ca-chip ${this._classFilter === k ? 'ca-chip-on' : ''}" data-class="${k}">${t}</button>`;
        return `
        <div class="ca-controls">
            <select id="ca-product" class="input input-sm">${prodOpts}</select>
            <select id="ca-period" class="input input-sm">
                ${perOpt(7, '7 dias')}${perOpt(14, '14 dias')}${perOpt(30, '30 dias')}${perOpt(90, '90 dias')}${perOpt(0, 'Tudo')}
            </select>
            <select id="ca-sort" class="input input-sm">
                ${sortOpt('spend', 'Ordenar: Gasto')}${sortOpt('roas', 'Ordenar: ROAS')}${sortOpt('cpa', 'Ordenar: CPA')}
                ${sortOpt('purchases', 'Ordenar: Compras')}${sortOpt('playRate', 'Ordenar: Play Rate')}${sortOpt('p75Rate', 'Ordenar: 75%')}${sortOpt('ctr', 'Ordenar: CTR')}
            </select>
            <label class="ca-toggle"><input type="checkbox" id="ca-bygroup" ${this._groupByProduct ? 'checked' : ''}> Agrupar por produto</label>
            <div class="ca-chips">
                ${chip('todos', 'Todos')}${chip('escala', 'Escala')}${chip('roas', 'ROAS alto')}${chip('fora', 'CPA fora')}${chip('observar', 'Observar')}
            </div>
        </div>`;
    },

    _kpisHtml(k) {
        const card = (label, value, icon) => `
            <div class="dash-kpi ca-kpi">
                <div class="dash-kpi-label"><i data-lucide="${icon}" style="width:13px;height:13px;vertical-align:-2px"></i> ${label}</div>
                <div class="dash-kpi-value">${value}</div>
            </div>`;
        return `<div class="ca-kpis">
            ${card('Gasto', this._fmtMoney(k.spend), 'wallet')}
            ${card('ROAS médio', this._fmtX(k.roas), 'trending-up')}
            ${card('CPA médio', k.cpa != null ? this._fmtMoney(k.cpa) : '—', 'target')}
            ${card('Play Rate', this._fmtPct(k.playRate), 'play')}
            ${card('75% assistido', this._fmtPct(k.p75Rate), 'gauge')}
            ${card('Criativos', this._fmtNum(k.criativos), 'layers')}
        </div>`;
    },

    _listHtml(lista) {
        if (!lista.length) return `<div class="dash-empty" style="margin-top:1rem">Nenhum criativo com esse filtro no período.</div>`;
        if (this._groupByProduct) {
            const porProd = new Map();
            lista.forEach(l => {
                const k = l.productId || '—';
                if (!porProd.has(k)) porProd.set(k, { nome: l.productName || 'Sem produto', linhas: [] });
                porProd.get(k).linhas.push(l);
            });
            // ordena grupos por gasto total desc
            const grupos = [...porProd.values()].sort((a, b) =>
                b.linhas.reduce((s, l) => s + l.spend, 0) - a.linhas.reduce((s, l) => s + l.spend, 0));
            return grupos.map(grp => {
                const gasto = grp.linhas.reduce((s, l) => s + l.spend, 0);
                return `<div class="ca-group">
                    <div class="ca-group-head"><span>${this._esc(grp.nome)}</span><span class="ca-group-spend">${this._fmtMoney(gasto)} · ${grp.linhas.length} criativo(s)</span></div>
                    ${this._tableHtml(grp.linhas)}
                </div>`;
            }).join('');
        }
        return this._tableHtml(lista);
    },

    _tableHtml(linhas) {
        const rows = linhas.map((l, i) => this._rowHtml(l, i + 1)).join('');
        return `<div class="ca-table-wrap"><table class="ca-table">
            <thead><tr>
                <th>#</th><th>Criativo</th><th>Classe</th><th>Países</th>
                <th class="ca-num">Gasto</th><th class="ca-num">ROAS</th><th class="ca-num">CPA</th>
                <th class="ca-num">CTR</th><th class="ca-num">Play</th><th class="ca-num">Body</th><th class="ca-num">75%</th>
                <th class="ca-num">Compras</th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
    },

    _rowHtml(l, pos) {
        const thumb = l.thumb
            ? `<span class="ca-thumb" style="background-image:url('${l.thumb}')"></span>`
            : `<span class="ca-thumb ca-thumb-empty"><i data-lucide="image" style="width:14px;height:14px"></i></span>`;
        const paises = l.paises.length
            ? l.paises.slice(0, 4).map(p => `<span class="ca-country">${this._esc(this._countryLabel(p))}</span>`).join('')
              + (l.paises.length > 4 ? `<span class="ca-country ca-country-more">+${l.paises.length - 4}</span>` : '')
            : '<span class="ca-country ca-country-none">—</span>';
        const inst = l.nInstancias > 1
            ? `<span class="ca-inst" title="${l.nInstancias} anúncios · ${l.nCampanhas} campanha(s)">${l.nInstancias}×</span>` : '';
        const roasEst = l.revenueEstimated ? ' title="ROAS estimado pelo preço do produto"' : '';
        return `<tr class="ca-row" data-id="${l.id}">
            <td class="ca-pos">${pos}</td>
            <td class="ca-name-cell">${thumb}<span class="ca-name">${this._esc(l.name)} ${inst}</span></td>
            <td><span class="ca-tag ca-tag-${l.cls.tone}" title="${this._esc(l.cls.dica)}">${l.cls.label}</span></td>
            <td class="ca-countries">${paises}</td>
            <td class="ca-num">${this._fmtMoney(l.spend)}</td>
            <td class="ca-num"${roasEst}>${this._fmtX(l.roas)}</td>
            <td class="ca-num">${l.cpa != null ? this._fmtMoney(l.cpa) : '—'}</td>
            <td class="ca-num">${this._fmtPct(l.ctr)}</td>
            <td class="ca-num">${this._fmtPct(l.playRate)}</td>
            <td class="ca-num">${this._fmtPct(l.bodyRate)}</td>
            <td class="ca-num">${this._fmtPct(l.p75Rate)}</td>
            <td class="ca-num">${this._fmtNum(l.purchases)}</td>
            <td class="ca-num"><button class="ca-open" data-id="${l.id}" title="Ver instâncias e países"><i data-lucide="chevron-right" style="width:16px;height:16px"></i></button></td>
        </tr>`;
    },

    _emptyHtml() {
        return `<div class="dash-empty ca-empty">
            <i data-lucide="scan-search" style="width:34px;height:34px;opacity:.5"></i>
            <p><b>Nenhum criativo pra analisar ainda.</b></p>
            <p style="font-size:.85rem;color:var(--text-muted)">Importe um relatório do Gerenciador de Anúncios (nível de veiculação) no <a href="#" data-ux-go="ad-hierarchy">Mapa de Ads</a>, ou conecte o Facebook. Depois volte aqui.</p>
            <p style="font-size:.8rem;color:var(--text-muted)">As métricas de vídeo (Play/Body/75%) aparecem quando o CSV incluir as colunas de reproduções de vídeo.</p>
        </div>`;
    },

    // ---- drill-down ------------------------------------------------------
    _openDrill(id) {
        const item = this._byId[id];
        if (!item) return;
        const { linha, g } = item;
        const inst = this._instancias(g);
        const paisesHtml = linha.paises.length
            ? linha.paises.map(p => `<span class="ca-country">${this._esc(this._countryLabel(p))}</span>`).join('')
            : '<span class="ca-country ca-country-none">Sem país no nome</span>';
        const instRows = inst.map(x => `<tr>
            <td>${this._esc(x.campanha)}</td>
            <td class="ca-dim">${this._esc(x.conjunto)}</td>
            <td>${this._esc(x.pais)}</td>
            <td class="ca-num">${this._fmtMoney(x.spend)}</td>
            <td class="ca-num">${this._fmtX(x.roas)}</td>
            <td class="ca-num">${x.cpa != null ? this._fmtMoney(x.cpa) : '—'}</td>
            <td class="ca-num">${this._fmtPct(x.ctr)}</td>
            <td class="ca-num">${this._fmtPct(x.playRate)}</td>
            <td class="ca-num">${this._fmtNum(x.purchases)}</td>
            <td>${x.status === 'ACTIVE' ? '<span class="ca-dot ca-dot-on"></span>' : '<span class="ca-dot"></span>'}</td>
        </tr>`).join('');

        let modal = document.getElementById('ca-drill');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ca-drill';
            modal.className = 'ca-modal-overlay hidden';
            document.body.appendChild(modal);
        }
        modal.innerHTML = `<div class="ca-modal">
            <div class="ca-modal-head">
                <div>
                    <div class="ca-modal-title">${this._esc(linha.name)}</div>
                    <div class="ca-modal-sub">${this._esc(linha.productName)} · <span class="ca-tag ca-tag-${linha.cls.tone}">${linha.cls.label}</span></div>
                </div>
                <button class="ca-modal-close" id="ca-drill-close"><i data-lucide="x" style="width:18px;height:18px"></i></button>
            </div>
            <div class="ca-modal-kpis">
                <div><span>Gasto</span><b>${this._fmtMoney(linha.spend)}</b></div>
                <div><span>ROAS</span><b>${this._fmtX(linha.roas)}</b></div>
                <div><span>CPA</span><b>${linha.cpa != null ? this._fmtMoney(linha.cpa) : '—'}</b></div>
                <div><span>Play Rate</span><b>${this._fmtPct(linha.playRate)}</b></div>
                <div><span>Body Rate</span><b>${this._fmtPct(linha.bodyRate)}</b></div>
                <div><span>75%</span><b>${this._fmtPct(linha.p75Rate)}</b></div>
            </div>
            <div class="ca-modal-paises"><span class="ca-modal-lbl">Rodando em:</span> ${paisesHtml}</div>
            <div class="ca-modal-lbl" style="margin:.6rem 0 .3rem">Instâncias (${inst.length}) — cada anúncio/campanha:</div>
            <div class="ca-table-wrap"><table class="ca-table ca-table-sm">
                <thead><tr><th>Campanha</th><th>Conjunto</th><th>País</th><th class="ca-num">Gasto</th><th class="ca-num">ROAS</th><th class="ca-num">CPA</th><th class="ca-num">CTR</th><th class="ca-num">Play</th><th class="ca-num">Compras</th><th></th></tr></thead>
                <tbody>${instRows || '<tr><td colspan="10" class="ca-dim">Sem instâncias no período.</td></tr>'}</tbody>
            </table></div>
        </div>`;
        modal.classList.remove('hidden');
        modal.querySelector('#ca-drill-close')?.addEventListener('click', () => modal.classList.add('hidden'));
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); }, { once: true });
        if (window.lucide) { try { lucide.createIcons(); } catch {} }
    },

    // ---- config ----------------------------------------------------------
    _openCfg() {
        let modal = document.getElementById('ca-cfg-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ca-cfg-modal';
            modal.className = 'ca-modal-overlay hidden';
            document.body.appendChild(modal);
        }
        const f = (id, label, val, hint) => `
            <label class="ca-cfg-row"><span>${label}<small>${hint}</small></span>
            <input type="number" id="${id}" class="input input-sm" value="${val}" style="width:90px"></label>`;
        modal.innerHTML = `<div class="ca-modal" style="max-width:440px">
            <div class="ca-modal-head"><div class="ca-modal-title">Regras de classificação</div>
            <button class="ca-modal-close" id="ca-cfg-close"><i data-lucide="x" style="width:18px;height:18px"></i></button></div>
            ${f('cfg-meta', 'Meta de margem (%)', this.cfg.metaMargem, 'CPA-alvo = lucro/unidade × (1 − meta). Abaixo do alvo = escalar.')}
            ${f('cfg-roas', 'ROAS "alto" a partir de', this.cfg.roasAlto, 'Marca "ROAS alto" acima desse valor.')}
            ${f('cfg-minc', 'Mín. de compras', this.cfg.minCompras, 'Abaixo disso = Observar (poucos dados).')}
            ${f('cfg-ming', 'Mín. de gasto', this.cfg.minGasto, 'Gasto mínimo no período pra classificar.')}
            <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">
                <button class="btn btn-secondary btn-sm" id="ca-cfg-cancel">Cancelar</button>
                <button class="btn btn-primary btn-sm" id="ca-cfg-save">Salvar</button>
            </div>
        </div>`;
        modal.classList.remove('hidden');
        const close = () => modal.classList.add('hidden');
        modal.querySelector('#ca-cfg-close')?.addEventListener('click', close);
        modal.querySelector('#ca-cfg-cancel')?.addEventListener('click', close);
        modal.querySelector('#ca-cfg-save')?.addEventListener('click', () => {
            this.cfg.metaMargem = Math.max(0, Math.min(95, Number(document.getElementById('cfg-meta').value) || 50));
            this.cfg.roasAlto = Math.max(0, Number(document.getElementById('cfg-roas').value) || 2);
            this.cfg.minCompras = Math.max(0, Number(document.getElementById('cfg-minc').value) || 0);
            this.cfg.minGasto = Math.max(0, Number(document.getElementById('cfg-ming').value) || 0);
            this._saveCfg();
            close();
            this.render();
            if (typeof showToast === 'function') showToast('Regras atualizadas', 'success');
        });
        if (window.lucide) { try { lucide.createIcons(); } catch {} }
    },

    // ---- import CSV de vídeo/métricas ------------------------------------
    _importCsv() {
        const AH = window.AdHierarchyModule;
        if (!AH || typeof AH.importCsv !== 'function') {
            if (typeof showToast === 'function') showToast('Mapa de Ads não disponível.', 'error');
            return;
        }
        // Reusa o importador do Mapa de Ads (mesmo parser, agora com colunas de vídeo).
        if (typeof showToast === 'function') showToast('Abrindo importador do Mapa de Ads — inclua as colunas de reproduções de vídeo.', 'info');
        if (typeof UXShell !== 'undefined' && UXShell.navigate) UXShell.navigate('ad-hierarchy');
        setTimeout(() => { try { AH.importCsv(); } catch {} }, 300);
    },

    // ---- wiring ----------------------------------------------------------
    _wire(root) {
        root.querySelector('#ca-product')?.addEventListener('change', e => { this._productFilter = e.target.value; this.render(); });
        root.querySelector('#ca-period')?.addEventListener('change', e => { this._period = Number(e.target.value); this.render(); });
        root.querySelector('#ca-sort')?.addEventListener('change', e => { this._sortBy = e.target.value; this.render(); });
        root.querySelector('#ca-bygroup')?.addEventListener('change', e => { this._groupByProduct = e.target.checked; this.render(); });
        root.querySelectorAll('[data-class]').forEach(b => b.addEventListener('click', () => { this._classFilter = b.dataset.class; this.render(); }));
        root.querySelector('#ca-refresh')?.addEventListener('click', () => this.render());
        root.querySelector('#ca-cfg')?.addEventListener('click', () => this._openCfg());
        root.querySelector('#ca-import')?.addEventListener('click', () => this._importCsv());
        root.querySelectorAll('.ca-row, .ca-open').forEach(el => el.addEventListener('click', (e) => {
            const id = el.dataset.id || e.currentTarget.dataset.id;
            if (id) this._openDrill(id);
        }));
        root.querySelectorAll('[data-ux-go]').forEach(a => a.addEventListener('click', (e) => {
            e.preventDefault();
            const t = a.dataset.uxGo;
            if (typeof UXShell !== 'undefined' && UXShell.navigate) UXShell.navigate(t);
        }));
    },

    _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
};
