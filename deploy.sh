#!/usr/bin/env bash
# ============================================================
#  deploy.sh  —  Sincroniza tudo: SSD (git) + GitHub + Cloudflare Pages
#  Uso:
#    ./deploy.sh                      → mensagem automática com data/hora
#    ./deploy.sh "descrição do que fez"
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_TMP="/tmp/deploy-app-calculadora"
CF_PROJECT="app-calculadora-lucas"
BRANCH="main"

# Cor para logs
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { echo -e "${CYAN}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }

cd "$PROJECT_DIR"

# ── 1. Git: salvar no SSD ──────────────────────────────────
log "Salvando no SSD (git)..."
git add -A

if git diff --cached --quiet; then
  warn "Nenhuma mudança nova — pulando commit."
else
  MSG="${1:-"update: $(date '+%d/%m/%Y %H:%M')"}"
  git commit -m "$MSG"
  ok "Commit criado: \"$MSG\""
fi

# ── 2. GitHub: push ────────────────────────────────────────
log "Enviando para GitHub..."
git push origin "$BRANCH"
ok "GitHub atualizado → https://github.com/lpgaspar25/ecommerce-tracker"

# ── 3. Cloudflare Pages: deploy ────────────────────────────
log "Preparando deploy para Cloudflare Pages..."
rm -rf "$DEPLOY_TMP"
rsync -a \
  --exclude='node_modules' \
  --exclude='.tools' \
  --exclude='.wrangler' \
  --exclude='.git' \
  --exclude='.claude' \
  --exclude='auth_info_baileys' \
  --exclude='data/*.db' \
  --exclude='deploy.sh' \
  "$PROJECT_DIR/" "$DEPLOY_TMP/"

log "Fazendo deploy no Cloudflare..."
cd "$DEPLOY_TMP"
npx wrangler@latest pages deploy . \
  --project-name "$CF_PROJECT" \
  --branch "$BRANCH" 2>&1 | grep -E '(Uploading|Deploying|Deployment complete|ERROR|Error)'

ok "Cloudflare Pages atualizado → https://app-calculadora-lucas.pages.dev"

echo ""
echo -e "${GREEN}🚀 Tudo sincronizado!${NC}"
echo "   📁 SSD     → $PROJECT_DIR"
echo "   🐙 GitHub  → https://github.com/lpgaspar25/ecommerce-tracker"
echo "   ☁️  Nuvem   → https://app-calculadora-lucas.pages.dev"
