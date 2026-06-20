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
        version: 1,
        empresa: {
            nome: '',
            cnpj: '',
            regime: '',              // simples | presumido | real | mei | offshore
            anexoSimples: '',        // I, II, III, IV, V (só se regime=simples)
            atividade: 'comercio',   // comercio | servico | industria
            uf: '',
            municipio: '',
        },
        reconhecimento: {
            criterio: 'caixa',       // competencia | caixa | nf
            obs: '',
        },
        moeda: {
            funcional: 'BRL',
            operadas: ['BRL'],
        },
        gateways: [
            // { id, nome, ativo, taxaTransacaoPct, taxaTransacaoFixa, taxaInternacionalPct, taxaFxPct, taxaChargeback, reservaPct, reservaDias, planoMensal, moeda }
        ],
        banco: {
            taxaPix: 0,
            taxaTed: 0,
            taxaBoleto: 0,
            taxaOutros: 0,
        },
        custosFixos: [
            // { id, nome, valor, recorrencia: mensal|trimestral|anual, rateio: faturamento|pedidos|fixo|manual, lojasIds: [], obs }
        ],
        socios: [
            // { id, nome, percentual, modalidade: prolabore|distribuicao|hibrido, valorProlabore, frequenciaDistribuicao: mensal|trimestral|anual }
        ],
        tributos: {
            aliquotaEfetiva: null,    // calculado ou manual
            aliquotaManual: false,
            faturamentoAcumulado12m: 0, // pra calcular alíquota efetiva do Simples
            irpjPct: 0,
            csllPct: 0,
            pisPct: 0,
            cofinsPct: 0,
            issPct: 0,
            icmsPct: 0,
            obs: '',
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
                ['empresa','reconhecimento','moeda','banco','tributos'].forEach(k => {
                    _state[k] = Object.assign({}, DEFAULT_CONFIG[k], parsed[k] || {});
                });
                _state.gateways = Array.isArray(parsed.gateways) ? parsed.gateways : [];
                _state.custosFixos = Array.isArray(parsed.custosFixos) ? parsed.custosFixos : [];
                _state.socios = Array.isArray(parsed.socios) ? parsed.socios : [];
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
    function getRegime() { return _state.empresa.regime; }
    function getReconhecimento() { return _state.reconhecimento.criterio; }
    function getMoedaFuncional() { return _state.moeda.funcional || 'BRL'; }
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
        if (_state.empresa.regime !== 'simples') return null;
        const rbt = Number(_state.tributos.faturamentoAcumulado12m) || 0;
        const anexo = _state.empresa.anexoSimples;
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

    function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _genId(prefix) { return `${prefix}_${Math.random().toString(36).slice(2,9)}${Date.now().toString(36).slice(-4)}`; }
    function _fmtMoney(n) {
        const v = Number(n) || 0;
        return v.toLocaleString('pt-BR', { style: 'currency', currency: _state.moeda.funcional || 'BRL' });
    }

    function render() {
        const panel = document.getElementById('tab-fiscal');
        if (!panel) return;
        const e = _state.empresa, r = _state.reconhecimento, m = _state.moeda, b = _state.banco, t = _state.tributos;
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
                <!-- ─── 1. EMPRESA ─── -->
                <div class="fiscal-card">
                    <h3 class="fiscal-card-title"><i data-lucide="building" style="width:14px;height:14px;vertical-align:-2px"></i> Empresa</h3>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Razão social / Nome</label>
                            <input type="text" class="input" id="f-emp-nome" value="${_esc(e.nome)}" placeholder="Ex.: Lucas Sunglasses LTDA">
                        </div>
                        <div class="form-group">
                            <label>CNPJ</label>
                            <input type="text" class="input" id="f-emp-cnpj" value="${_esc(e.cnpj)}" placeholder="00.000.000/0001-00">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Regime tributário</label>
                            <select class="input" id="f-emp-regime">
                                <option value="">— Selecione —</option>
                                ${REGIMES.map(o => `<option value="${o.id}" ${e.regime === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group" id="f-anexo-wrap" style="${e.regime === 'simples' ? '' : 'display:none'}">
                            <label>Anexo do Simples</label>
                            <select class="input" id="f-emp-anexo">
                                <option value="">— Selecione —</option>
                                ${ANEXOS.map(o => `<option value="${o.id}" ${e.anexoSimples === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Atividade principal</label>
                            <select class="input" id="f-emp-ativ">
                                <option value="comercio" ${e.atividade === 'comercio' ? 'selected' : ''}>Comércio</option>
                                <option value="servico" ${e.atividade === 'servico' ? 'selected' : ''}>Serviço</option>
                                <option value="industria" ${e.atividade === 'industria' ? 'selected' : ''}>Indústria</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>UF</label>
                            <input type="text" class="input" id="f-emp-uf" value="${_esc(e.uf)}" placeholder="SP" maxlength="2">
                        </div>
                        <div class="form-group">
                            <label>Município</label>
                            <input type="text" class="input" id="f-emp-mun" value="${_esc(e.municipio)}" placeholder="São Paulo">
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

        _renderGatewaysList();
        _renderCustosList();
        _renderSociosList();
        _wireEvents();
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
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
            <div class="fiscal-socios-sum">Soma dos % de participação: <strong>${totalPct.toFixed(1)}%</strong> ${totalPct === 100 ? '✓' : (totalPct > 100 ? '⚠ excede 100' : '⚠ faltam ' + (100 - totalPct).toFixed(1) + '%')}</div>
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

        // ── Empresa
        const bindText = (id, sec, field) => $(id)?.addEventListener('input', (e) => { _state[sec][field] = e.target.value; });
        bindText('f-emp-nome', 'empresa', 'nome');
        bindText('f-emp-cnpj', 'empresa', 'cnpj');
        bindText('f-emp-uf', 'empresa', 'uf');
        bindText('f-emp-mun', 'empresa', 'municipio');
        $('f-emp-regime')?.addEventListener('change', (e) => {
            _state.empresa.regime = e.target.value;
            render(); // re-render to show/hide anexo & tributos
        });
        $('f-emp-anexo')?.addEventListener('change', (e) => { _state.empresa.anexoSimples = e.target.value; });
        $('f-emp-ativ')?.addEventListener('change', (e) => { _state.empresa.atividade = e.target.value; });

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
        getGateways, getGatewayById, getCustosFixosMensal, getAliquotaEfetiva,
    };
})();

if (typeof window !== 'undefined') window.FiscalModule = FiscalModule;
