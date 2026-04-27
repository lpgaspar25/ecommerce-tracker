/* range-picker.js — Reusable Shopify-style date range picker.
   Used by Diagnóstico (funnel) and Diário tabs to share the same UX as the Dashboard.
   Each instance uses a unique 'prefix' to namespace its DOM IDs:
     ${prefix}-picker-btn       toggle button
     ${prefix}-label            label inside the button
     ${prefix}-dropdown         dropdown panel
     ${prefix}-start            hidden input (ISO date)
     ${prefix}-end              hidden input (ISO date)
     ${prefix}-cal-grid/title/prev/next/summary  calendar elements
     ${prefix}-apply / ${prefix}-cancel          action buttons
     .${prefix}-preset                            preset buttons (data-preset attr)
*/
const RangePicker = {
    _states: {},
    _instances: {},
    _outsideListenerBound: false,

    init(prefix, opts = {}) {
        if (this._instances[prefix]) return;
        this._instances[prefix] = opts;

        const btn = document.getElementById(`${prefix}-picker-btn`);
        const dd = document.getElementById(`${prefix}-dropdown`);
        if (!btn || !dd) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const opening = dd.style.display === 'none' || !dd.style.display;
            document.querySelectorAll('.dash-date-dropdown').forEach(el => {
                if (el !== dd) el.style.display = 'none';
            });
            dd.style.display = opening ? 'flex' : 'none';
            if (opening) {
                this._initRangeCalendar(prefix);
                this._syncRangeCalendar(prefix);
            }
        });

        dd.querySelectorAll(`.${prefix}-preset`).forEach(b => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                const preset = b.dataset.preset;
                this._setActivePreset(prefix, preset);
                if (preset !== 'custom') {
                    this.applyPreset(prefix, preset);
                    dd.style.display = 'none';
                    if (typeof opts.onChange === 'function') opts.onChange();
                }
            });
        });

        document.getElementById(`${prefix}-apply`)?.addEventListener('click', () => {
            const start = document.getElementById(`${prefix}-start`).value;
            const end = document.getElementById(`${prefix}-end`).value;
            this._setActivePreset(prefix, 'custom');
            this._updateLabel(prefix, start, end, null);
            dd.style.display = 'none';
            if (typeof opts.onChange === 'function') opts.onChange();
        });

        document.getElementById(`${prefix}-cancel`)?.addEventListener('click', () => {
            dd.style.display = 'none';
        });

        if (!RangePicker._outsideListenerBound) {
            RangePicker._outsideListenerBound = true;
            document.addEventListener('click', (e) => {
                document.querySelectorAll('.dash-date-dropdown').forEach(el => {
                    if (el.style.display === 'none' || !el.style.display) return;
                    const wrap = el.parentElement;
                    if (wrap && !wrap.contains(e.target)) el.style.display = 'none';
                });
            });
        }

        const defaultPreset = opts.defaultPreset || 'today';
        this.applyPreset(prefix, defaultPreset, { silent: true });
        this._setActivePreset(prefix, defaultPreset);
    },

    applyPreset(prefix, preset, options = {}) {
        const today = new Date().toISOString().slice(0, 10);
        const d = new Date();
        let start, end = today, label = '';

        switch (preset) {
            case 'today': start = end = today; label = 'Hoje'; break;
            case 'yesterday':
                d.setDate(d.getDate() - 1);
                start = end = d.toISOString().slice(0, 10); label = 'Ontem'; break;
            case '7': d.setDate(d.getDate() - 6); start = d.toISOString().slice(0, 10); label = 'Últimos 7 dias'; break;
            case '14': d.setDate(d.getDate() - 13); start = d.toISOString().slice(0, 10); label = 'Últimos 14 dias'; break;
            case '30': d.setDate(d.getDate() - 29); start = d.toISOString().slice(0, 10); label = 'Últimos 30 dias'; break;
            case '90': d.setDate(d.getDate() - 89); start = d.toISOString().slice(0, 10); label = 'Últimos 90 dias'; break;
            case 'month':
                start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                label = 'Este mês'; break;
            case 'lastMonth': {
                const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1);
                start = lm.toISOString().slice(0, 10);
                end = new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10);
                label = 'Mês passado'; break;
            }
            case 'all': start = ''; end = ''; label = 'Todos'; break;
            default: return;
        }
        const startEl = document.getElementById(`${prefix}-start`);
        const endEl = document.getElementById(`${prefix}-end`);
        if (startEl) startEl.value = start;
        if (endEl) endEl.value = end;
        this._updateLabel(prefix, start, end, label);
        if (this._states[prefix]?.initialized) {
            this._states[prefix].start = start;
            this._states[prefix].end = end;
            if (start) {
                const [y, m] = start.split('-').map(Number);
                this._states[prefix].viewYear = y;
                this._states[prefix].viewMonth = m - 1;
            }
            this._renderRangeCalendar(prefix);
        }
    },

    _setActivePreset(prefix, preset) {
        const dd = document.getElementById(`${prefix}-dropdown`);
        if (!dd) return;
        dd.querySelectorAll(`.${prefix}-preset`).forEach(b => {
            b.classList.toggle('active', b.dataset.preset === preset);
        });
    },

    _updateLabel(prefix, start, end, label) {
        const labelEl = document.getElementById(`${prefix}-label`);
        if (!labelEl) return;
        if (label) {
            labelEl.textContent = label;
        } else if (start && end) {
            labelEl.textContent = start === end ? this._formatBr(start) : `${this._formatBr(start)} – ${this._formatBr(end)}`;
        } else if (start) {
            labelEl.textContent = this._formatBr(start);
        } else {
            labelEl.textContent = 'Todos';
        }
    },

    _formatBr(iso) {
        if (!iso) return '';
        const [y, m, d] = iso.split('-');
        return `${d}/${m}/${y}`;
    },

    _initRangeCalendar(prefix) {
        const grid = document.getElementById(`${prefix}-cal-grid`);
        if (!grid) return;
        const state = this._states[prefix] || (this._states[prefix] = { viewYear: 0, viewMonth: 0, start: '', end: '', initialized: false });
        if (state.initialized) return;
        state.initialized = true;

        const seedStart = document.getElementById(`${prefix}-start`)?.value || '';
        const seedEnd = document.getElementById(`${prefix}-end`)?.value || '';
        state.start = seedStart;
        state.end = seedEnd;
        const seed = seedEnd || seedStart || new Date().toISOString().slice(0, 10);
        const [sy, sm] = seed.split('-').map(Number);
        state.viewYear = sy || new Date().getFullYear();
        state.viewMonth = (sm || new Date().getMonth() + 1) - 1;

        document.getElementById(`${prefix}-cal-prev`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            state.viewMonth--;
            if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
            this._renderRangeCalendar(prefix);
        });
        document.getElementById(`${prefix}-cal-next`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            state.viewMonth++;
            if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
            this._renderRangeCalendar(prefix);
        });

        this._renderRangeCalendar(prefix);
    },

    _renderRangeCalendar(prefix) {
        const state = this._states[prefix];
        const grid = document.getElementById(`${prefix}-cal-grid`);
        const title = document.getElementById(`${prefix}-cal-title`);
        const summary = document.getElementById(`${prefix}-cal-summary`);
        if (!grid || !state) return;

        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        if (title) title.textContent = `${monthNames[state.viewMonth]} ${state.viewYear}`;

        const firstDay = new Date(state.viewYear, state.viewMonth, 1);
        const lastDay = new Date(state.viewYear, state.viewMonth + 1, 0);
        const startDow = firstDay.getDay();
        const daysInMonth = lastDay.getDate();
        const todayStr = new Date().toISOString().slice(0, 10);

        let html = '';
        for (let i = 0; i < startDow; i++) html += '<span class="dash-range-cal-day dash-range-cal-empty"></span>';
        for (let dy = 1; dy <= daysInMonth; dy++) {
            const ds = `${state.viewYear}-${String(state.viewMonth + 1).padStart(2,'0')}-${String(dy).padStart(2,'0')}`;
            const classes = ['dash-range-cal-day'];
            if (state.start && ds === state.start) classes.push('dash-range-cal-start');
            if (state.end && ds === state.end) classes.push('dash-range-cal-end');
            if (state.start && state.end && ds > state.start && ds < state.end) classes.push('dash-range-cal-inrange');
            if (ds === todayStr) classes.push('dash-range-cal-today');
            html += `<button type="button" class="${classes.join(' ')}" data-date="${ds}">${dy}</button>`;
        }
        grid.innerHTML = html;

        if (summary) {
            if (state.start && state.end) {
                const days = Math.round((new Date(state.end) - new Date(state.start)) / 86400000) + 1;
                summary.textContent = `${this._formatBr(state.start)} → ${this._formatBr(state.end)} · ${days} dia${days > 1 ? 's' : ''}`;
            } else if (state.start) {
                summary.textContent = `Início: ${this._formatBr(state.start)} · clique outra data para fim`;
            } else {
                summary.textContent = 'Clique uma data para começar.';
            }
        }

        grid.querySelectorAll('.dash-range-cal-day[data-date]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const ds = btn.dataset.date;
                if (!state.start || (state.start && state.end)) {
                    state.start = ds;
                    state.end = '';
                } else {
                    if (ds < state.start) {
                        state.end = state.start;
                        state.start = ds;
                    } else {
                        state.end = ds;
                    }
                }
                const sEl = document.getElementById(`${prefix}-start`);
                const eEl = document.getElementById(`${prefix}-end`);
                if (sEl) sEl.value = state.start;
                if (eEl) eEl.value = state.end || state.start;
                this._renderRangeCalendar(prefix);
            });
        });
    },

    _syncRangeCalendar(prefix) {
        const state = this._states[prefix];
        if (!state || !state.initialized) return;
        const newStart = document.getElementById(`${prefix}-start`)?.value || '';
        const newEnd = document.getElementById(`${prefix}-end`)?.value || '';
        if (newStart === state.start && newEnd === state.end) return;
        state.start = newStart;
        state.end = newEnd;
        if (newStart) {
            const [y, m] = newStart.split('-').map(Number);
            state.viewYear = y;
            state.viewMonth = m - 1;
        }
        this._renderRangeCalendar(prefix);
    },

    getRange(prefix) {
        return {
            start: document.getElementById(`${prefix}-start`)?.value || '',
            end: document.getElementById(`${prefix}-end`)?.value || ''
        };
    },

    setRange(prefix, start, end) {
        const sEl = document.getElementById(`${prefix}-start`);
        const eEl = document.getElementById(`${prefix}-end`);
        if (sEl) sEl.value = start;
        if (eEl) eEl.value = end;
        this._setActivePreset(prefix, 'custom');
        this._updateLabel(prefix, start, end, null);
        const state = this._states[prefix];
        if (state) {
            state.start = start;
            state.end = end;
            if (start) {
                const [y, m] = start.split('-').map(Number);
                state.viewYear = y;
                state.viewMonth = m - 1;
            }
            if (state.initialized) this._renderRangeCalendar(prefix);
        }
    }
};
