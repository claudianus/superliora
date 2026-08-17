/**
 * Installer command wrappers (POSIX bash, Windows .cmd/.ps1, SEA shims).
 * Pure string renderers so tests can encode every OS without being on it.
 */

import { join } from 'node:path';

export const WRAPPER_MARKER = 'Managed by superliora scripts/install-liora.mjs';
export const SEA_WRAPPER_MARKER = 'Managed by superliora install-superliora.mjs (SEA)';
export const DEFAULT_NODE_VERSION = '24';

export function quotePosix(value) {
  return `'${String(value).replaceAll(`'`, `'\\''`)}'`;
}

export function quotePowerShellSingle(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function renderPosixWrapper(appDir, nodeVersion = DEFAULT_NODE_VERSION) {
  return `#!/usr/bin/env bash
# ${WRAPPER_MARKER}
set -euo pipefail

app_root=${quotePosix(appDir)}
main_file="$app_root/dist/main.mjs"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # Keep local launches on the repository's supported Node major when nvm is available.
  # If nvm cannot switch, fall back to whatever node is already on PATH.
  . "$HOME/.nvm/nvm.sh"
  nvm use ${quotePosix(nodeVersion)} >/dev/null 2>&1 || true
fi

# Auto-update is controlled by tui.toml [upgrade].auto_install (default on).
# Opt out for a single process with SUPERLIORA_NO_AUTO_UPDATE=1 in the environment.

if [ -f "$main_file" ]; then
  exec node "$main_file" "$@"
fi

if command -v corepack >/dev/null 2>&1; then
  exec corepack pnpm -C "$app_root" run dev:cli-only -- "$@"
fi
if command -v pnpm >/dev/null 2>&1; then
  exec pnpm -C "$app_root" run dev:cli-only -- "$@"
fi
if [ -x "$HOME/.superliora/runtime/pnpm/pnpm" ]; then
  exec "$HOME/.superliora/runtime/pnpm/pnpm" -C "$app_root" run dev:cli-only -- "$@"
fi
echo "error: SuperLiora CLI bundle is missing: $main_file" >&2
echo "Build the CLI or re-run the installer with Node.js 24.15 or newer." >&2
exit 1
`;
}

/**
 * @param {string} appDir
 * @param {{ mainFile?: string, nodeFallback?: string }} [options]
 */
export function renderWindowsCmdWrapper(appDir, options = {}) {
  const mainFile = options.mainFile ?? join(appDir, 'dist', 'main.mjs');
  const nodeFallback = options.nodeFallback ?? 'node';
  return [
    '@echo off',
    `rem ${WRAPPER_MARKER}`,
    'setlocal',
    `set "LIORA_MAIN=${mainFile}"`,
    `set "LIORA_APP=${appDir}"`,
    `set "LIORA_NODE=${nodeFallback}"`,
    'if exist "%LIORA_MAIN%" (',
    '  where node >nul 2>&1',
    '  if not errorlevel 1 (',
    '    node "%LIORA_MAIN%" %*',
    '    exit /b %ERRORLEVEL%',
    '  )',
    '  "%LIORA_NODE%" "%LIORA_MAIN%" %*',
    '  exit /b %ERRORLEVEL%',
    ')',
    'where corepack >nul 2>&1',
    'if not errorlevel 1 (',
    '  corepack pnpm -C "%LIORA_APP%" run dev:cli-only -- %*',
    '  exit /b %ERRORLEVEL%',
    ')',
    'if exist "%USERPROFILE%\\.superliora\\runtime\\pnpm\\pnpm.exe" (',
    '  "%USERPROFILE%\\.superliora\\runtime\\pnpm\\pnpm.exe" -C "%LIORA_APP%" run dev:cli-only -- %*',
    '  exit /b %ERRORLEVEL%',
    ')',
    'where pnpm >nul 2>&1',
    'if not errorlevel 1 (',
    '  pnpm -C "%LIORA_APP%" run dev:cli-only -- %*',
    '  exit /b %ERRORLEVEL%',
    ')',
    'echo error: SuperLiora CLI bundle is missing: %LIORA_MAIN% 1>&2',
    'echo Build the CLI or re-run the installer with Node.js 24.15 or newer. 1>&2',
    'exit /b 1',
    '',
  ].join('\r\n');
}

/**
 * @param {string} appDir
 * @param {{ mainFile?: string, nodeFallback?: string }} [options]
 */
export function renderWindowsPs1Wrapper(appDir, options = {}) {
  const mainFile = options.mainFile ?? join(appDir, 'dist', 'main.mjs');
  const nodeFallback = options.nodeFallback ?? 'node';
  return `# ${WRAPPER_MARKER}
$main = ${quotePowerShellSingle(mainFile)}
$app = ${quotePowerShellSingle(appDir)}
$nodeFallback = ${quotePowerShellSingle(nodeFallback)}
if (Test-Path -LiteralPath $main) {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $nodeCmd) {
    & node $main @args
    exit $LASTEXITCODE
  }
  & $nodeFallback $main @args
  exit $LASTEXITCODE
}
$corepack = Get-Command corepack -ErrorAction SilentlyContinue
if ($null -ne $corepack) {
  & corepack pnpm -C $app run dev:cli-only -- @args
  exit $LASTEXITCODE
}
$runtimePnpm = Join-Path $env:USERPROFILE '.superliora\\runtime\\pnpm\\pnpm.exe'
if (Test-Path -LiteralPath $runtimePnpm) {
  & $runtimePnpm -C $app run dev:cli-only -- @args
  exit $LASTEXITCODE
}
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if ($null -ne $pnpm) {
  & pnpm -C $app run dev:cli-only -- @args
  exit $LASTEXITCODE
}
Write-Error ("SuperLiora CLI bundle is missing: " + $main)
exit 1
`;
}

export function renderWindowsSeaCmd(exeName) {
  return `@echo off\r\nrem ${SEA_WRAPPER_MARKER}\r\n"%~dp0${exeName}" %*\r\n`;
}

export function renderPosixSeaShim(binaryPath) {
  return `#!/usr/bin/env bash
# ${WRAPPER_MARKER} (SEA)
set -euo pipefail
exec ${quotePosix(binaryPath)} "$@"
`;
}

export function renderWindowsSeaShim(binaryPath) {
  return `@echo off\r\nrem ${WRAPPER_MARKER} (SEA)\r\n"${binaryPath}" %*\r\n`;
}
