#!/usr/bin/env bash
# SuperLiora bootstrap — ensure Node, then run scripts/install-superliora.mjs
set -euo pipefail

DEFAULT_REPO_URL="https://github.com/claudianus/superliora.git"
DEFAULT_REF="main"
DEFAULT_INSTALL_DIR="${HOME}/.superliora/source"
DEFAULT_BIN_DIR="${HOME}/.local/bin"
DEFAULT_COMMAND="liora"
DEFAULT_NODE_MIN="24.15.0"
DEFAULT_RAW_BASE="https://raw.githubusercontent.com/claudianus/superliora/main"
DEFAULT_MANIFEST_URL="https://github.com/claudianus/superliora/releases/latest/download/manifest.json"

REPO_URL="${SUPERLIORA_REPO_URL:-$DEFAULT_REPO_URL}"
REF="${SUPERLIORA_REF:-$DEFAULT_REF}"
INSTALL_DIR="${SUPERLIORA_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
BIN_DIR="${SUPERLIORA_BIN_DIR:-$DEFAULT_BIN_DIR}"
COMMAND_NAME="${SUPERLIORA_COMMAND:-$DEFAULT_COMMAND}"
NODE_MIN="${SUPERLIORA_NODE_MIN:-$DEFAULT_NODE_MIN}"
RAW_BASE="${SUPERLIORA_RAW_BASE:-$DEFAULT_RAW_BASE}"
MANIFEST_URL="${SUPERLIORA_MANIFEST_URL:-$DEFAULT_MANIFEST_URL}"
FORCE=0
NO_BUILD=0
NO_SHELL_RC=0
NO_BROWSER_USE=0
NO_COMPUTER_USE=0
NO_RETRIEVAL=0
NO_GIT=0
NO_TERMINAL=0
PREFER_SOURCE=0
FROM_MAIN=0
FORCE_PREBUILT=0
VERSION="${SUPERLIORA_VERSION:-}"

STAGE_MARKER_PREFIX='__LIORA_UPGRADE_STAGE__='

usage() {
  cat <<EOF
Usage: install.sh [options]

Installs SuperLiora from the latest published GitHub Release (prebuilt SEA)
and creates the liora command. Pass --main to build tip of origin/main instead.

Options:
  --repo <url>          Git repository URL. Default: ${DEFAULT_REPO_URL}
  --ref <ref>           Branch, tag, or ref (source mode; ignored with --main). Default: ${DEFAULT_REF}
  --install-dir <path>  Source checkout directory. Default: ~/.superliora/source
  --bin-dir <path>      Command install directory. Default: ~/.local/bin
  --command <name>      Command name. Default: liora
  --node-min <version>  Minimum Node.js version. Default: ${DEFAULT_NODE_MIN}
  --manifest <url>      Release manifest.json URL
  --version <semver>    Pin prebuilt install to a release tag (e.g. 0.5.0)
  --force               Replace an existing checkout/wrapper when needed
  --no-build            Skip pnpm install/build after checkout
  --no-browser-use      Skip browser-use sidecar install
  --no-computer-use     Skip cua-driver computer-use install
  --no-retrieval        Skip local Granite-97M embedder + passage indexes
  --no-git              Skip Git / Git Bash bootstrap
  --no-terminal         Skip Windows Terminal install / profile (Windows)
  --no-shell-rc         Do not edit shell startup files
  --main                Ignore releases; build tip of origin/main from source
  --prefer-source       Skip prebuilt; build from source (--ref)
  --force-prebuilt      Fail if prebuilt unavailable (default without --main/--prefer-source)
  -h, --help            Show this help

Environment variables:
  SUPERLIORA_REPO_URL, SUPERLIORA_REF, SUPERLIORA_INSTALL_DIR,
  SUPERLIORA_BIN_DIR, SUPERLIORA_COMMAND, SUPERLIORA_NODE_MIN,
  SUPERLIORA_MANIFEST_URL, SUPERLIORA_VERSION, SUPERLIORA_RAW_BASE,
  SUPERLIORA_SKIP_BROWSER_USE, SUPERLIORA_SKIP_COMPUTER_USE,
  SUPERLIORA_SKIP_RETRIEVAL, SUPERLIORA_SKIP_GIT, SUPERLIORA_NO_TERMINAL,
  SUPERLIORA_SKIP_TERMINAL, SUPERLIORA_PREFER_SOURCE,
  SUPERLIORA_FROM_MAIN, SUPERLIORA_FORCE_PREBUILT, SUPERLIORA_NO_SHELL_RC
EOF
}

die() {
  printf '%sfailed\n' "$STAGE_MARKER_PREFIX" >&2
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
    --repo) REPO_URL="$2"; shift 2 ;;
    --repo=*) REPO_URL="${1#--repo=}"; shift ;;
    --ref) REF="$2"; shift 2 ;;
    --ref=*) REF="${1#--ref=}"; shift ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --install-dir=*) INSTALL_DIR="${1#--install-dir=}"; shift ;;
    --bin-dir) BIN_DIR="$2"; shift 2 ;;
    --bin-dir=*) BIN_DIR="${1#--bin-dir=}"; shift ;;
    --command) COMMAND_NAME="$2"; shift 2 ;;
    --command=*) COMMAND_NAME="${1#--command=}"; shift ;;
    --node-min) NODE_MIN="$2"; shift 2 ;;
    --node-min=*) NODE_MIN="${1#--node-min=}"; shift ;;
    --manifest) MANIFEST_URL="$2"; shift 2 ;;
    --manifest=*) MANIFEST_URL="${1#--manifest=}"; shift ;;
    --version) VERSION="$2"; shift 2 ;;
    --version=*) VERSION="${1#--version=}"; shift ;;
    --force) FORCE=1; shift ;;
    --no-build) NO_BUILD=1; shift ;;
    --no-browser-use) NO_BROWSER_USE=1; shift ;;
    --no-computer-use) NO_COMPUTER_USE=1; shift ;;
    --no-retrieval) NO_RETRIEVAL=1; shift ;;
    --no-git) NO_GIT=1; shift ;;
    --no-terminal) NO_TERMINAL=1; shift ;;
    --no-shell-rc) NO_SHELL_RC=1; shift ;;
    --prefer-source) PREFER_SOURCE=1; shift ;;
    --main) FROM_MAIN=1; shift ;;
    --force-prebuilt) FORCE_PREBUILT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

if [ "${SUPERLIORA_FROM_MAIN:-0}" = "1" ]; then
  FROM_MAIN=1
fi
if [ "${SUPERLIORA_NO_SHELL_RC:-0}" = "1" ]; then
  NO_SHELL_RC=1
fi
if [ "${SUPERLIORA_NO_TERMINAL:-0}" = "1" ] || [ "${SUPERLIORA_SKIP_TERMINAL:-0}" = "1" ]; then
  NO_TERMINAL=1
fi

INSTALL_DIR="$(expand_path "$INSTALL_DIR")"
BIN_DIR="$(expand_path "$BIN_DIR")"

case "$(uname -s)" in
  Darwin|Linux) ;;
  MINGW*|MSYS*|CYGWIN*)
    die "On Windows use install.ps1 (irm ... | iex) or install.cmd from cmd.exe"
    ;;
esac

case "$COMMAND_NAME" in
  *[!A-Za-z0-9._-]*|'') die "--command must be a simple command name" ;;
esac

printf '%sbootstrapping\n' "$STAGE_MARKER_PREFIX"

version_gte() {
  # $1 actual, $2 required
  node_bin="$3"
  "$node_bin" -e '
const actual = process.argv[1].split(".").map(Number);
const required = process.argv[2].split(".").map(Number);
const ok =
  actual[0] > required[0] ||
  (actual[0] === required[0] && (actual[1] > required[1] ||
  (actual[1] === required[1] && actual[2] >= required[2])));
process.exit(ok ? 0 : 1);
' "$1" "$2"
}

find_node() {
  if command -v node >/dev/null 2>&1; then
    local ver
    ver="$(node -p 'process.versions.node' 2>/dev/null || true)"
    if [ -n "$ver" ] && version_gte "$ver" "$NODE_MIN" node; then
      command -v node
      return 0
    fi
  fi
  return 1
}

bootstrap_node() {
  local os arch slug url runtime archive
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "unsupported OS for Node bootstrap: $(uname -s)" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *) die "unsupported arch for Node bootstrap: $(uname -m)" ;;
  esac
  slug="node-v${NODE_MIN}-${os}-${arch}"
  url="https://nodejs.org/dist/v${NODE_MIN}/${slug}.tar.gz"
  runtime="${HOME}/.superliora/runtime/node"
  archive="${runtime}/${slug}.tar.gz"
  mkdir -p "$runtime"
  if [ ! -x "${runtime}/${slug}/bin/node" ]; then
    printf 'Downloading Node.js %s …\n' "$NODE_MIN"
    curl -fsSL "$url" -o "$archive" || die "failed to download Node from $url"
    tar -xzf "$archive" -C "$runtime"
    rm -f "$archive"
  fi
  export PATH="${runtime}/${slug}/bin:$PATH"
  command -v node >/dev/null 2>&1 || die "Node bootstrap failed"
}

NODE_BIN=""
if NODE_BIN="$(find_node)"; then
  :
else
  bootstrap_node
  NODE_BIN="$(command -v node)"
fi

# Locate orchestrator: local checkout next to this script, else download bundle.
SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

ORCH=""
INSTALL_MOD_DIR=""
if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/scripts/install-superliora.mjs" ]; then
  ORCH="$SCRIPT_DIR/scripts/install-superliora.mjs"
  INSTALL_MOD_DIR="$SCRIPT_DIR/scripts/install"
else
  BUNDLE_DIR="${TMPDIR:-/tmp}/superliora-install-$$"
  mkdir -p "$BUNDLE_DIR/scripts/install"
  fetch_raw() {
    local rel="$1" dest="$2"
    curl -fsSL "${RAW_BASE}/${rel}" -o "$dest" || die "failed to download ${RAW_BASE}/${rel}"
  }
  fetch_raw "scripts/install-superliora.mjs" "$BUNDLE_DIR/scripts/install-superliora.mjs"
  fetch_raw "scripts/install-liora.mjs" "$BUNDLE_DIR/scripts/install-liora.mjs"
  for f in platform.mjs ensure-node.mjs ensure-git.mjs ensure-pnpm.mjs theatre.mjs download.mjs prebuilt.mjs source.mjs sidecars.mjs path.mjs spawn.mjs wrappers.mjs ensure-terminal.mjs ensure-winget.mjs ensure-nerd-font.mjs ensure-oh-my-posh.mjs ensure-shell-vibe.mjs; do
    fetch_raw "scripts/install/$f" "$BUNDLE_DIR/scripts/install/$f"
  done
  ORCH="$BUNDLE_DIR/scripts/install-superliora.mjs"
  INSTALL_MOD_DIR="$BUNDLE_DIR/scripts/install"
  trap 'rm -rf "$BUNDLE_DIR"' EXIT
fi

if [ -n "$VERSION" ] && [ "$FROM_MAIN" -eq 1 ]; then
  die "--version cannot be combined with --main"
fi

orch_args=(
  --repo "$REPO_URL"
  --ref "$REF"
  --install-dir "$INSTALL_DIR"
  --bin-dir "$BIN_DIR"
  --command "$COMMAND_NAME"
  --node-min "$NODE_MIN"
  --manifest "$MANIFEST_URL"
)
[ -n "$VERSION" ] && orch_args+=(--version "$VERSION")
[ "$FORCE" -eq 1 ] && orch_args+=(--force)
[ "$NO_BUILD" -eq 1 ] && orch_args+=(--no-build)
[ "$NO_SHELL_RC" -eq 1 ] && orch_args+=(--no-shell-rc)
[ "$NO_BROWSER_USE" -eq 1 ] && orch_args+=(--no-browser-use)
[ "$NO_COMPUTER_USE" -eq 1 ] && orch_args+=(--no-computer-use)
[ "$NO_RETRIEVAL" -eq 1 ] && orch_args+=(--no-retrieval)
[ "$NO_GIT" -eq 1 ] && orch_args+=(--no-git)
[ "$NO_TERMINAL" -eq 1 ] && orch_args+=(--no-terminal)
[ "$PREFER_SOURCE" -eq 1 ] && orch_args+=(--prefer-source)
[ "$FROM_MAIN" -eq 1 ] && orch_args+=(--main)
[ "$FORCE_PREBUILT" -eq 1 ] && orch_args+=(--force-prebuilt)

# shellcheck disable=SC2093
exec "$NODE_BIN" "$ORCH" "${orch_args[@]}"
