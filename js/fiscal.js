/* ============================================================
   Fiscal & Empresa — Configurações fiscais / contábeis / de gateways
   - Regime tributário (Simples / Presumido / Real / MEI / Offshore)
   - Critério de reconhecimento de receita (competência / caixa / NF)
   - Moeda funcional + moedas operadas
   - Gateways de pagamento e suas camadas de taxa
   - Custos fixos mensais com rateio entre lojas
   - Sócios e modalidade de remuneração
   - Tributos estimados (alíquota efetiva)

   Tudo persistido em LocalStorage por enquanto (sob StorageManager).
   Quando migrar pra D1, este módulo continua sendo a UI — só troca a camada
   de persistência (FiscalStore.save / FiscalStore.load).
   ============================================================ */

const FiscalModule = (() => {
    const STORAGE_KEY = 'etracker_fiscal_config';

    const DEFAULT_CONFIG = {
        version: 2,
        // ─── EMPRESAS — array multi-jurisdição (UK Operação + BR Serviços etc.) ───
        empresas: [
            // { id, nome, identificador, pais, regime, anexoSimples, atividade, uf, municipio, moedaFuncional, papel }
        ],
        // Mantido temporariamente pra migração v1 → v2
        empresa: {
            nome: '', cnpj: '', regime: '', anexoSimples: '', atividade: 'comercio', uf: '', municipio: '',
        },
        reconhecimento: { criterio: 'caixa', obs: '' },
        moeda: { funcional: 'BRL', operadas: ['BRL'] },
        // ─── REMESSA — modelo de transferência entre empresas (ex.: UK → BR) ───
        remessa: {
            habilitado: false,
            origemEmpresaId: '',
            destinoEmpresaId: '',
            modalidade: 'faturamento_servicos',
            percentualTributacaoNaRemessa: 6.15,
            frequencia: 'mensal',
            obs: '',
        },
        // ─── SHOPIFY — taxa extra de FX que a Shopify cobra além do gateway (1.5–1.9%) ───
        shopify: { fxAdicionalPct: 1.7 },
        gateways: [],
        banco: { taxaPix: 0, taxaTed: 0, taxaBoleto: 0, taxaOutros: 0 },
        custosFixos: [],
        socios: [],
        tributos: {
            aliquotaEfetiva: null, aliquotaManual: false, faturamentoAcumulado12m: 0,
            irpjPct: 0, csllPct: 0, pisPct: 0, cofinsPct: 0, issPct: 0, icmsPct: 0, obs: '',
        },
        ultimaAtualizacao: null,
    };

    let _state = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

    // ── Persistência ────────────────────────────────────────────
    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                _state = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_CONFIG)), parsed);
                // Sanity-merge sections (in case schema evolves)
                ['empresa','reconhecimento','moeda','banco','tributos','remessa','shopify'].forEach(k => {
                    _state[k] = Object.assign({}, DEFAULT_CONFIG[k], parsed[k] || {});
                });
                _state.empresas = Array.isArray(parsed.empresas) ? parsed.empresas : [];
                _state.gateways = Array.isArray(parsed.gateways) ? parsed.gateways : [];
                _state.custosFixos = Array.isArray(parsed.custosFixos) ? parsed.custosFixos : [];
                _state.socios = Array.isArray(parsed.socios) ? parsed.socios : [];

                // ─── Migração v1 → v2: mover empresa singular pra empresas[] ───
                if ((!parsed.version || parsed.version < 2) && _state.empresa && _state.empresa.nome) {
                    _state.empresas.push({
                        id: _genId('emp'),
                        nome: _state.empresa.nome,
                        identificador: _state.empresa.cnpj || '',
                        pais: 'BR',
                        regime: _state.empresa.regime || '',
                        anexoSimples: _state.empresa.anexoSimples || '',
                        atividade: _state.empresa.atividade || 'comercio',
                        uf: _state.empresa.uf || '',
                        municipio: _state.empresa.municipio || '',
                        moedaFuncional: 'BRL',
                        papel: 'operacao',
                    });
                    _state.version = 2;
                }
            }
        } catch (e) { console.warn('Fiscal load failed', e); }
    }

    function save() {
        _state.ultimaAtualizacao = new Date().toISOString();
        try {
            const doSave = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(_state));
            if (typeof StorageManager !== 'undefined' && StorageManager.withReclaim) {
                StorageManager.withReclaim(doSave, 'fiscal');
            } else {
                doSave();
            }
        } catch (e) {
            console.error('Fiscal save failed', e);
            if (typeof showToast === 'function') showToast('Erro ao salvar configurações fiscais', 'error');
        }
    }

    // Public API — used by other modules (sales, dashboard) when calculating profit
    function getConfig() { return JSON.parse(JSON.stringify(_state)); }
    function getEmpresas() { return (_state.empresas || []).slice(); }
    function getEmpresaPrincipal() {
        // 1ª empresa de papel 'operacao' (a Shopify roda nela), ou primeira da lista
        return (_state.empresas || []).find(e => e.papel === 'operacao') || (_state.empresas || [])[0] || null;
    }
    function getEmpresaServicos() {
        // Empresa que presta serviços (ex.: BR Serviços)
        return (_state.empresas || []).find(e => e.papel === 'servicos') || null;
    }
    function getEmpresaById(id) { return (_state.empresas || []).find(e => e.id === id) || null; }
    function getRemessa() { return Object.assign({}, _state.remessa); }
    function getShopifyFx() { return Number(_state.shopify?.fxAdicionalPct) || 0; }
    function getRegime() {
        const principal = getEmpresaPrincipal();
        return principal?.regime || _state.empresa.regime || '';
    }
    function getReconhecimento() { return _state.reconhecimento.criterio; }
    function getMoedaFuncional() {
        const principal = getEmpresaPrincipal();
        return principal?.moedaFuncional || _state.moeda.funcional || 'BRL';
    }
    function getGateways() { return _state.gateways.slice(); }
    function getGatewayById(id) { return _state.gateways.find(g => g.id === id); }
    function getCustosFixosMensal() {
        // Sums all fixed costs normalized to monthly
        return _state.custosFixos.reduce((s, c) => {
            const v = Number(c.valor) || 0;
            const div = c.recorrencia === 'trimestral' ? 3 : c.recorrencia === 'anual' ? 12 : 1;
            return s + (v / div);
        }, 0);
    }
    function getAliquotaEfetiva() {
        if (_state.tributos.aliquotaManual && _state.tributos.aliquotaEfetiva != null) {
            return Number(_state.tributos.aliquotaEfetiva);
        }
        return _calcularAliquotaEfetivaAuto();
    }

    // Calcula alíquota efetiva do Simples Nacional pelo anexo + faturamento acumulado 12m
    // Fórmula oficial: ((RBT12 × alíquota_nominal) − dedução) / RBT12
    function _calcularAliquotaEfetivaAuto() {
        // Prefere a empresa principal; cai pro legacy single-empresa se vazio
        const principal = getEmpresaPrincipal();
        const regime = principal?.regime || _state.empresa.regime;
        const anexo = principal?.anexoSimples || _state.empresa.anexoSimples;
        if (regime !== 'simples') return null;
        const rbt = Number(_state.tributos.faturamentoAcumulado12m) || 0;
        if (!rbt || !anexo) return null;

        // Tabelas Simples Nacional 2024/2025
        const TABS = {
            I: [
                [180000, 0.040, 0],
                [360000, 0.073, 5940],
                [720000, 0.095, 13860],
                [1800000, 0.107, 22500],
                [3600000, 0.143, 87300],
                [4800000, 0.190, 378000],
            ],
            II: [
                [180000, 0.045, 0],
                [360000, 0.078, 5940],
                [720000, 0.100, 13860],
                [1800000, 0.112, 22500],
                [3600000, 0.147, 85500],
                [4800000, 0.300, 720000],
            ],
            III: [
                [180000, 0.060, 0],
                [360000, 0.112, 9360],
                [720000, 0.135, 17640],
                [1800000, 0.160, 35640],
                [3600000, 0.210, 125640],
                [4800000, 0.330, 648000],
            ],
            IV: [
                [180000, 0.045, 0],
                [360000, 0.090, 8100],
                [720000, 0.102, 12420],
                [1800000, 0.140, 39780],
                [3600000, 0.220, 183780],
                [4800000, 0.330, 828000],
            ],
            V: [
                [180000, 0.155, 0],
                [360000, 0.180, 4500],
                [720000, 0.195, 9900],
                [1800000, 0.205, 17100],
                [3600000, 0.230, 62100],
                [4800000, 0.305, 540000],
            ],
        };
        const tab = TABS[anexo];
        if (!tab) return null;
        let aliquotaNominal = 0, deducao = 0;
        for (const [limite, aliq, ded] of tab) {
            if (rbt <= limite) { aliquotaNominal = aliq; deducao = ded; break; }
        }
        if (!aliquotaNominal) {
            const last = tab[tab.length - 1];
            aliquotaNominal = last[1]; deducao = last[2];
        }
        const efetiva = ((rbt * aliquotaNominal) - deducao) / rbt;
        return Math.max(0, efetiva);
    }

    // ── Render ───────────────────────────────────────────────────
    const REGIMES = [
        { id: 'simples', label: 'Simples Nacional' },
        { id: 'presumido', label: 'Lucro Presumido' },
        { id: 'real', label: 'Lucro Real' },
        { id: 'mei', label: 'MEI' },
        { id: 'offshore', label: 'Offshore (LLC, etc.)' },
    ];
    const ANEXOS = [
        { id: 'I', label: 'Anexo I — Comércio' },
        { id: 'II', label: 'Anexo II — Indústria' },
        { id: 'III', label: 'Anexo III — Serviços' },
        { id: 'IV', label: 'Anexo IV — Serviços (locação, vigilância)' },
        { id: 'V', label: 'Anexo V — Serviços profissionais' },
    ];
    const CRITERIOS = [
        { id: 'competencia', label: 'Competência (data da venda)', desc: 'Reconhece receita no momento do pedido pago' },
        { id: 'caixa', label: 'Caixa (data do payout no banco)', desc: 'Reconhece receita só quando o dinheiro entra na conta' },
        { id: 'nf', label: 'NF emitida', desc: 'Reconhece receita na emissão da nota fiscal' },
    ];
    const MOEDAS = ['BRL', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'MXN', 'ARS', 'CLP', 'COP'];
    const GATEWAYS_PRESET = [
        // ── UK Setup (Lucas) ────────────────────────────────────────
        { id: 'shopify_payments_uk_gbp', nome: 'Shopify Payments UK — Visa/MC (venda GBP)', taxaTransacaoPct: 2.0, taxaTransacaoFixa: 0.25, taxaInternacionalPct: 0, taxaFxPct: 0, taxaChargeback: 15, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'GBP' },
        { id: 'shopify_payments_uk_eur_in_gbp', nome: 'Shopify Payments UK — Visa/MC (venda EUR, payout GBP)', taxaTransacaoPct: 3.1, taxaTransacaoFixa: 0.25, taxaInternacionalPct: 0, taxaFxPct: 1.5, taxaChargeback: 15, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'GBP' },
        { id: 'shopify_payments_uk_amex', nome: 'Shopify Payments UK — American Express (EUR→GBP)', taxaTransacaoPct: 5.9, taxaTransacaoFixa: 0.25, taxaInternacionalPct: 0, taxaFxPct: 0, taxaChargeback: 15, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'GBP' },
        { id: 'klarna_uk', nome: 'Klarna (EUR→GBP)', taxaTransacaoPct: 4.99, taxaTransacaoFixa: 0.30, taxaInternacionalPct: 0, taxaFxPct: 1.5, taxaChargeback: 0, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'GBP' },
        { id: 'shopify_fx_extra', nome: 'Shopify FX Conversion (camada extra)', taxaTransacaoPct: 0, taxaTransacaoFixa: 0, taxaInternacionalPct: 0, taxaFxPct: 1.7, taxaChargeback: 0, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'GBP' },
        { id: 'payoneer', nome: 'Payoneer (saque/transferência)', taxaTransacaoPct: 0, taxaTransacaoFixa: 0, taxaInternacionalPct: 0, taxaFxPct: 2.0, taxaChargeback: 0, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'GBP' },
        // ── BR Setup ────────────────────────────────────────────────
        { id: 'shopify_payments_br', nome: 'Shopify Payments (BR)', taxaTransacaoPct: 3.99, taxaTransacaoFixa: 0.39, taxaInternacionalPct: 2.0, taxaFxPct: 1.5, taxaChargeback: 100, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'BRL' },
        { id: 'stripe', nome: 'Stripe (US/EU)', taxaTransacaoPct: 2.9, taxaTransacaoFixa: 0.30, taxaInternacionalPct: 1.5, taxaFxPct: 1.0, taxaChargeback: 15, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'USD' },
        { id: 'pagar_me', nome: 'Pagar.me', taxaTransacaoPct: 3.79, taxaTransacaoFixa: 0.39, taxaInternacionalPct: 0, taxaFxPct: 0, taxaChargeback: 0, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'BRL' },
        { id: 'mercado_pago', nome: 'Mercado Pago', taxaTransacaoPct: 4.99, taxaTransacaoFixa: 0.39, taxaInternacionalPct: 0, taxaFxPct: 0, taxaChargeback: 0, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'BRL' },
        { id: 'pagseguro', nome: 'PagSeguro', taxaTransacaoPct: 4.39, taxaTransacaoFixa: 0.40, taxaInternacionalPct: 0, taxaFxPct: 0, taxaChargeback: 0, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'BRL' },
        { id: 'pix', nome: 'PIX direto', taxaTransacaoPct: 0, taxaTransacaoFixa: 0, taxaInternacionalPct: 0, taxaFxPct: 0, taxaChargeback: 0, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'BRL' },
    ];

    const PAISES = [
        { id: 'BR', label: '🇧🇷 Brasil' },
        { id: 'UK', label: '🇬🇧 Reino Unido' },
        { id: 'US', label: '🇺🇸 Estados Unidos' },
        { id: 'PT', label: '🇵🇹 Portugal' },
        { id: 'IE', label: '🇮🇪 Irlanda' },
        { id: 'DE', label: '🇩🇪 Alemanha' },
        { id: 'NL', label: '🇳🇱 Holanda' },
        { id: 'EE', label: '🇪🇪 Estônia' },
        { id: 'AE', label: '🇦🇪 Emirados Árabes' },
        { id: 'OUTRO', label: 'Outro' },
    ];
    const PAPEIS = [
        { id: 'operacao', label: 'Operação (Shopify, e-com)' },
        { id: 'servicos', label: 'Serviços (presta pra outra empresa)' },
        { id: 'holding', label: 'Holding' },
        { id: 'pessoal', label: 'Pessoa física / autônomo' },
    ];
    const MODALIDADES_REMESSA = [
        { id: 'faturamento_servicos', label: 'Faturamento de serviços (NF da BR p/ UK)' },
        { id: 'dividendos', label: 'Dividendos / distribuição de lucros' },
        { id: 'mutuo', label: 'Mútuo (empréstimo entre empresas)' },
        { id: 'salario', label: 'Salário / Prolabore' },
        { id: 'outros', label: 'Outros' },
    ];

    function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _genId(prefix) { return `${prefix}_${Math.random().toString(36).slice(2,9)}${Date.now().toString(36).slice(-4)}`; }
    function _fmtMoney(n) {
        const v = Number(n) || 0;
        return v.toLocaleString('pt-BR', { style: 'currency', currency: _state.moeda.funcional || 'BRL' });
    }
    function _paisLabel(id) { return PAISES.find(p => p.id === id)?.label || id; }
    function _papelLabel(id) { return PAPEIS.find(p => p.id === id)?.label || id; }

    function render() {
        const panel = document.getElementById('tab-fiscal');
        if (!panel) return;
        const empresas = _state.empresas || [];
        // Empresa principal (1ª como referência pra tributos quando há apenas 1)
        const e = empresas[0] || _state.empresa;
        const r = _state.reconhecimento, m = _state.moeda, b = _state.banco, t = _state.tributos;
        const remessa = _state.remessa, shopify = _state.shopify;
        const aliqEf = getAliquotaEfetiva();
        const custosMensal = getCustosFixosMensal();

        panel.innerHTML = `
            <div class="section-header">
                <h2><i data-lucide="building-2" style="width:14px;height:14px;vertical-align:-2px"></i> Fiscal & Empresa</h2>
                <div>
                    <button class="btn btn-secondary" id="fiscal-export-btn"><i data-lucide="download" style="width:13px;height:13px;vertical-align:-2px"></i> Exportar</button>
                    <button class="btn btn-secondary" id="fiscal-import-btn"><i data-lucide="upload" style="width:13px;height:13px;vertical-align:-2px"></i> Importar</button>
                    <input type="file" id="fiscal-import-input" accept=".json" style="display:none">
                    <button class="btn btn-primary" id="fiscal-save-btn"><i data-lucide="save" style="width:13px;height:13px;vertical-align:-2px"></i> Salvar tudo</button>
                </div>
            </div>
            <p class="fiscal-intro">
                Cadastre aqui o regime tributário, taxas dos gateways, custos fixos e sócios. Esses dados são usados pra calcular o <strong>lucro real</strong> no Dashboard e em Vendas.
                ${_state.ultimaAtualizacao ? `<br><small style="color:var(--text-muted)">Última atualização: ${new Date(_state.ultimaAtualizacao).toLocaleString('pt-BR')}</small>` : ''}
            </p>

            <div class="fiscal-grid">
                <!-- ─── 1. EMPRESAS (multi-jurisdição) ─── -->
                <div class="fiscal-card fiscal-card-wide">
                    <h3 class="fiscal-card-title"><i data-lucide="building" style="width:14px;height:14px;vertical-align:-2px"></i> Empresas
                        <span class="fiscal-pill">${empresas.length} cadastrada${empresas.length === 1 ? '' : 's'}</span>
                    </h3>
                    <p class="fiscal-card-hint">Cadastre cada empresa que faz parte da estrutura (ex.: UK Operação + BR Serviços). O dashboard usa essas configurações pra calcular o lucro correto por jurisdição.</p>
                    <div id="fiscal-empresas-list"></div>
                    <div class="fiscal-empresa-presets">
                        <button type="button" class="btn btn-secondary btn-sm" id="f-emp-add-preset" data-preset="uk_operacao"><i data-lucide="plus" style="width:13px;height:13px;vertical-align:-2px"></i> + UK Operação (Ltd)</button>
                        <button type="button" class="btn btn-secondary btn-sm" id="f-emp-add-preset-2" data-preset="br_servicos"><i data-lucide="plus" style="width:13px;height:13px;vertical-align:-2px"></i> + BR Serviços (Simples)</button>
                        <button type="button" class="btn btn-secondary btn-sm" id="f-emp-add-blank"><i data-lucide="plus" style="width:13px;height:13px;vertical-align:-2px"></i> Adicionar vazia</button>
                    </div>
                </div>

                <!-- ─── 1b. REMESSA entre empresas (UK → BR etc.) ─── -->
                <div class="fiscal-card fiscal-card-wide">
                    <h3 class="fiscal-card-title"><i data-lucide="arrow-right-left" style="width:14px;height:14px;vertical-align:-2px"></i> Remessa entre empresas
                        ${remessa.habilitado ? '<span class="fiscal-pill fiscal-pill-good">Ativa</span>' : '<span class="fiscal-pill" style="background:rgba(150,150,150,0.15);color:var(--text-muted)">Desativada</span>'}
                    </h3>
                    <p class="fiscal-card-hint">Modela o fluxo de dinheiro entre empresas (ex.: lucro da UK Ltd que vira faturamento de serviços da PJ BR). <strong>Imposto BR só conta no momento da remessa.</strong></p>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="fiscal-check">
                                <input type="checkbox" id="f-rem-on" ${remessa.habilitado ? 'checked' : ''}>
                                Habilitar remessa entre empresas
                            </label>
                        </div>
                    </div>
                    <div id="f-rem-wrap" style="${remessa.habilitado ? '' : 'display:none'}">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Empresa origem (onde o lucro está)</label>
                                <select class="input" id="f-rem-origem">
                                    <option value="">— Selecione —</option>
                                    ${empresas.map(emp => `<option value="${emp.id}" ${remessa.origemEmpresaId === emp.id ? 'selected' : ''}>${_esc(emp.nome || 'Sem nome')} (${emp.pais || '?'})</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Empresa destino (onde vai entrar)</label>
                                <select class="input" id="f-rem-destino">
                                    <option value="">— Selecione —</option>
                                    ${empresas.map(emp => `<option value="${emp.id}" ${remessa.destinoEmpresaId === emp.id ? 'selected' : ''}>${_esc(emp.nome || 'Sem nome')} (${emp.pais || '?'})</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Modalidade da remessa</label>
                                <select class="input" id="f-rem-modalidade">
                                    ${MODALIDADES_REMESSA.map(o => `<option value="${o.id}" ${remessa.modalidade === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Frequência</label>
                                <select class="input" id="f-rem-freq">
                                    <option value="mensal" ${remessa.frequencia === 'mensal' ? 'selected' : ''}>Mensal</option>
                                    <option value="trimestral" ${remessa.frequencia === 'trimestral' ? 'selected' : ''}>Trimestral</option>
                                    <option value="anual" ${remessa.frequencia === 'anual' ? 'selected' : ''}>Anual</option>
                                    <option value="on_demand" ${remessa.frequencia === 'on_demand' ? 'selected' : ''}>Quando precisar</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>% Tributação na remessa <span style="font-weight:400;font-size:0.7rem;color:var(--text-muted)">(ex: Simples Anexo III ~6%)</span></label>
                                <input type="number" step="0.01" class="input" id="f-rem-pct" value="${remessa.percentualTributacaoNaRemessa}">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Observações</label>
                                <textarea class="input" id="f-rem-obs" placeholder="Ex.: NF emitida toda quinta-feira, câmbio comercial do banco" style="min-height:50px">${_esc(remessa.obs || '')}</textarea>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ─── 1c. SHOPIFY — FX adicional ─── -->
                <div class="fiscal-card">
                    <h3 class="fiscal-card-title"><i data-lucide="store" style="width:14px;height:14px;vertical-align:-2px"></i> Shopify — taxa de FX adicional
                        <span class="fiscal-pill">${shopify.fxAdicionalPct}%</span>
                    </h3>
                    <p class="fiscal-card-hint">Quando a Shopify converte da moeda da venda para a moeda do payout, ela cobra essa taxa ALÉM da do gateway. Tipicamente 1,5–1,9%.</p>
                    <div class="form-row">
                        <div class="form-group">
                            <label>% FX adicional Shopify</label>
                            <div style="display:flex;gap:0.75rem;align-items:center">
                                <input type="range" min="0" max="3" step="0.05" id="f-shopify-fx-range" value="${shopify.fxAdicionalPct}" style="flex:1">
                                <input type="number" step="0.01" min="0" max="10" class="input" id="f-shopify-fx-num" value="${shopify.fxAdicionalPct}" style="max-width:90px">
                            </div>
                            <small style="font-size:0.7rem;color:var(--text-muted)">Padrão 1,7%. Confere no relatório de payout Shopify pra ajustar.</small>
                        </div>
                    </div>
                </div>

                <!-- ─── 2. RECONHECIMENTO DE RECEITA ─── -->
                <div class="fiscal-card">
                    <h3 class="fiscal-card-title"><i data-lucide="calendar-check" style="width:14px;height:14px;vertical-align:-2px"></i> Reconhecimento de receita</h3>
                    <p class="fiscal-card-hint">Decide quando uma venda vira "lucro" no seu dashboard. Mudar isso muda TODO número.</p>
                    <div class="fiscal-radio-grid">
                        ${CRITERIOS.map(c => `
                            <label class="fiscal-radio ${r.criterio === c.id ? 'fiscal-radio-checked' : ''}">
                                <input type="radio" name="f-criterio" value="${c.id}" ${r.criterio === c.id ? 'checked' : ''}>
                                <div>
                                    <div class="fiscal-radio-title">${c.label}</div>
                                    <div class="fiscal-radio-desc">${c.desc}</div>
                                </div>
                            </label>
                        `).join('')}
                    </div>
                </div>

                <!-- ─── 3. MOEDAS ─── -->
                <div class="fiscal-card">
                    <h3 class="fiscal-card-title"><i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i> Moedas</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Moeda funcional (a moeda principal do dashboard)</label>
                            <select class="input" id="f-moeda-func">
                                ${MOEDAS.map(c => `<option value="${c}" ${m.funcional === c ? 'selected' : ''}>${c}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Moedas operadas (clique pra alternar)</label>
                            <div class="fiscal-chips">
                                ${MOEDAS.map(c => `<button type="button" class="fiscal-chip ${m.operadas.includes(c) ? 'fiscal-chip-on' : ''}" data-moeda="${c}">${c}</button>`).join('')}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ─── 4. GATEWAYS DE PAGAMENTO ─── -->
                <div class="fiscal-card fiscal-card-wide">
                    <h3 class="fiscal-card-title"><i data-lucide="credit-card" style="width:14px;height:14px;vertical-align:-2px"></i> Gateways de pagamento</h3>
                    <p class="fiscal-card-hint">Cadastra cada gateway com TODAS as camadas de taxa. O dashboard vai descompor cada uma no waterfall do lucro.</p>
                    <div id="fiscal-gateways-list"></div>
                    <div class="fiscal-gateway-add">
                        <select class="input" id="f-gw-preset">
                            <option value="">— Adicionar gateway —</option>
                            ${GATEWAYS_PRESET.map(g => `<option value="${g.id}">${g.nome}</option>`).join('')}
                            <option value="custom">+ Personalizado…</option>
                        </select>
                        <button type="button" class="btn btn-secondary btn-sm" id="f-gw-add-btn">Adicionar</button>
                    </div>
                </div>

                <!-- ─── 5. BANCO ─── -->
                <div class="fiscal-card">
                    <h3 class="fiscal-card-title"><i data-lucide="landmark" style="width:14px;height:14px;vertical-align:-2px"></i> Banco — taxas de operação</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label>PIX (R$ por transação)</label>
                            <input type="number" step="0.01" class="input" id="f-bank-pix" value="${b.taxaPix}">
                        </div>
                        <div class="form-group">
                            <label>TED (R$ por transação)</label>
                            <input type="number" step="0.01" class="input" id="f-bank-ted" value="${b.taxaTed}">
                        </div>
                        <div class="form-group">
                            <label>Boleto (R$ por unidade)</label>
                            <input type="number" step="0.01" class="input" id="f-bank-bol" value="${b.taxaBoleto}">
                        </div>
                        <div class="form-group">
                            <label>Outras (R$ mensal estimado)</label>
                            <input type="number" step="0.01" class="input" id="f-bank-out" value="${b.taxaOutros}">
                        </div>
                    </div>
                </div>

                <!-- ─── 6. CUSTOS FIXOS ─── -->
                <div class="fiscal-card fiscal-card-wide">
                    <h3 class="fiscal-card-title"><i data-lucide="receipt" style="width:14px;height:14px;vertical-align:-2px"></i> Custos fixos
                        <span class="fiscal-pill">Total mensal: ${_fmtMoney(custosMensal)}</span>
                    </h3>
                    <p class="fiscal-card-hint">Despesas recorrentes que não dependem das vendas: aluguel, ferramentas, salários, contador, etc.</p>
                    <div id="fiscal-custos-list"></div>
                    <button type="button" class="btn btn-secondary btn-sm" id="f-custo-add-btn"><i data-lucide="plus" style="width:13px;height:13px;vertical-align:-2px"></i> Adicionar custo fixo</button>
                </div>

                <!-- ─── 7. SÓCIOS ─── -->
                <div class="fiscal-card fiscal-card-wide">
                    <h3 class="fiscal-card-title"><i data-lucide="users" style="width:14px;height:14px;vertical-align:-2px"></i> Sócios e remuneração</h3>
                    <p class="fiscal-card-hint">Prolabore (INSS+IR) vs distribuição de lucros (isenta). Mudar o mix muda o imposto que você paga.</p>
                    <div id="fiscal-socios-list"></div>
                    <button type="button" class="btn btn-secondary btn-sm" id="f-socio-add-btn"><i data-lucide="user-plus" style="width:13px;height:13px;vertical-align:-2px"></i> Adicionar sócio</button>
                </div>

                <!-- ─── 8. TRIBUTOS ─── -->
                <div class="fiscal-card">
                    <h3 class="fiscal-card-title"><i data-lucide="percent" style="width:14px;height:14px;vertical-align:-2px"></i> Tributos
                        ${aliqEf != null ? `<span class="fiscal-pill fiscal-pill-good">Alíquota efetiva: ${(aliqEf * 100).toFixed(2)}%</span>` : ''}
                    </h3>
                    ${e.regime === 'simples' ? `
                        <div class="form-row">
                            <div class="form-group">
                                <label>Faturamento acumulado dos últimos 12 meses (RBT12)</label>
                                <input type="number" step="0.01" class="input" id="f-trib-rbt" value="${t.faturamentoAcumulado12m}" placeholder="Ex.: 720000">
                                <small>Usado pra calcular sua alíquota efetiva pelo anexo escolhido.</small>
                            </div>
                        </div>
                    ` : e.regime === 'presumido' || e.regime === 'real' ? `
                        <div class="form-row">
                            <div class="form-group">
                                <label>IRPJ (%)</label>
                                <input type="number" step="0.01" class="input" id="f-trib-irpj" value="${t.irpjPct}">
                            </div>
                            <div class="form-group">
                                <label>CSLL (%)</label>
                                <input type="number" step="0.01" class="input" id="f-trib-csll" value="${t.csllPct}">
                            </div>
                            <div class="form-group">
                                <label>PIS (%)</label>
                                <input type="number" step="0.01" class="input" id="f-trib-pis" value="${t.pisPct}">
                            </div>
                            <div class="form-group">
                                <label>COFINS (%)</label>
                                <input type="number" step="0.01" class="input" id="f-trib-cofins" value="${t.cofinsPct}">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>ISS (%) — só serviço</label>
                                <input type="number" step="0.01" class="input" id="f-trib-iss" value="${t.issPct}">
                            </div>
                            <div class="form-group">
                                <label>ICMS (%) — só comércio</label>
                                <input type="number" step="0.01" class="input" id="f-trib-icms" value="${t.icmsPct}">
                            </div>
                        </div>
                    ` : ''}
                    <div class="form-row">
                        <div class="form-group">
                            <label class="fiscal-check">
                                <input type="checkbox" id="f-trib-manual" ${t.aliquotaManual ? 'checked' : ''}>
                                Definir alíquota efetiva manual (sobrescreve o cálculo automático)
                            </label>
                        </div>
                        <div class="form-group" id="f-trib-manual-wrap" style="${t.aliquotaManual ? '' : 'display:none'}">
                            <label>Alíquota efetiva manual (%)</label>
                            <input type="number" step="0.001" class="input" id="f-trib-aliq" value="${t.aliquotaEfetiva != null ? (t.aliquotaEfetiva * 100).toFixed(3) : ''}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Observações tributárias</label>
                            <textarea class="input" id="f-trib-obs" placeholder="Ex.: incentivo fiscal, regime especial, etc." style="min-height:60px">${_esc(t.obs || '')}</textarea>
                        </div>
                    </div>
                </div>
            </div>

            <div class="fiscal-footer">
                <button class="btn btn-primary btn-lg" id="fiscal-save-btn-2"><i data-lucide="save" style="width:14px;height:14px;vertical-align:-2px"></i> Salvar configurações</button>
            </div>
        `;

        _renderEmpresasList();
        _renderGatewaysList();
        _renderCustosList();
        _renderSociosList();
        _wireEvents();
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    }

    function _renderEmpresasList() {
        const box = document.getElementById('fiscal-empresas-list');
        if (!box) return;
        const empresas = _state.empresas || [];
        if (!empresas.length) {
            box.innerHTML = '<div class="fiscal-empty">Nenhuma empresa cadastrada. Use os botões abaixo pra começar.</div>';
            return;
        }
        box.innerHTML = empresas.map(emp => `
            <div class="fiscal-empresa-item" data-emp="${emp.id}">
                <div class="fiscal-empresa-header">
                    <span class="fiscal-empresa-flag">${_paisLabel(emp.pais).split(' ')[0]}</span>
                    <strong class="fiscal-empresa-name">${_esc(emp.nome || 'Sem nome')}</strong>
                    <span class="fiscal-empresa-role">${_esc(_papelLabel(emp.papel))}</span>
                    <button type="button" class="fiscal-row-x" data-emp-del="${emp.id}" title="Remover">&times;</button>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Razão social / Nome</label>
                        <input type="text" class="input" data-emp-field="nome" value="${_esc(emp.nome || '')}" placeholder="Ex.: Lucas Sunglasses Ltd">
                    </div>
                    <div class="form-group">
                        <label>${emp.pais === 'BR' ? 'CNPJ' : emp.pais === 'UK' ? 'Company Number' : emp.pais === 'US' ? 'EIN' : 'Identificador'}</label>
                        <input type="text" class="input" data-emp-field="identificador" value="${_esc(emp.identificador || '')}" placeholder="${emp.pais === 'BR' ? '00.000.000/0001-00' : '12345678'}">
                    </div>
                    <div class="form-group">
                        <label>País</label>
                        <select class="input" data-emp-field="pais">
                            ${PAISES.map(p => `<option value="${p.id}" ${emp.pais === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Papel</label>
                        <select class="input" data-emp-field="papel">
                            ${PAPEIS.map(p => `<option value="${p.id}" ${emp.papel === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Regime tributário</label>
                        <select class="input" data-emp-field="regime">
                            <option value="">— Selecione —</option>
                            ${REGIMES.map(o => `<option value="${o.id}" ${emp.regime === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
                        </select>
                    </div>
                    ${emp.regime === 'simples' ? `
                        <div class="form-group">
                            <label>Anexo do Simples</label>
                            <select class="input" data-emp-field="anexoSimples">
                                <option value="">— Selecione —</option>
                                ${ANEXOS.map(o => `<option value="${o.id}" ${emp.anexoSimples === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
                            </select>
                        </div>
                    ` : ''}
                    <div class="form-group">
                        <label>Moeda funcional</label>
                        <select class="input" data-emp-field="moedaFuncional">
                            ${MOEDAS.map(c => `<option value="${c}" ${emp.moedaFuncional === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>
        `).join('');
    }

    function _renderGatewaysList() {
        const box = document.getElementById('fiscal-gateways-list');
        if (!box) return;
        if (!_state.gateways.length) {
            box.innerHTML = '<div class="fiscal-empty">Nenhum gateway cadastrado ainda.</div>';
            return;
        }
        box.innerHTML = _state.gateways.map(g => `
            <div class="fiscal-gw-item" data-gw="${g.id}">
                <div class="fiscal-gw-header">
                    <strong>${_esc(g.nome)}</strong>
                    <span class="fiscal-gw-moeda">${g.moeda || 'BRL'}</span>
                    <button type="button" class="fiscal-gw-x" data-gw-del="${g.id}" title="Remover">&times;</button>
                </div>
                <div class="fiscal-gw-grid">
                    <label>Taxa transação (%) <input type="number" step="0.01" data-gw-field="taxaTransacaoPct" value="${g.taxaTransacaoPct}"></label>
                    <label>Taxa fixa por trans. <input type="number" step="0.01" data-gw-field="taxaTransacaoFixa" value="${g.taxaTransacaoFixa}"></label>
                    <label>Internacional (%) <input type="number" step="0.01" data-gw-field="taxaInternacionalPct" value="${g.taxaInternacionalPct}"></label>
                    <label>FX (%) <input type="number" step="0.01" data-gw-field="taxaFxPct" value="${g.taxaFxPct}"></label>
                    <label>Chargeback (R$) <input type="number" step="0.01" data-gw-field="taxaChargeback" value="${g.taxaChargeback}"></label>
                    <label>Reserva (%) <input type="number" step="0.01" data-gw-field="reservaPct" value="${g.reservaPct}"></label>
                    <label>Reserva (dias) <input type="number" step="1" data-gw-field="reservaDias" value="${g.reservaDias}"></label>
                    <label>Plano mensal <input type="number" step="0.01" data-gw-field="planoMensal" value="${g.planoMensal}"></label>
                </div>
            </div>
        `).join('');
    }

    function _renderCustosList() {
        const box = document.getElementById('fiscal-custos-list');
        if (!box) return;
        if (!_state.custosFixos.length) {
            box.innerHTML = '<div class="fiscal-empty">Nenhum custo fixo cadastrado.</div>';
            return;
        }
        box.innerHTML = `
            <table class="fiscal-table">
                <thead><tr><th>Nome</th><th>Valor</th><th>Recorrência</th><th>Rateio</th><th></th></tr></thead>
                <tbody>
                ${_state.custosFixos.map(c => `
                    <tr data-custo="${c.id}">
                        <td><input type="text" data-cf-field="nome" value="${_esc(c.nome)}" placeholder="Ex.: Shopify Plan"></td>
                        <td><input type="number" step="0.01" data-cf-field="valor" value="${c.valor}" style="max-width:120px"></td>
                        <td>
                            <select data-cf-field="recorrencia">
                                <option value="mensal" ${c.recorrencia === 'mensal' ? 'selected' : ''}>Mensal</option>
                                <option value="trimestral" ${c.recorrencia === 'trimestral' ? 'selected' : ''}>Trimestral</option>
                                <option value="anual" ${c.recorrencia === 'anual' ? 'selected' : ''}>Anual</option>
                            </select>
                        </td>
                        <td>
                            <select data-cf-field="rateio">
                                <option value="faturamento" ${c.rateio === 'faturamento' ? 'selected' : ''}>Por faturamento</option>
                                <option value="pedidos" ${c.rateio === 'pedidos' ? 'selected' : ''}>Por pedidos</option>
                                <option value="fixo" ${c.rateio === 'fixo' ? 'selected' : ''}>Fixo (todas lojas)</option>
                                <option value="manual" ${c.rateio === 'manual' ? 'selected' : ''}>Manual</option>
                            </select>
                        </td>
                        <td><button type="button" class="fiscal-row-x" data-cf-del="${c.id}">&times;</button></td>
                    </tr>
                `).join('')}
                </tbody>
            </table>
        `;
    }

    function _renderSociosList() {
        const box = document.getElementById('fiscal-socios-list');
        if (!box) return;
        if (!_state.socios.length) {
            box.innerHTML = '<div class="fiscal-empty">Nenhum sócio cadastrado.</div>';
            return;
        }
        const totalPct = _state.socios.reduce((s, x) => s + (Number(x.percentual) || 0), 0);
        box.innerHTML = `
            <div class="fiscal-socios-sum">Soma dos % de participação: <strong>${totalPct.toFixed(1)}%</strong> ${totalPct === 100 ? '<i data-lucide="check" style="width:13px;height:13px;vertical-align:-2px"></i>' : (totalPct > 100 ? '<i data-lucide="alert-triangle" style="width:13px;height:13px;vertical-align:-2px"></i> excede 100' : '<i data-lucide="alert-triangle" style="width:13px;height:13px;vertical-align:-2px"></i> faltam ' + (100 - totalPct).toFixed(1) + '%')}</div>
            <table class="fiscal-table">
                <thead><tr><th>Nome</th><th>% Participação</th><th>Modalidade</th><th>Prolabore mensal</th><th>Distribuição</th><th></th></tr></thead>
                <tbody>
                ${_state.socios.map(s => `
                    <tr data-socio="${s.id}">
                        <td><input type="text" data-sc-field="nome" value="${_esc(s.nome)}" placeholder="Nome do sócio"></td>
                        <td><input type="number" step="0.1" data-sc-field="percentual" value="${s.percentual}" style="max-width:90px"></td>
                        <td>
                            <select data-sc-field="modalidade">
                                <option value="prolabore" ${s.modalidade === 'prolabore' ? 'selected' : ''}>Só prolabore</option>
                                <option value="distribuicao" ${s.modalidade === 'distribuicao' ? 'selected' : ''}>Só distribuição</option>
                                <option value="hibrido" ${s.modalidade === 'hibrido' ? 'selected' : ''}>Híbrido</option>
                            </select>
                        </td>
                        <td><input type="number" step="0.01" data-sc-field="valorProlabore" value="${s.valorProlabore || 0}" style="max-width:120px"></td>
                        <td>
                            <select data-sc-field="frequenciaDistribuicao">
                                <option value="mensal" ${s.frequenciaDistribuicao === 'mensal' ? 'selected' : ''}>Mensal</option>
                                <option value="trimestral" ${s.frequenciaDistribuicao === 'trimestral' ? 'selected' : ''}>Trimestral</option>
                                <option value="anual" ${s.frequenciaDistribuicao === 'anual' ? 'selected' : ''}>Anual</option>
                            </select>
                        </td>
                        <td><button type="button" class="fiscal-row-x" data-sc-del="${s.id}">&times;</button></td>
                    </tr>
                `).join('')}
                </tbody>
            </table>
        `;
    }

    function _wireEvents() {
        const $ = id => document.getElementById(id);

        // ── Empresas (multi) — eventos delegados na lista
        document.getElementById('fiscal-empresas-list')?.addEventListener('input', (ev) => {
            const tgt = ev.target.closest('[data-emp-field]');
            if (!tgt) return;
            const item = ev.target.closest('.fiscal-empresa-item');
            const id = item?.dataset.emp;
            const emp = _state.empresas.find(e => e.id === id);
            if (emp) emp[tgt.dataset.empField] = tgt.value;
        });
        document.getElementById('fiscal-empresas-list')?.addEventListener('change', (ev) => {
            const tgt = ev.target.closest('[data-emp-field]');
            if (!tgt) return;
            const item = ev.target.closest('.fiscal-empresa-item');
            const id = item?.dataset.emp;
            const emp = _state.empresas.find(e => e.id === id);
            if (!emp) return;
            const field = tgt.dataset.empField;
            emp[field] = tgt.value;
            // Re-render se mudou pais ou regime (mostra/esconde Anexo)
            if (field === 'pais' || field === 'regime') render();
        });
        document.getElementById('fiscal-empresas-list')?.addEventListener('click', (ev) => {
            const x = ev.target.closest('[data-emp-del]');
            if (!x) return;
            _state.empresas = _state.empresas.filter(e => e.id !== x.dataset.empDel);
            render();
        });
        // Botões de preset (UK Operação / BR Serviços / Vazia)
        $('f-emp-add-preset')?.addEventListener('click', () => {
            _state.empresas.push({
                id: _genId('emp'),
                nome: 'UK Operação Ltd',
                identificador: '',
                pais: 'UK',
                regime: 'offshore',
                anexoSimples: '',
                atividade: 'comercio',
                uf: '',
                municipio: 'London',
                moedaFuncional: 'GBP',
                papel: 'operacao',
            });
            render();
        });
        $('f-emp-add-preset-2')?.addEventListener('click', () => {
            _state.empresas.push({
                id: _genId('emp'),
                nome: 'BR Serviços ME',
                identificador: '',
                pais: 'BR',
                regime: 'simples',
                anexoSimples: 'III',
                atividade: 'servico',
                uf: '',
                municipio: '',
                moedaFuncional: 'BRL',
                papel: 'servicos',
            });
            render();
        });
        $('f-emp-add-blank')?.addEventListener('click', () => {
            _state.empresas.push({
                id: _genId('emp'),
                nome: '', identificador: '', pais: 'BR', regime: '', anexoSimples: '',
                atividade: 'comercio', uf: '', municipio: '', moedaFuncional: 'BRL', papel: 'operacao',
            });
            render();
        });

        // ── Remessa entre empresas
        $('f-rem-on')?.addEventListener('change', (e) => {
            _state.remessa.habilitado = e.target.checked;
            const w = $('f-rem-wrap');
            if (w) w.style.display = e.target.checked ? '' : 'none';
        });
        $('f-rem-origem')?.addEventListener('change', (e) => { _state.remessa.origemEmpresaId = e.target.value; });
        $('f-rem-destino')?.addEventListener('change', (e) => { _state.remessa.destinoEmpresaId = e.target.value; });
        $('f-rem-modalidade')?.addEventListener('change', (e) => { _state.remessa.modalidade = e.target.value; });
        $('f-rem-freq')?.addEventListener('change', (e) => { _state.remessa.frequencia = e.target.value; });
        $('f-rem-pct')?.addEventListener('input', (e) => { _state.remessa.percentualTributacaoNaRemessa = parseFloat(e.target.value) || 0; });
        $('f-rem-obs')?.addEventListener('input', (e) => { _state.remessa.obs = e.target.value; });

        // ── Shopify FX (slider + número espelham um ao outro)
        const fxRange = $('f-shopify-fx-range');
        const fxNum = $('f-shopify-fx-num');
        const updateFx = (v) => {
            const val = Math.max(0, Math.min(10, parseFloat(v) || 0));
            _state.shopify.fxAdicionalPct = val;
            if (fxRange && Math.abs(parseFloat(fxRange.value) - val) > 0.001) fxRange.value = val;
            if (fxNum && Math.abs(parseFloat(fxNum.value) - val) > 0.001) fxNum.value = val;
            const pill = document.querySelector('.fiscal-card-title .fiscal-pill');
            // (pill is updated on next render)
        };
        fxRange?.addEventListener('input', (e) => updateFx(e.target.value));
        fxNum?.addEventListener('input', (e) => updateFx(e.target.value));

        // ── Reconhecimento
        document.querySelectorAll('input[name="f-criterio"]').forEach(rb => {
            rb.addEventListener('change', () => {
                _state.reconhecimento.criterio = rb.value;
                document.querySelectorAll('.fiscal-radio').forEach(el => el.classList.toggle('fiscal-radio-checked', el.querySelector('input').checked));
            });
        });

        // ── Moeda
        $('f-moeda-func')?.addEventListener('change', (e) => {
            _state.moeda.funcional = e.target.value;
            if (!_state.moeda.operadas.includes(e.target.value)) _state.moeda.operadas.push(e.target.value);
        });
        document.querySelectorAll('.fiscal-chip').forEach(ch => {
            ch.addEventListener('click', () => {
                const m = ch.dataset.moeda;
                if (_state.moeda.operadas.includes(m)) {
                    _state.moeda.operadas = _state.moeda.operadas.filter(x => x !== m);
                } else {
                    _state.moeda.operadas.push(m);
                }
                ch.classList.toggle('fiscal-chip-on');
            });
        });

        // ── Banco
        $('f-bank-pix')?.addEventListener('input', (e) => _state.banco.taxaPix = parseFloat(e.target.value) || 0);
        $('f-bank-ted')?.addEventListener('input', (e) => _state.banco.taxaTed = parseFloat(e.target.value) || 0);
        $('f-bank-bol')?.addEventListener('input', (e) => _state.banco.taxaBoleto = parseFloat(e.target.value) || 0);
        $('f-bank-out')?.addEventListener('input', (e) => _state.banco.taxaOutros = parseFloat(e.target.value) || 0);

        // ── Gateways
        $('f-gw-add-btn')?.addEventListener('click', () => {
            const sel = $('f-gw-preset');
            const choice = sel.value;
            if (!choice) return;
            if (choice === 'custom') {
                _state.gateways.push({ id: _genId('gw'), nome: 'Personalizado', taxaTransacaoPct: 0, taxaTransacaoFixa: 0, taxaInternacionalPct: 0, taxaFxPct: 0, taxaChargeback: 0, reservaPct: 0, reservaDias: 0, planoMensal: 0, moeda: 'BRL' });
            } else {
                const preset = GATEWAYS_PRESET.find(p => p.id === choice);
                if (preset) _state.gateways.push(Object.assign({}, preset, { id: _genId('gw') }));
            }
            sel.value = '';
            _renderGatewaysList();
            if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
        });
        document.getElementById('fiscal-gateways-list')?.addEventListener('input', (e) => {
            const tgt = e.target.closest('[data-gw-field]');
            if (!tgt) return;
            const item = e.target.closest('.fiscal-gw-item');
            const id = item?.dataset.gw;
            const gw = _state.gateways.find(g => g.id === id);
            if (gw) gw[tgt.dataset.gwField] = parseFloat(tgt.value) || 0;
        });
        document.getElementById('fiscal-gateways-list')?.addEventListener('click', (e) => {
            const x = e.target.closest('[data-gw-del]');
            if (!x) return;
            _state.gateways = _state.gateways.filter(g => g.id !== x.dataset.gwDel);
            _renderGatewaysList();
        });

        // ── Custos
        $('f-custo-add-btn')?.addEventListener('click', () => {
            _state.custosFixos.push({ id: _genId('cf'), nome: '', valor: 0, recorrencia: 'mensal', rateio: 'faturamento', lojasIds: [], obs: '' });
            _renderCustosList();
            render(); // re-render to update header total
        });
        document.getElementById('fiscal-custos-list')?.addEventListener('input', (e) => {
            const tgt = e.target.closest('[data-cf-field]');
            if (!tgt) return;
            const row = e.target.closest('tr[data-custo]');
            const id = row?.dataset.custo;
            const cf = _state.custosFixos.find(c => c.id === id);
            if (!cf) return;
            const v = tgt.value;
            cf[tgt.dataset.cfField] = (tgt.type === 'number') ? (parseFloat(v) || 0) : v;
        });
        document.getElementById('fiscal-custos-list')?.addEventListener('click', (e) => {
            const x = e.target.closest('[data-cf-del]');
            if (!x) return;
            _state.custosFixos = _state.custosFixos.filter(c => c.id !== x.dataset.cfDel);
            render();
        });

        // ── Sócios
        $('f-socio-add-btn')?.addEventListener('click', () => {
            _state.socios.push({ id: _genId('sc'), nome: '', percentual: 0, modalidade: 'hibrido', valorProlabore: 0, frequenciaDistribuicao: 'mensal' });
            _renderSociosList();
        });
        document.getElementById('fiscal-socios-list')?.addEventListener('input', (e) => {
            const tgt = e.target.closest('[data-sc-field]');
            if (!tgt) return;
            const row = e.target.closest('tr[data-socio]');
            const id = row?.dataset.socio;
            const sc = _state.socios.find(s => s.id === id);
            if (!sc) return;
            sc[tgt.dataset.scField] = (tgt.type === 'number') ? (parseFloat(tgt.value) || 0) : tgt.value;
            _renderSociosList();
        });
        document.getElementById('fiscal-socios-list')?.addEventListener('click', (e) => {
            const x = e.target.closest('[data-sc-del]');
            if (!x) return;
            _state.socios = _state.socios.filter(s => s.id !== x.dataset.scDel);
            _renderSociosList();
        });

        // ── Tributos
        $('f-trib-rbt')?.addEventListener('input', (e) => { _state.tributos.faturamentoAcumulado12m = parseFloat(e.target.value) || 0; });
        $('f-trib-irpj')?.addEventListener('input', (e) => { _state.tributos.irpjPct = parseFloat(e.target.value) || 0; });
        $('f-trib-csll')?.addEventListener('input', (e) => { _state.tributos.csllPct = parseFloat(e.target.value) || 0; });
        $('f-trib-pis')?.addEventListener('input', (e) => { _state.tributos.pisPct = parseFloat(e.target.value) || 0; });
        $('f-trib-cofins')?.addEventListener('input', (e) => { _state.tributos.cofinsPct = parseFloat(e.target.value) || 0; });
        $('f-trib-iss')?.addEventListener('input', (e) => { _state.tributos.issPct = parseFloat(e.target.value) || 0; });
        $('f-trib-icms')?.addEventListener('input', (e) => { _state.tributos.icmsPct = parseFloat(e.target.value) || 0; });
        $('f-trib-obs')?.addEventListener('input', (e) => { _state.tributos.obs = e.target.value; });
        $('f-trib-manual')?.addEventListener('change', (e) => {
            _state.tributos.aliquotaManual = e.target.checked;
            const w = $('f-trib-manual-wrap');
            if (w) w.style.display = e.target.checked ? '' : 'none';
        });
        $('f-trib-aliq')?.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            _state.tributos.aliquotaEfetiva = Number.isFinite(v) ? v / 100 : null;
        });

        // ── Salvar / Exportar / Importar
        const onSave = () => {
            save();
            if (typeof showToast === 'function') showToast('Configurações fiscais salvas!', 'success');
            render(); // re-render shows recalculated effective rate
            if (typeof EventBus !== 'undefined') EventBus.emit('fiscalConfigChanged');
        };
        $('fiscal-save-btn')?.addEventListener('click', onSave);
        $('fiscal-save-btn-2')?.addEventListener('click', onSave);

        $('fiscal-export-btn')?.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(_state, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `fiscal-config-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
        });
        $('fiscal-import-btn')?.addEventListener('click', () => $('fiscal-import-input')?.click());
        $('fiscal-import-input')?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => {
                try {
                    const parsed = JSON.parse(r.result);
                    _state = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_CONFIG)), parsed);
                    save();
                    render();
                    if (typeof showToast === 'function') showToast('Configurações importadas!', 'success');
                } catch (err) {
                    if (typeof showToast === 'function') showToast('Arquivo JSON inválido', 'error');
                }
            };
            r.readAsText(f);
            e.target.value = '';
        });
    }

    function init() {
        load();
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (tab) => {
                if (tab === 'fiscal') render();
            });
        }
        // First render if user already on fiscal tab
        if (document.querySelector('#tab-fiscal.active')) render();
    }

    return {
        init, render, load, save,
        getConfig, getRegime, getReconhecimento, getMoedaFuncional,
        getEmpresas, getEmpresaPrincipal, getEmpresaServicos, getEmpresaById,
        getRemessa, getShopifyFx,
        getGateways, getGatewayById, getCustosFixosMensal, getAliquotaEfetiva,
    };
})();

if (typeof window !== 'undefined') window.FiscalModule = FiscalModule;
