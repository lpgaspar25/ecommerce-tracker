/* ===========================
   PendingApprovals — Designer Drop submissions review
   - Lê localStorage 'etracker_designer_submissions'
   - Permite aprovar/rejeitar
   - Aprovado vira creative em AppState.allCreatives (com imageUrl)
   =========================== */
(function () {
    const STORAGE_KEY = 'etracker_designer_submissions';

    const PendingApprovals = {
        init() {
            if (document.readyState !== 'loading') this._setup();
            else document.addEventListener('DOMContentLoaded', () => this._setup());
        },

        _submissions: [],

        _setup() {
            this._bindUI();
            this._refreshFromCloud(); // primeira carga
            this._updateBadge();
            // Polling: cada 15s busca da nuvem + atualiza badge
            setInterval(() => this._refreshFromCloud(), 15000);
        },

        async _refreshFromCloud() {
            const localList = this._loadLocal();
            let cloudList = [];
            if (typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn && SupabaseSync.fetchDesignerSubmissions) {
                try {
                    cloudList = await SupabaseSync.fetchDesignerSubmissions();
                } catch (e) {
                    console.warn('[Pending] cloud fetch failed:', e);
                }
            }
            // Merge: nuvem tem prioridade (mesmo id sobrescreve)
            const byId = {};
            localList.forEach(s => byId[s.id] = s);
            cloudList.forEach(s => byId[s.id] = s);
            this._submissions = Object.values(byId).sort((a, b) =>
                (b.submittedAt || '').localeCompare(a.submittedAt || '')
            );
            this._updateBadge();
            // Se aba está aberta, re-render
            const sub = document.getElementById('pending-sub');
            if (sub && sub.style.display !== 'none') this.render();
        },

        _bindUI() {
            document.getElementById('btn-refresh-pending')?.addEventListener('click', () => this._refreshFromCloud().then(() => this.render()));
            document.getElementById('btn-copy-designer-link')?.addEventListener('click', () => this._copyLink());

            // Section tabs (Submissões / Designers)
            document.querySelectorAll('[data-pending-section]').forEach(btn => {
                btn.addEventListener('click', () => this._switchSection(btn.dataset.pendingSection));
            });

            // Designers management
            document.getElementById('btn-invite-designer')?.addEventListener('click', () => this._openDesignerModal());
            document.getElementById('designer-modal-save')?.addEventListener('click', () => this._saveDesigner());
            document.querySelectorAll('#designer-modal [data-close-modal]').forEach(b => {
                b.addEventListener('click', () => { document.getElementById('designer-modal').style.display = 'none'; });
            });

            // Mostra o link do designer
            this._refreshLink();
            if (typeof EventBus !== 'undefined') {
                EventBus.on('userChanged', () => this._refreshLink());
            }
        },

        _switchSection(name) {
            document.querySelectorAll('[data-pending-section]').forEach(b => b.classList.toggle('active', b.dataset.pendingSection === name));
            document.getElementById('pending-section-submissions').style.display = name === 'submissions' ? '' : 'none';
            document.getElementById('pending-section-designers').style.display = name === 'designers' ? '' : 'none';
            if (name === 'designers') this._loadDesigners();
        },

        // ===== Designers management =====
        async _loadDesigners() {
            const listEl = document.getElementById('designers-list');
            if (!listEl) return;
            if (typeof SupabaseSync === 'undefined' || !SupabaseSync.isLoggedIn) {
                listEl.innerHTML = '<div class="pending-empty"><p>Faça login para gerenciar designers</p></div>';
                return;
            }
            listEl.innerHTML = '<div class="pending-empty"><i data-lucide="loader-2" style="width:20px;height:20px;animation:spin 1s linear infinite"></i></div>';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
            try {
                this._designers = await SupabaseSync.fetchDesigners();
                this._renderDesigners();
            } catch (e) {
                listEl.innerHTML = `<div class="pending-empty"><p style="color:var(--danger)">Erro: ${this._esc(e.message)}</p></div>`;
            }
        },

        _renderDesigners() {
            const listEl = document.getElementById('designers-list');
            if (!listEl) return;
            const designers = this._designers || [];
            if (designers.length === 0) {
                listEl.innerHTML = '<div class="pending-empty"><i data-lucide="users" style="width:48px;height:48px;color:var(--text-muted)"></i><h3>Nenhum designer ainda</h3><p>Convide designers para começarem a enviar criativos.</p></div>';
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                return;
            }
            listEl.innerHTML = designers.map(d => {
                const productNames = (d.allowed_product_ids || [])
                    .map(pid => (AppState.allProducts || []).find(p => p.id === pid)?.name || pid)
                    .slice(0, 3).join(', ');
                const moreCount = (d.allowed_product_ids || []).length > 3 ? ` +${d.allowed_product_ids.length - 3}` : '';
                const linked = d.designer_id ? 'ativo' : 'aguardando primeiro login';
                return `<div class="designer-row" data-id="${this._esc(d.id)}">
                    <div class="designer-row-main">
                        <div class="designer-row-avatar">${this._esc((d.designer_email[0] || '?').toUpperCase())}</div>
                        <div style="flex:1;min-width:0">
                            <div class="designer-row-email">${this._esc(d.designer_email)}</div>
                            <div class="designer-row-meta">
                                <span>${this._esc(d.designer_name || '—')}</span>
                                <span class="status-pill status-${d.designer_id ? 'aprovado' : 'pendente'}">${linked}</span>
                                <span>${(d.allowed_product_ids || []).length} produto(s): ${this._esc(productNames || '—')}${moreCount}</span>
                            </div>
                        </div>
                    </div>
                    <div class="designer-row-actions">
                        <button class="btn btn-sm btn-secondary" data-action="edit" data-id="${this._esc(d.id)}">
                            <i data-lucide="pencil" style="width:12px;height:12px"></i> Editar
                        </button>
                        <button class="btn btn-sm btn-secondary" data-action="revoke" data-id="${this._esc(d.id)}" title="Revogar acesso">
                            <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                        </button>
                    </div>
                </div>`;
            }).join('');
            listEl.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btn.dataset.id;
                    if (btn.dataset.action === 'edit') this._openDesignerModal(id);
                    if (btn.dataset.action === 'revoke') this._revokeDesigner(id);
                });
            });
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        _openDesignerModal(editId = null) {
            const modal = document.getElementById('designer-modal');
            const title = document.getElementById('designer-modal-title');
            if (!modal) return;
            const editing = editId ? (this._designers || []).find(d => d.id === editId) : null;
            document.getElementById('designer-id-input').value = editId || '';
            document.getElementById('designer-email-input').value = editing?.designer_email || '';
            document.getElementById('designer-email-input').disabled = !!editing;
            document.getElementById('designer-name-input').value = editing?.designer_name || '';
            title.innerHTML = `<i data-lucide="${editing ? 'pencil' : 'user-plus'}" style="width:18px;height:18px;color:var(--accent)"></i> ${editing ? 'Editar designer' : 'Convidar designer'}`;

            // Populate products
            const productsEl = document.getElementById('designer-products-list');
            const allowed = new Set(editing?.allowed_product_ids || []);
            const products = (AppState.allProducts || []);
            productsEl.innerHTML = products.length === 0
                ? '<p style="color:var(--text-muted);font-size:0.8rem">Nenhum produto cadastrado. Vá em Produtos &rarr; Lista para adicionar.</p>'
                : products.map(p => `
                    <label class="designer-product-item">
                        <input type="checkbox" data-product-id="${this._esc(p.id)}" ${allowed.has(p.id) ? 'checked' : ''}>
                        <span>${this._esc(p.name)}</span>
                    </label>
                `).join('');

            modal.style.display = 'flex';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        async _saveDesigner() {
            const id = document.getElementById('designer-id-input').value;
            const email = document.getElementById('designer-email-input').value.trim();
            const name = document.getElementById('designer-name-input').value.trim();
            const allowedProductIds = Array.from(document.querySelectorAll('#designer-products-list input:checked'))
                .map(c => c.dataset.productId);

            if (!email) { if (typeof showToast === 'function') showToast('Email obrigatório', 'error'); return; }

            const saveBtn = document.getElementById('designer-modal-save');
            saveBtn.disabled = true;
            const origHtml = saveBtn.innerHTML;
            saveBtn.innerHTML = '<i data-lucide="loader-2" style="width:13px;height:13px;animation:spin 1s linear infinite"></i> Salvando…';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            try {
                if (id) {
                    await SupabaseSync.updateDesignerAccess(id, {
                        designer_name: name || null,
                        allowed_product_ids: allowedProductIds,
                    });
                } else {
                    await SupabaseSync.inviteDesigner({ email, name, allowedProductIds });
                }
                document.getElementById('designer-modal').style.display = 'none';
                await this._loadDesigners();
                if (typeof showToast === 'function') showToast(id ? 'Designer atualizado' : 'Designer convidado!', 'success');
            } catch (e) {
                if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = origHtml;
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
            }
        },

        async _revokeDesigner(id) {
            if (!confirm('Revogar acesso deste designer? As submissões dele ficam preservadas.')) return;
            try {
                await SupabaseSync.revokeDesigner(id);
                await this._loadDesigners();
                if (typeof showToast === 'function') showToast('Acesso revogado', 'info');
            } catch (e) {
                if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
            }
        },

        _refreshLink() {
            const linkEl = document.getElementById('designer-link');
            if (!linkEl) return;
            const baseUrl = window.location.origin + window.location.pathname.replace(/[^/]+$/, '');
            const userId = (typeof SupabaseSync !== 'undefined' && SupabaseSync.user) ? SupabaseSync.user.id : '';
            linkEl.textContent = userId
                ? `${baseUrl}upload.html?token=${userId}`
                : `${baseUrl}upload.html (faça login p/ habilitar sync entre dispositivos)`;
        },

        _copyLink() {
            const linkEl = document.getElementById('designer-link');
            if (!linkEl) return;
            navigator.clipboard.writeText(linkEl.textContent.trim())
                .then(() => { if (typeof showToast === 'function') showToast('Link copiado!', 'success'); })
                .catch(() => { if (typeof showToast === 'function') showToast('Falha ao copiar', 'error'); });
        },

        _loadLocal() {
            try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
            catch { return []; }
        },

        _saveLocal(list) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
        },

        _updateBadge() {
            const badge = document.getElementById('pending-count-badge');
            if (!badge) return;
            const pending = (this._submissions || []).filter(s => s.status === 'pendente');
            if (pending.length === 0) {
                badge.style.display = 'none';
            } else {
                badge.style.display = '';
                badge.textContent = pending.length;
            }
        },

        render() {
            const list = document.getElementById('pending-list');
            if (!list) return;
            const submissions = this._submissions || [];
            this._updateBadge();
            this._refreshLink();

            if (submissions.length === 0) {
                list.innerHTML = `
                    <div class="pending-empty">
                        <i data-lucide="inbox" style="width:48px;height:48px;color:var(--text-muted)"></i>
                        <h3>Nenhuma submissão ainda</h3>
                        <p>Envie o link acima pro seu designer. Quando ele subir criativos, vão aparecer aqui pra você aprovar.</p>
                    </div>`;
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                return;
            }

            list.innerHTML = submissions.map(s => this._renderSubmission(s)).join('');
            // Bind action buttons
            list.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const id = btn.dataset.id;
                    if (action === 'approve') this._approve(id);
                    if (action === 'reject') this._reject(id);
                    if (action === 'delete') this._delete(id);
                });
            });
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        _renderSubmission(s) {
            const statusBadge = {
                pendente: '<span class="pending-status pending-status-pendente">Pendente</span>',
                aprovado: '<span class="pending-status pending-status-aprovado">Aprovado</span>',
                rejeitado: '<span class="pending-status pending-status-rejeitado">Rejeitado</span>',
            }[s.status] || '';
            const date = new Date(s.submittedAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
            const isPending = s.status === 'pendente';
            const productName = s.productId
                ? ((AppState.allProducts || []).find(p => p.id === s.productId)?.name || s.productId)
                : '—';
            const images = s.images || [];
            const videos = s.videos || [];
            const previews = [
                ...images.map(img => `<img src="${this._esc(img.dataUrl || img.url)}" alt="${this._esc(img.name)}" loading="lazy">`),
                ...videos.map(v => `<video src="${this._esc(v.url || v.dataUrl)}" muted controls preload="metadata"></video>`),
            ].join('');

            return `
                <div class="pending-card pending-card-${s.status}" data-id="${this._esc(s.id)}">
                    <div class="pending-card-images">
                        ${previews}
                    </div>
                    <div class="pending-card-body">
                        <div class="pending-card-header">
                            <strong>${this._esc(s.name)}</strong>
                            ${statusBadge}
                        </div>
                        <div class="pending-card-meta">
                            <span><i data-lucide="user" style="width:11px;height:11px;vertical-align:-1px"></i> ${this._esc(s.designer)}</span>
                            <span><i data-lucide="package" style="width:11px;height:11px;vertical-align:-1px"></i> ${this._esc(productName)}</span>
                            <span><i data-lucide="clock" style="width:11px;height:11px;vertical-align:-1px"></i> ${date}</span>
                            <span><i data-lucide="image" style="width:11px;height:11px;vertical-align:-1px"></i> ${images.length}</span>
                            ${videos.length > 0 ? `<span><i data-lucide="video" style="width:11px;height:11px;vertical-align:-1px"></i> ${videos.length}</span>` : ''}
                        </div>
                        ${s.angle ? `<div class="pending-card-field"><strong>Ângulo:</strong> ${this._esc(s.angle)}</div>` : ''}
                        ${s.notes ? `<div class="pending-card-field"><strong>Notas:</strong> ${this._esc(s.notes)}</div>` : ''}
                        <div class="pending-card-actions">
                            ${isPending ? `
                                <button class="btn btn-sm btn-primary" data-action="approve" data-id="${this._esc(s.id)}">
                                    <i data-lucide="check" style="width:13px;height:13px"></i> Aprovar
                                </button>
                                <button class="btn btn-sm btn-secondary" data-action="reject" data-id="${this._esc(s.id)}">
                                    <i data-lucide="x" style="width:13px;height:13px"></i> Rejeitar
                                </button>
                            ` : ''}
                            <button class="btn btn-sm btn-secondary" data-action="delete" data-id="${this._esc(s.id)}" style="margin-left:auto">
                                <i data-lucide="trash-2" style="width:13px;height:13px"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
        },

        async _approve(id) {
            const s = this._submissions.find(x => x.id === id);
            if (!s) return;

            if (typeof AppState === 'undefined') return;
            AppState.allCreatives = AppState.allCreatives || [];
            const storeId = (typeof getCurrentStoreId === 'function') ? getCurrentStoreId() : (AppState.activeStoreId || '');

            s.images.forEach((img, i) => {
                const suffix = s.images.length > 1 ? ` (${i + 1})` : '';
                const creative = {
                    id: 'crtv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                    productId: '',
                    name: s.name + suffix,
                    type: 'imagem',
                    angle: s.angle || '',
                    hookText: '',
                    hookType: '',
                    platform: 'meta',
                    status: 'ativo',
                    launchDate: new Date().toISOString().slice(0, 10),
                    primaryText: '',
                    headline: '',
                    adDescription: '',
                    variations: [],
                    storeId,
                    imageUrl: img.dataUrl,
                    designerSource: { designer: s.designer, submissionId: s.id, notes: s.notes },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };
                AppState.allCreatives.push(creative);
            });

            if (typeof LocalStore !== 'undefined') LocalStore.save('creatives', AppState.allCreatives);
            if (typeof EventBus !== 'undefined') EventBus.emit('creativesChanged');

            s.status = 'aprovado';
            s.reviewedAt = new Date().toISOString();
            await this._persistSubmission(s);
            this.render();

            if (typeof showToast === 'function') {
                showToast(`Aprovado! ${s.images.length} criativo(s) no Ad Launcher`, 'success');
            }
        },

        async _reject(id) {
            const s = this._submissions.find(x => x.id === id);
            if (!s) return;
            s.status = 'rejeitado';
            s.reviewedAt = new Date().toISOString();
            await this._persistSubmission(s);
            this.render();
            if (typeof showToast === 'function') showToast('Submissão rejeitada', 'info');
        },

        async _delete(id) {
            if (!confirm('Excluir esta submissão permanentemente?')) return;
            this._submissions = this._submissions.filter(s => s.id !== id);
            // Local
            const localList = this._loadLocal().filter(s => s.id !== id);
            this._saveLocal(localList);
            // Cloud
            if (typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn && SupabaseSync.deleteDesignerSubmission) {
                try { await SupabaseSync.deleteDesignerSubmission(id); } catch (e) { console.warn(e); }
            }
            this.render();
        },

        async _persistSubmission(s) {
            // Atualiza local
            const localList = this._loadLocal();
            const idx = localList.findIndex(x => x.id === s.id);
            if (idx >= 0) localList[idx] = s;
            else localList.unshift(s);
            this._saveLocal(localList);

            // Atualiza nuvem
            if (typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn && SupabaseSync.updateDesignerSubmission) {
                try {
                    await SupabaseSync.updateDesignerSubmission(s.id, {
                        status: s.status,
                        reviewed_at: s.reviewedAt,
                    });
                } catch (e) { console.warn('[Pending] update cloud failed', e); }
            }
        },

        _esc(s) {
            return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.PendingApprovals = PendingApprovals;
    PendingApprovals.init();
})();
