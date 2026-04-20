/* ===========================
   Team Module — Staff management with role-based access control
   Similar to Shopify staff accounts
   =========================== */

const TeamModule = (() => {
    const STORAGE_KEY = 'etracker_team';
    const OWNER_KEY = 'etracker_team_owner';

    // All available sections/permissions
    const ALL_SECTIONS = [
        { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
        { id: 'products', label: 'Produtos', icon: 'package' },
        { id: 'goals', label: 'Metas', icon: 'target' },
        { id: 'diary', label: 'Diário', icon: 'book-open' },
        { id: 'calculator', label: 'Simulador', icon: 'calculator' },
        { id: 'creatives', label: 'Criativos', icon: 'image' },
        { id: 'mineracao', label: 'Mineração', icon: 'pickaxe' },
        { id: 'diagnostico', label: 'Diagnóstico', icon: 'stethoscope' },
        { id: 'pipeline', label: 'Pipeline', icon: 'kanban' },
        { id: 'projects', label: 'Projetos', icon: 'folder-kanban' },
    ];

    const ROLES = [
        { id: 'admin', label: 'Administrador', description: 'Acesso total + gerenciar equipe' },
        { id: 'editor', label: 'Editor', description: 'Pode ver e editar dados' },
        { id: 'viewer', label: 'Visualizador', description: 'Apenas visualização' },
    ];

    let _team = [];
    let _owner = null; // email of the owner/admin who created the workspace

    function _load() {
        try {
            _team = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
            _owner = localStorage.getItem(OWNER_KEY) || null;
        } catch { _team = []; }
    }

    function _persist() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_team));
        if (_owner) localStorage.setItem(OWNER_KEY, _owner);
    }

    // Get current user's email
    function _getCurrentEmail() {
        if (typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn) {
            const emailEl = document.getElementById('profile-dropdown-email');
            return emailEl ? emailEl.textContent.trim().toLowerCase() : null;
        }
        return null;
    }

    // Set owner on first login if not set
    function _ensureOwner() {
        const email = _getCurrentEmail();
        if (!_owner && email && email !== 'não conectado') {
            _owner = email;
            localStorage.setItem(OWNER_KEY, _owner);
        }
    }

    // Check if current user is the owner (original admin)
    function isOwner() {
        _ensureOwner();
        const email = _getCurrentEmail();
        if (!email || email === 'não conectado') return true; // offline mode = full access
        return email === _owner;
    }

    // Check if current user is admin (owner or team member with admin role)
    function isAdmin() {
        if (isOwner()) return true;
        const email = _getCurrentEmail();
        if (!email) return true; // offline = full access
        const member = _team.find(m => m.email.toLowerCase() === email);
        return member ? member.role === 'admin' : false;
    }

    // Get current user's role
    function getCurrentRole() {
        if (isOwner()) return 'admin';
        const email = _getCurrentEmail();
        if (!email || email === 'não conectado') return 'admin'; // offline
        const member = _team.find(m => m.email.toLowerCase() === email);
        return member ? member.role : null; // null = not a team member
    }

    // Get current user's allowed sections
    function getAllowedSections() {
        if (isOwner()) return ALL_SECTIONS.map(s => s.id);
        const email = _getCurrentEmail();
        if (!email || email === 'não conectado') return ALL_SECTIONS.map(s => s.id);
        const member = _team.find(m => m.email.toLowerCase() === email);
        if (!member) return []; // not in team = no access
        if (member.role === 'admin') return ALL_SECTIONS.map(s => s.id);
        return member.sections || [];
    }

    // Check if current user can access a specific section
    function canAccess(sectionId) {
        return getAllowedSections().includes(sectionId);
    }

    // Check if current user can edit (not viewer)
    function canEdit() {
        const role = getCurrentRole();
        return role === 'admin' || role === 'editor';
    }

    // ── CRUD ──

    function addMember(email, role, sections) {
        if (!isAdmin()) { showToast('Sem permissão para gerenciar equipe.', 'error'); return false; }
        email = email.trim().toLowerCase();
        if (email === _owner) { showToast('Não é possível adicionar o proprietário como membro.', 'error'); return false; }
        if (_team.find(m => m.email === email)) { showToast('Este email já está na equipe.', 'error'); return false; }

        _team.push({
            id: 'tm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
            email,
            role: role || 'viewer',
            sections: sections || ALL_SECTIONS.map(s => s.id),
            addedAt: new Date().toISOString(),
            addedBy: _getCurrentEmail() || _owner,
        });
        _persist();
        return true;
    }

    function updateMember(memberId, updates) {
        if (!isAdmin()) return false;
        const idx = _team.findIndex(m => m.id === memberId);
        if (idx === -1) return false;
        Object.assign(_team[idx], updates);
        _persist();
        return true;
    }

    function removeMember(memberId) {
        if (!isAdmin()) return false;
        _team = _team.filter(m => m.id !== memberId);
        _persist();
        return true;
    }

    function getMembers() {
        return [..._team];
    }

    // ── Permission Enforcement ──

    function enforceTabPermissions() {
        const allowed = getAllowedSections();
        const role = getCurrentRole();

        // Hide/show tabs
        document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
            const tab = btn.dataset.tab;
            if (allowed.includes(tab)) {
                btn.style.display = '';
            } else {
                btn.style.display = 'none';
                // If this tab was active, switch to first allowed tab
                if (btn.classList.contains('active')) {
                    const firstAllowed = document.querySelector(`.tab-btn[data-tab="${allowed[0]}"]`);
                    if (firstAllowed) firstAllowed.click();
                }
            }
        });

        // Hide/show admin panel button
        const adminBtn = document.getElementById('btn-usage-panel');
        if (adminBtn) adminBtn.style.display = isAdmin() ? '' : 'none';

        // Hide/show team button
        const teamBtn = document.getElementById('btn-team-panel');
        if (teamBtn) teamBtn.style.display = isAdmin() ? '' : 'none';

        // Apply read-only mode for viewers
        if (role === 'viewer') {
            document.body.classList.add('team-viewer-mode');
        } else {
            document.body.classList.remove('team-viewer-mode');
        }
    }

    // ── UI Rendering ──

    function openPanel() {
        if (!isAdmin()) { showToast('Acesso restrito a administradores.', 'error'); return; }
        const panel = document.getElementById('team-panel');
        if (panel) panel.classList.remove('hidden');
        render();
    }

    function closePanel() {
        const panel = document.getElementById('team-panel');
        if (panel) panel.classList.add('hidden');
    }

    function render() {
        const content = document.getElementById('team-panel-content');
        if (!content) return;

        const members = getMembers();

        let html = `
            <div class="team-owner-card">
                <div class="team-member-avatar" style="background:var(--accent)">${_getInitial(_owner || 'A')}</div>
                <div class="team-member-info">
                    <span class="team-member-email">${_esc(_owner || 'Proprietário')}</span>
                    <span class="team-role-badge team-role-admin">Proprietário</span>
                </div>
                <span class="team-member-meta">Acesso total</span>
            </div>

            <div class="team-add-section">
                <h4>Adicionar membro</h4>
                <div class="team-add-form">
                    <input type="email" id="team-add-email" class="input" placeholder="email@exemplo.com" style="flex:1">
                    <select id="team-add-role" class="input" style="width:140px">
                        ${ROLES.map(r => `<option value="${r.id}">${r.label}</option>`).join('')}
                    </select>
                    <button id="btn-team-add" class="btn btn-primary btn-sm">Adicionar</button>
                </div>
            </div>

            <div class="team-sections-picker" id="team-add-sections-wrap" style="display:none">
                <p class="team-hint">Selecione as seções permitidas:</p>
                <div class="team-sections-grid">
                    ${ALL_SECTIONS.map(s => `
                        <label class="team-section-check">
                            <input type="checkbox" value="${s.id}" checked> ${s.label}
                        </label>
                    `).join('')}
                </div>
            </div>
        `;

        if (members.length > 0) {
            html += `<h4 style="margin-top:1.5rem">Equipe (${members.length})</h4>`;
            html += '<div class="team-members-list">';
            for (const m of members) {
                const roleLabel = ROLES.find(r => r.id === m.role)?.label || m.role;
                const sectionLabels = (m.sections || []).map(sid => {
                    const s = ALL_SECTIONS.find(x => x.id === sid);
                    return s ? s.label : sid;
                });
                const sectionText = m.role === 'admin' ? 'Acesso total' : sectionLabels.join(', ');

                html += `
                <div class="team-member-card" data-id="${m.id}">
                    <div class="team-member-avatar">${_getInitial(m.email)}</div>
                    <div class="team-member-info">
                        <span class="team-member-email">${_esc(m.email)}</span>
                        <span class="team-role-badge team-role-${m.role}">${roleLabel}</span>
                    </div>
                    <div class="team-member-sections">${_esc(sectionText)}</div>
                    <div class="team-member-actions">
                        <button class="btn btn-secondary btn-sm team-edit-btn" data-id="${m.id}" title="Editar">
                            <i data-lucide="pencil" style="width:12px;height:12px"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm team-remove-btn" data-id="${m.id}" title="Remover" style="color:var(--red)">
                            <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                        </button>
                    </div>
                </div>`;
            }
            html += '</div>';
        } else {
            html += `
            <div class="team-empty">
                <p>Nenhum membro na equipe.</p>
                <p class="team-hint">Adicione membros para compartilhar o acesso ao E-commerce Tracker.</p>
            </div>`;
        }

        content.innerHTML = html;

        // Re-render lucide icons
        if (typeof lucide !== 'undefined') lucide.createIcons();

        // ── Bind events ──

        // Role change → show/hide sections picker
        const roleSelect = document.getElementById('team-add-role');
        const sectionsWrap = document.getElementById('team-add-sections-wrap');
        if (roleSelect && sectionsWrap) {
            roleSelect.addEventListener('change', () => {
                sectionsWrap.style.display = roleSelect.value === 'admin' ? 'none' : '';
            });
        }

        // Add member
        document.getElementById('btn-team-add')?.addEventListener('click', () => {
            const email = document.getElementById('team-add-email')?.value;
            const role = document.getElementById('team-add-role')?.value;
            let sections = ALL_SECTIONS.map(s => s.id);

            if (role !== 'admin') {
                sections = [];
                document.querySelectorAll('#team-add-sections-wrap input[type=checkbox]:checked').forEach(cb => {
                    sections.push(cb.value);
                });
            }

            if (!email || !email.includes('@')) {
                showToast('Email inválido.', 'error');
                return;
            }

            if (addMember(email, role, sections)) {
                showToast(`${email} adicionado à equipe!`, 'success');
                render();
                enforceTabPermissions();
            }
        });

        // Edit buttons
        content.querySelectorAll('.team-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => _openEditModal(btn.dataset.id));
        });

        // Remove buttons
        content.querySelectorAll('.team-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const member = _team.find(m => m.id === btn.dataset.id);
                if (!member) return;
                if (confirm(`Remover ${member.email} da equipe?`)) {
                    removeMember(btn.dataset.id);
                    showToast(`${member.email} removido da equipe.`, 'success');
                    render();
                    enforceTabPermissions();
                }
            });
        });
    }

    function _openEditModal(memberId) {
        const member = _team.find(m => m.id === memberId);
        if (!member) return;

        // Remove existing
        document.getElementById('team-edit-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'team-edit-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width:480px">
                <div class="modal-header">
                    <h3>Editar membro</h3>
                    <button class="btn-close" id="team-edit-close">&times;</button>
                </div>
                <div style="padding:1rem;display:flex;flex-direction:column;gap:1rem">
                    <div>
                        <label class="label">Email</label>
                        <input class="input" value="${_esc(member.email)}" disabled style="opacity:0.6">
                    </div>
                    <div>
                        <label class="label">Função</label>
                        <select id="team-edit-role" class="input">
                            ${ROLES.map(r => `<option value="${r.id}" ${r.id === member.role ? 'selected' : ''}>${r.label} — ${r.description}</option>`).join('')}
                        </select>
                    </div>
                    <div id="team-edit-sections-wrap" style="${member.role === 'admin' ? 'display:none' : ''}">
                        <label class="label">Seções permitidas</label>
                        <div class="team-sections-grid">
                            ${ALL_SECTIONS.map(s => `
                                <label class="team-section-check">
                                    <input type="checkbox" value="${s.id}" ${(member.sections || []).includes(s.id) ? 'checked' : ''}> ${s.label}
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <button id="btn-team-edit-save" class="btn btn-primary">Salvar</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const roleSelect = document.getElementById('team-edit-role');
        const sectionsWrap = document.getElementById('team-edit-sections-wrap');

        roleSelect?.addEventListener('change', () => {
            if (sectionsWrap) sectionsWrap.style.display = roleSelect.value === 'admin' ? 'none' : '';
        });

        document.getElementById('team-edit-close')?.addEventListener('click', () => modal.remove());
        modal.querySelector('.modal-overlay')?.addEventListener('click', () => modal.remove());

        document.getElementById('btn-team-edit-save')?.addEventListener('click', () => {
            const role = roleSelect.value;
            let sections = ALL_SECTIONS.map(s => s.id);
            if (role !== 'admin') {
                sections = [];
                sectionsWrap.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
                    sections.push(cb.value);
                });
                if (sections.length === 0) {
                    showToast('Selecione pelo menos uma seção.', 'error');
                    return;
                }
            }
            updateMember(memberId, { role, sections });
            showToast('Membro atualizado!', 'success');
            modal.remove();
            render();
            enforceTabPermissions();
        });
    }

    // ── Helpers ──

    function _getInitial(email) {
        if (!email) return '?';
        return email.charAt(0).toUpperCase();
    }

    function _esc(str) {
        const el = document.createElement('span');
        el.textContent = str || '';
        return el.innerHTML;
    }

    // ── Init ──

    function init() {
        _load();

        // Open/close panel
        document.getElementById('btn-team-panel')?.addEventListener('click', () => openPanel());
        document.getElementById('team-panel-close')?.addEventListener('click', () => closePanel());
        document.getElementById('team-panel')?.querySelector('.modal-overlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closePanel();
        });

        // Enforce permissions after a short delay (wait for auth)
        setTimeout(() => {
            _ensureOwner();
            enforceTabPermissions();
        }, 1500);

        // Re-enforce on auth state changes
        EventBus.on('dataLoaded', () => {
            _ensureOwner();
            enforceTabPermissions();
        });
    }

    return {
        init,
        isOwner,
        isAdmin,
        getCurrentRole,
        getAllowedSections,
        canAccess,
        canEdit,
        addMember,
        updateMember,
        removeMember,
        getMembers,
        enforceTabPermissions,
        openPanel,
        closePanel,
        render,
        ALL_SECTIONS,
        ROLES,
    };
})();
