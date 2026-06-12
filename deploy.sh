#!/usr/bin/env bash
# ============================================================
#  deploy.sh  —  Sincroniza tudo:
#    📁 SSD (este local, git)
#    💾 Backup local no Mac (~/Documents/Claude/Projects/ecommerce-tracker)
#    🐙 GitHub
#    ☁️  Cloudflare Pages
#
#  Uso:
#    ./deploy.sh                      → mensagem automática com data/hora
#    ./deploy.sh "descrição do que fez"
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAC_BACKUP="$HOME/Documents/Claude/Projects/ecommerce-tracker"
# Cópias legadas que o Lucas costumava abrir — também serão espelhadas pra ficar tudo igual.
LEGACY_MIRRORS=(
  "$HOME/Downloads/_Duplicatas-Para-Revisar/APP CALCULADORA - cópia"
)
DEPLOY_TMP="/tmp/deploy-app-calculadora"
CF_PROJECT="app-calculadora-lucas"
BRANCH="main"

# Cor para logs
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'

log()  { echo -e "${CYAN}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠  $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; }

cd "$PROJECT_DIR"

# ── 1. Git: salvar no SSD (origem) ─────────────────────────
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

# ── 3. Backup local no Mac (caso o SSD seja desconectado) ──
if [ -d "$HOME/Documents/Claude/Projects" ]; then
  log "Espelhando backup para o Mac interno..."
  mkdir -p "$MAC_BACKUP"
  rsync -a --delete \
    --exclude='node_modules' \
    --exclude='.tools' \
    --exclude='.wrangler' \
    --exclude='.claude' \
    --exclude='._*' \
    --exclude='.DS_Store' \
    "$PROJECT_DIR/" "$MAC_BACKUP/"
  ok "Backup local pronto → $MAC_BACKUP"
fi

# ── 3b. Espelhar cópias legadas (pra quando o usuário abre o caminho antigo) ──
for MIRROR in "${LEGACY_MIRRORS[@]}"; do
  if [ -d "$MIRROR" ]; then
    log "Espelhando cópia legada: $MIRROR"
    rsync -a --delete \
      --exclude='node_modules' \
      --exclude='.tools' \
      --exclude='.wrangler' \
      --exclude='.git' \
      --exclude='.claude' \
      --exclude='._*' \
      --exclude='.DS_Store' \
      --exclude='auth_info_baileys' \
      --exclude='data/*.db' \
      --exclude='deploy.sh' \
      "$PROJECT_DIR/" "$MIRROR/"
    ok "Espelho atualizado → $MIRROR"
  fi
done

# ── 4. Cloudflare Pages: deploy ────────────────────────────
log "Preparando bundle de deploy..."
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
  --exclude='._*' \
  --exclude='.DS_Store' \
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
echo "   💾 Mac     → $MAC_BACKUP"
for MIRROR in "${LEGACY_MIRRORS[@]}"; do
  [ -d "$MIRROR" ] && echo "   🪞 Espelho → $MIRROR"
done
echo "   🐙 GitHub  → https://github.com/lpgaspar25/ecommerce-tracker"
echo "   ☁️  Nuvem   → https://app-calculadora-lucas.pages.dev"
