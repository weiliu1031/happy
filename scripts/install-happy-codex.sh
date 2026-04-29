#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${HAPPY_CODEX_REPO:-https://github.com/weiliu1031/happy.git}"
BRANCH="${HAPPY_CODEX_BRANCH:-main}"
INSTALL_DIR="${HAPPY_CODEX_INSTALL_DIR:-$HOME/.happy-codex/happy}"
PNPM_VERSION="${HAPPY_CODEX_PNPM_VERSION:-10.11.0}"

log() {
  printf '\n==> %s\n' "$*"
}

warn() {
  printf '\nWarning: %s\n' "$*" >&2
}

die() {
  printf '\nError: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

check_node() {
  require_command node
  node -e 'const major = Number(process.versions.node.split(".")[0]); process.exit(major >= 20 ? 0 : 1)' \
    || die "Node.js 20 or newer is required. Current version: $(node --version)"
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  require_command corepack
  log "Installing pnpm ${PNPM_VERSION} with corepack"
  corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate

  command -v pnpm >/dev/null 2>&1 || die "pnpm was not found after corepack setup"
}

ensure_clean_repo() {
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "Install directory has local changes: ${INSTALL_DIR}. Commit, stash, or remove them before updating."
  fi
}

checkout_repo() {
  if [ -d "${INSTALL_DIR}/.git" ]; then
    log "Updating existing checkout at ${INSTALL_DIR}"
    cd "${INSTALL_DIR}"
    ensure_clean_repo
    git fetch origin "${BRANCH}"
    git checkout "${BRANCH}"
    git pull --ff-only origin "${BRANCH}"
    return
  fi

  if [ -e "${INSTALL_DIR}" ]; then
    die "Install path exists but is not a git checkout: ${INSTALL_DIR}"
  fi

  log "Cloning ${REPO_URL} (${BRANCH}) into ${INSTALL_DIR}"
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"
}

main() {
  require_command git
  check_node
  ensure_pnpm
  checkout_repo

  log "Installing workspace dependencies"
  pnpm install --frozen-lockfile

  log "Building and linking the Happy CLI"
  pnpm --filter happy run cli:install

  if ! command -v codex >/dev/null 2>&1; then
    warn "Codex CLI was not found. Install it before running 'happy codex'."
    warn "Example: npm install -g @openai/codex"
  fi

  log "Installed Happy Codex fork"
  printf 'Repository: %s\n' "${INSTALL_DIR}"
  printf 'Branch:     %s\n' "${BRANCH}"
  printf 'Next:       happy codex\n'
}

main "$@"
