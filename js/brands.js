/* ===========================
   Brands — diretório de marcas para monitorar
   =========================== */
(function () {
    const BRANDS_SEED = [
        { id: 'b_gymshark',      name: 'Gymshark',            pageName: 'Gymshark',           industry: 'Fitness',      adsCount: 2847 },
        { id: 'b_fashionnova',   name: 'Fashion Nova',        pageName: 'FashionNova',        industry: 'Fashion',      adsCount: 5312 },
        { id: 'b_skims',         name: 'SKIMS',               pageName: 'SKIMS',              industry: 'Fashion',      adsCount: 2104 },
        { id: 'b_hexclad',       name: 'HexClad',             pageName: 'HexCladCookware',    industry: 'Kitchen',      adsCount: 1892 },
        { id: 'b_ridgewallet',   name: 'Ridge Wallet',        pageName: 'ridgewallet',        industry: 'Accessories',  adsCount: 2056 },
        { id: 'b_chubbies',      name: 'Chubbies',            pageName: 'Chubbies',           industry: 'Fashion',      adsCount: 1876 },
        { id: 'b_drinkag1',      name: 'AG1 Athletic Greens', pageName: 'drinkAG1',           industry: 'Health',       adsCount: 1456 },
        { id: 'b_dollskill',     name: 'Dolls Kill',          pageName: 'DollsKill',          industry: 'Fashion',      adsCount: 1203 },
        { id: 'b_bombas',        name: 'Bombas',              pageName: 'BombasSocks',        industry: 'Apparel',      adsCount: 1100 },
        { id: 'b_olipop',        name: 'OLIPOP',              pageName: 'drinkolipop',        industry: 'Food & Drink', adsCount:  891 },
        { id: 'b_primaryarms',   name: 'Primary Arms',        pageName: 'PrimaryArms',        industry: 'Outdoor',      adsCount: 2341 },
        { id: 'b_hims',          name: 'Hims & Hers',         pageName: 'hims',               industry: 'Health',       adsCount:  987 },
        { id: 'b_tula',          name: 'Tula Skincare',       pageName: 'TulaSkincare',       industry: 'Beauty',       adsCount:  634 },
        { id: 'b_brumate',       name: 'BrüMate',             pageName: 'BruMate',            industry: 'Lifestyle',    adsCount:  743 },
        { id: 'b_parachute',     name: 'Parachute Home',      pageName: 'ParachuteHome',      industry: 'Home & Decor', adsCount:  567 },
        { id: 'b_bearaby',       name: 'Bearaby',             pageName: 'BearabyOfficial',    industry: 'Home & Sleep', adsCount:  421 },
        { id: 'b_graza',         name: 'Graza',               pageName: 'GrazaOliveOil',      industry: 'Food & Drink', adsCount:  312 },
        { id: 'b_feals',         name: 'Feals',               pageName: 'feals',              industry: 'Wellness',     adsCount:  283 },
        { id: 'b_hydrojug',      name: 'HydroJug',            pageName: 'HydroJug',           industry: 'Fitness',      adsCount:  734 },
        { id: 'b_cettire',       name: 'Cettire',             pageName: 'Cettire',            industry: 'Luxury',       adsCount:  876 },
    ];

    const Brands = {
        STORAGE_KEY: 'etracker_followed_brands',
        _followed: new Set(),
        _activeTab: 'all',
        _search: '',
        _sortCol: 'ads',
        _sortDir: -1,
        _page: 1,
        _perPage: 10,

        init() {
            if (document.readyState !== 'loading') this._setup();
            else document.addEventListener('DOMContentLoaded', () => this._setup());
        },

        _setup() {
            this._loadFollowed();

            if (typeof EventBus !== 'undefined') {
                EventBus.on('tabChanged', (tab) => { if (tab === 'brands') this._render(); });
            }

            document.querySelectorAll('[data-brands-tab]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._activeTab = btn.dataset.brandsTab;
                    this._page = 1;
                    document.querySelectorAll('[data-brands-tab]').forEach(b =>
                        b.classList.toggle('adhub-tab-active', b === btn));
                    this._render();
                });
            });

            document.getElementById('brands-search')?.addEventListener('input', (e) => {
                this._search = e.target.value.toLowerCase();
                this._page = 1;
                this._render();
            });

            // Event delegation for sort, follow, pagination
            document.getElementById('tab-brands')?.addEventListener('click', (e) => {
                const th = e.target.closest('[data-brands-sort]');
                if (th) {
                    const col = th.dataset.brandsSort;
                    if (this._sortCol === col) this._sortDir *= -1;
                    else { this._sortCol = col; this._sortDir = -1; }
                    this._page = 1;
                    this._render();
                    return;
                }
                const followBtn = e.target.closest('.brand-follow-btn');
                if (followBtn) { this._toggleFollow(followBtn.dataset.brandId); return; }

                const pageBtn = e.target.closest('[data-brands-page]');
                if (pageBtn) { this._page = parseInt(pageBtn.dataset.brandsPage); this._render(); }
            });
        },

        _loadFollowed() {
            try { this._followed = new Set(JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]')); }
            catch { this._followed = new Set(); }
        },

        _saveFollowed() {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify([...this._followed]));
        },

        _toggleFollow(id) {
            if (this._followed.has(id)) {
                this._followed.delete(id);
                if (typeof showToast === 'function') showToast('Deixou de seguir', 'success');
            } else {
                this._followed.add(id);
                if (typeof showToast === 'function') showToast('Seguindo!', 'success');
            }
            this._saveFollowed();

            const btn = document.querySelector(`.brand-follow-btn[data-brand-id="${CSS.escape(id)}"]`);
            if (btn) {
                const following = this._followed.has(id);
                btn.classList.toggle('brand-follow-btn-active', following);
                btn.title = following ? 'Deixar de seguir' : 'Seguir';
                btn.innerHTML = `<i data-lucide="${following ? 'check' : 'plus'}" style="width:14px;height:14px"></i>`;
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch (e) {}
            }

            if (this._activeTab === 'followed') { this._page = 1; this._render(); }
        },

        _getList() {
            let list = BRANDS_SEED;
            if (this._activeTab === 'followed') list = list.filter(b => this._followed.has(b.id));
            if (this._search) list = list.filter(b =>
                b.name.toLowerCase().includes(this._search) ||
                b.industry.toLowerCase().includes(this._search) ||
                b.pageName.toLowerCase().includes(this._search)
            );
            return [...list].sort((a, b) => {
                const va = this._sortCol === 'ads' ? a.adsCount : a.name;
                const vb = this._sortCol === 'ads' ? b.adsCount : b.name;
                return typeof va === 'number'
                    ? (va - vb) * this._sortDir
                    : va.localeCompare(vb) * this._sortDir;
            });
        },

        _render() {
            const tbody = document.getElementById('brands-tbody');
            const countEl = document.getElementById('brands-count');
            const paginationEl = document.getElementById('brands-pagination');
            if (!tbody) return;

            const all = this._getList();
            const total = all.length;
            const totalPages = Math.max(1, Math.ceil(total / this._perPage));
            if (this._page > totalPages) this._page = totalPages;

            const slice = all.slice((this._page - 1) * this._perPage, this._page * this._perPage);
            if (countEl) countEl.textContent = `${total} brand${total !== 1 ? 's' : ''}`;

            if (!slice.length) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:2rem;color:var(--text-muted)">
                    ${this._activeTab === 'followed' ? 'Você não está seguindo nenhuma marca.' : 'Nenhuma marca encontrada.'}
                </td></tr>`;
                if (paginationEl) paginationEl.innerHTML = '';
                return;
            }

            tbody.innerHTML = slice.map(b => {
                const following = this._followed.has(b.id);
                const initials = b.name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
                const color = this._brandColor(b.id);
                return `<tr>
                    <td>
                        <div style="display:flex;align-items:center;gap:0.6rem">
                            <div class="brand-avatar" style="background:${color}">${this._esc(initials)}</div>
                            <div>
                                <div class="brand-name">${this._esc(b.name)}</div>
                                <div class="brand-page">@${this._esc(b.pageName)}</div>
                            </div>
                        </div>
                    </td>
                    <td><span class="brand-industry-tag">${this._esc(b.industry)}</span></td>
                    <td><span class="brand-ads-count">${b.adsCount.toLocaleString('pt-BR')}</span></td>
                    <td>
                        <button class="brand-follow-btn ${following ? 'brand-follow-btn-active' : ''}"
                            data-brand-id="${this._esc(b.id)}" title="${following ? 'Deixar de seguir' : 'Seguir'}">
                            <i data-lucide="${following ? 'check' : 'plus'}" style="width:14px;height:14px"></i>
                        </button>
                    </td>
                </tr>`;
            }).join('');

            if (paginationEl) {
                paginationEl.innerHTML = totalPages <= 1 ? '' : Array.from({ length: totalPages }, (_, i) =>
                    `<button class="brands-page-btn ${i + 1 === this._page ? 'brands-page-active' : ''}" data-brands-page="${i + 1}">${i + 1}</button>`
                ).join('');
            }

            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch (e) {}
        },

        _brandColor(id) {
            const colors = ['#8b5cf6', '#ec4899', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6'];
            let hash = 0;
            for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
            return colors[hash % colors.length];
        },

        _esc(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.Brands = Brands;
    Brands.init();
})();
