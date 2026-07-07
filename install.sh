#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO_URL="https://github.com/claudianus/superliora.git"
DEFAULT_REF="main"
DEFAULT_INSTALL_DIR="${HOME}/.superliora/source"
DEFAULT_BIN_DIR="${HOME}/.local/bin"
DEFAULT_COMMAND="liora"
DEFAULT_NODE_MIN="24.15.0"

REPO_URL="${SUPERLIORA_REPO_URL:-$DEFAULT_REPO_URL}"
REF="${SUPERLIORA_REF:-$DEFAULT_REF}"
INSTALL_DIR="${SUPERLIORA_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
BIN_DIR="${SUPERLIORA_BIN_DIR:-$DEFAULT_BIN_DIR}"
COMMAND_NAME="${SUPERLIORA_COMMAND:-$DEFAULT_COMMAND}"
NODE_MIN="${SUPERLIORA_NODE_MIN:-$DEFAULT_NODE_MIN}"
FORCE=0
NO_BUILD=0
NO_SHELL_RC=0
NO_BROWSER_USE=0
NO_COMPUTER_USE=0

usage() {
  cat <<EOF
Usage: install.sh [options]

Installs SuperLiora from GitHub source and creates the liora command.

Options:
  --repo <url>          Git repository URL. Default: ${DEFAULT_REPO_URL}
  --ref <ref>           Branch, tag, or ref to install. Default: ${DEFAULT_REF}
  --install-dir <path>  Source checkout directory. Default: ~/.superliora/source
  --bin-dir <path>      Command install directory. Default: ~/.local/bin
  --command <name>      Command name. Default: liora
  --node-min <version>  Minimum Node.js version. Default: ${DEFAULT_NODE_MIN}
  --force              Replace an existing checkout/wrapper when needed
  --no-build           Skip pnpm install/build after checkout
  --no-browser-use     Skip CloakBrowser binary pre-install
  --no-computer-use    Skip cua-driver computer-use install
  --no-shell-rc        Do not edit shell startup files
  -h, --help           Show this help

Environment variables:
  SUPERLIORA_REPO_URL, SUPERLIORA_REF, SUPERLIORA_INSTALL_DIR,
  SUPERLIORA_BIN_DIR, SUPERLIORA_COMMAND, SUPERLIORA_NODE_MIN,
  SUPERLIORA_SKIP_BROWSER_USE, SUPERLIORA_SKIP_COMPUTER_USE
EOF
}

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

expand_path() {
  case "$1" in
    "~") printf '%s\n' "$HOME" ;;
    "~/"*) printf '%s/%s\n' "$HOME" "${1#~/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      [ "$#" -ge 2 ] || die "--repo requires a value"
      REPO_URL="$2"
      shift 2
      ;;
    --repo=*)
      REPO_URL="${1#--repo=}"
      shift
      ;;
    --ref)
      [ "$#" -ge 2 ] || die "--ref requires a value"
      REF="$2"
      shift 2
      ;;
    --ref=*)
      REF="${1#--ref=}"
      shift
      ;;
    --install-dir)
      [ "$#" -ge 2 ] || die "--install-dir requires a value"
      INSTALL_DIR="$2"
      shift 2
      ;;
    --install-dir=*)
      INSTALL_DIR="${1#--install-dir=}"
      shift
      ;;
    --bin-dir)
      [ "$#" -ge 2 ] || die "--bin-dir requires a value"
      BIN_DIR="$2"
      shift 2
      ;;
    --bin-dir=*)
      BIN_DIR="${1#--bin-dir=}"
      shift
      ;;
    --command)
      [ "$#" -ge 2 ] || die "--command requires a value"
      COMMAND_NAME="$2"
      shift 2
      ;;
    --command=*)
      COMMAND_NAME="${1#--command=}"
      shift
      ;;
    --node-min)
      [ "$#" -ge 2 ] || die "--node-min requires a value"
      NODE_MIN="$2"
      shift 2
      ;;
    --node-min=*)
      NODE_MIN="${1#--node-min=}"
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --no-build)
      NO_BUILD=1
      shift
      ;;
    --no-browser-use)
      NO_BROWSER_USE=1
      shift
      ;;
    --no-computer-use)
      NO_COMPUTER_USE=1
      shift
      ;;
    --no-shell-rc)
      NO_SHELL_RC=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

INSTALL_DIR="$(expand_path "$INSTALL_DIR")"
BIN_DIR="$(expand_path "$BIN_DIR")"

case "$(uname -s)" in
  Darwin|Linux) ;;
  MINGW*|MSYS*|CYGWIN*)
    die "Use install.ps1 on Windows: irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex"
    ;;
esac

case "$COMMAND_NAME" in
  *[!A-Za-z0-9._-]*|'') die "--command must be a simple command name" ;;
esac

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

need_cmd git
need_cmd node
need_cmd corepack

node -e '
const actual = process.versions.node.split(".").map(Number);
const required = process.argv[1].split(".").map(Number);
const ok =
  actual[0] > required[0] ||
  (actual[0] === required[0] && (actual[1] > required[1] ||
  (actual[1] === required[1] && actual[2] >= required[2])));
process.exit(ok ? 0 : 1);
' "$NODE_MIN" || die "Node.js >= ${NODE_MIN} is required (found $(node -p 'process.versions.node'))"

ensure_pnpm() {
  if COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --version >/dev/null 2>&1; then
    return
  fi
  corepack enable pnpm >/dev/null 2>&1 || true
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --version >/dev/null 2>&1 || \
    die "pnpm is required; enable Corepack or install pnpm"
}

safe_remove_dir() {
  local target="$1"
  [ -n "$target" ] || die "refusing to remove an empty path"
  [ "$target" != "$HOME" ] || die "refusing to remove HOME"
  [ "$target" != "/" ] || die "refusing to remove /"
  rm -rf "$target"
}

ensure_pnpm

if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  if [ "$FORCE" -eq 1 ]; then
    log "Removing non-git install directory: $INSTALL_DIR"
    safe_remove_dir "$INSTALL_DIR"
  else
    die "$INSTALL_DIR exists but is not a git checkout; pass --force to replace it"
  fi
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating SuperLiora source in $INSTALL_DIR"
  git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
  git -C "$INSTALL_DIR" checkout --force FETCH_HEAD
  git -C "$INSTALL_DIR" reset --hard FETCH_HEAD
else
  log "Cloning SuperLiora source into $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
  git -C "$INSTALL_DIR" checkout --force FETCH_HEAD
fi

if [ "$NO_BUILD" -eq 0 ]; then
  log "Installing dependencies and building CLI"
  (
    cd "$INSTALL_DIR"
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm run build:packages
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm -C apps/liora run build
  )

  if [ "$NO_BROWSER_USE" -eq 0 ] && [ "${SUPERLIORA_SKIP_BROWSER_USE:-0}" != "1" ]; then
    log "Pre-installing Lightpanda browser-use runtime (primary)"
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) LIGHTPANDA_ASSET=lightpanda-aarch64-macos ;;
    Darwin-x86_64) LIGHTPANDA_ASSET=lightpanda-x86_64-macos ;;
    Linux-x86_64) LIGHTPANDA_ASSET=lightpanda-x86_64-linux ;;
    Linux-aarch64) LIGHTPANDA_ASSET=lightpanda-aarch64-linux ;;
    *) LIGHTPANDA_ASSET= ;;
  esac
  if [ -n "$LIGHTPANDA_ASSET" ]; then
    LIGHTPANDA_CACHE="${LIGHTPANDA_CACHE_DIR:-$HOME/.cache/superliora-lightpanda}"
    mkdir -p "$LIGHTPANDA_CACHE"
    if ! curl -fsSL "https://github.com/lightpanda-io/browser/releases/download/nightly/$LIGHTPANDA_ASSET" \
      -o "$LIGHTPANDA_CACHE/lightpanda"; then
      log "warning: Lightpanda pre-install failed; retry with '$COMMAND_NAME browser-use install'"
    else
      chmod +x "$LIGHTPANDA_CACHE/lightpanda"
    fi
  else
    log "warning: Lightpanda auto-install is not supported on this platform; CloakBrowser fallback only"
  fi

    log "Pre-installing CloakBrowser fallback cache"
    (
      cd "$INSTALL_DIR"
      COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @superliora/gui-use exec cloakbrowser install
    ) || log "warning: CloakBrowser fallback pre-install failed; retry with '$COMMAND_NAME browser-use install'"
  fi

  if [ "$NO_COMPUTER_USE" -eq 0 ] && [ "${SUPERLIORA_SKIP_COMPUTER_USE:-0}" != "1" ]; then
    case "$(uname -s)" in
      Darwin|Linux)
        log "Installing cua-driver computer-use runtime"
        /bin/bash -c 'curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh | /bin/bash' || \
          log "warning: cua-driver install failed; retry with '$COMMAND_NAME computer-use install'"
        ;;
      *)
        log "warning: cua-driver auto-install is not supported on this platform"
        ;;
    esac
  fi
fi

install_args=("--bin-dir" "$BIN_DIR" "--name" "$COMMAND_NAME")
if [ "$FORCE" -eq 1 ]; then
  install_args+=("--force")
fi
if [ "$NO_SHELL_RC" -eq 1 ]; then
  install_args+=("--no-shell-rc")
fi

node "$INSTALL_DIR/scripts/install-liora.mjs" "${install_args[@]}"

if [ -x "$BIN_DIR/$COMMAND_NAME" ]; then
  "$BIN_DIR/$COMMAND_NAME" --version >/dev/null 2>&1 || true
fi

log ""
log "SuperLiora is installed from GitHub source."
log "Command: $COMMAND_NAME"
log "Source:  $INSTALL_DIR"
log "Bin dir: $BIN_DIR"
