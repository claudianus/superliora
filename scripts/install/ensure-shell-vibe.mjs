/**
 * Host vibe shell: Oh My Posh, zoxide, fzf, and a managed profile block.
 * Windows also gets Terminal-Icons + CurrentUser RemoteSigned.
 * User-local, best-effort, never throws. Does not force PowerShell 7 (CET).
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { downloadToFile } from './download.mjs';
import { ensureOhMyPosh, findOhMyPosh, ohMyPoshRuntimeDir } from './ensure-oh-my-posh.mjs';
import { findWinget } from './ensure-winget.mjs';
import { hostJoin } from './host-path.mjs';
import { applyUserPathWin } from './path.mjs';
import { archId, defaultHome } from './platform.mjs';

export const ZOXIDE_WINGET_ID = 'ajeetdsouza.zoxide';
export const FZF_WINGET_ID = 'junegunn.fzf';
export const ZOXIDE_VERSION = '0.9.8';
export const FZF_VERSION = '0.67.0';
export const ZOXIDE_ZIP_URL =
  `https://github.com/ajeetdsouza/zoxide/releases/download/v${ZOXIDE_VERSION}/zoxide-${ZOXIDE_VERSION}-x86_64-pc-windows-msvc.zip`;
export const FZF_ZIP_URL =
  `https://github.com/junegunn/fzf/releases/download/v${FZF_VERSION}/fzf-${FZF_VERSION}-windows_amd64.zip`;

export function zoxideArchiveUrl(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return ZOXIDE_ZIP_URL;
  const cpu = archId(arch);
  if (platform === 'darwin') {
    return `https://github.com/ajeetdsouza/zoxide/releases/download/v${ZOXIDE_VERSION}/zoxide-${ZOXIDE_VERSION}-${cpu === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin.tar.gz`;
  }
  return `https://github.com/ajeetdsouza/zoxide/releases/download/v${ZOXIDE_VERSION}/zoxide-${ZOXIDE_VERSION}-${cpu === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl.tar.gz`;
}

export function fzfArchiveUrl(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return FZF_ZIP_URL;
  const cpu = archId(arch);
  if (platform === 'darwin') {
    return `https://github.com/junegunn/fzf/releases/download/v${FZF_VERSION}/fzf-${FZF_VERSION}-darwin_${cpu === 'arm64' ? 'arm64' : 'amd64'}.tar.gz`;
  }
  return `https://github.com/junegunn/fzf/releases/download/v${FZF_VERSION}/fzf-${FZF_VERSION}-linux_${cpu === 'arm64' ? 'arm64' : 'amd64'}.tar.gz`;
}

export const VIBE_PROFILE_MARKER_START = '# >>> superliora-vibe >>>';
export const VIBE_PROFILE_MARKER_END = '# <<< superliora-vibe <<<';

export function skipShellVibeRequested(env = process.env, options = {}) {
  if (options.skip === true) return true;
  return env.SUPERLIORA_NO_SHELL_VIBE === '1';
}

export function vibeRuntimeDir(name, env = process.env, platform = process.platform) {
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  return hostJoin(platform, home, '.superliora', 'runtime', name);
}

export function defaultPowerShellProfilePaths(env = process.env) {
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  return [
    winJoin(home, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    winJoin(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
  ];
}

export function defaultUnixProfilePaths(env = process.env) {
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  return [hostJoin('linux', home, '.zshrc'), hostJoin('linux', home, '.bashrc')];
}

export function findToolExe(name, options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const isFile = options.isFile ?? ((p) => existsSync(p));
  const which = options.which ?? defaultWhich;
  const fromPath = which(name, env) ?? which(`${name}.exe`, env);
  if (fromPath && isFile(fromPath)) return { path: fromPath, source: 'path' };
  const exeName = platform === 'win32' ? `${name}.exe` : name;
  const dir = vibeRuntimeDir(name, env, platform);
  const candidate = hostJoin(platform, dir, exeName);
  if (isFile(candidate)) return { path: candidate, source: 'runtime' };
  return null;
}

export function renderVibeProfileBlock() {
  return `${VIBE_PROFILE_MARKER_START}
$ErrorActionPreference = 'Continue'
try {
    [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $global:OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {}

$env:VIRTUAL_ENV_DISABLE_PROMPT = '1'
$env:FZF_DEFAULT_OPTS = '--color=fg:#E6EDF3,bg:#0D1422,hl:#00D5FF,fg+:#FFFFFF,bg+:#162033,hl+:#22D3EE,info:#9AA7B2,prompt:#00D5FF,pointer:#A78BFA,marker:#36D399,spinner:#22D3EE,header:#6F7A86'

foreach ($dir in @(
    (Join-Path $env:USERPROFILE '.superliora\\runtime\\oh-my-posh'),
    (Join-Path $env:USERPROFILE '.superliora\\runtime\\zoxide'),
    (Join-Path $env:USERPROFILE '.superliora\\runtime\\fzf')
)) {
    if ((Test-Path -LiteralPath $dir) -and ($env:PATH -notlike ('*' + $dir + '*'))) {
        $env:PATH = "$dir;$env:PATH"
    }
}

if (Get-Module -ListAvailable -Name PSReadLine) {
    Import-Module PSReadLine
    Set-PSReadLineOption -EditMode Windows
    Set-PSReadLineOption -BellStyle None
    Set-PSReadLineOption -HistorySearchCursorMovesToEnd
    Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete
    Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
    Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
    Set-PSReadLineOption -Colors @{
        Command          = '#00D5FF'
        Parameter        = '#F5C542'
        String           = '#36D399'
        Operator         = '#8BE9FD'
        Variable         = '#A78BFA'
        Comment          = '#6F7A86'
        Keyword          = '#B784FF'
        Type             = '#00D5FF'
        Number           = '#FF91A6'
        Member           = '#22D3EE'
        Emphasis         = '#C4B5FD'
        Error            = '#FF5C7A'
        Selection        = '#123B5A'
        InlinePrediction = '#6F7A86'
    }
    try {
        if ($PSVersionTable.PSVersion.Major -ge 7) {
            Set-PSReadLineOption -PredictionSource HistoryAndPlugin
            Set-PSReadLineOption -PredictionViewStyle ListView
        } else {
            Set-PSReadLineOption -PredictionSource History
        }
    } catch {}
}

if (Get-Module -ListAvailable -Name Terminal-Icons) {
    Import-Module Terminal-Icons
}

$ompConfig = Join-Path $env:USERPROFILE '.superliora\\oh-my-posh\\superliora-neon-noir.omp.json'
$ompCmd = Get-Command oh-my-posh -ErrorAction SilentlyContinue
if (-not $ompCmd) {
    foreach ($candidate in @(
        (Join-Path $env:USERPROFILE '.superliora\\runtime\\oh-my-posh\\oh-my-posh.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\\oh-my-posh\\bin\\oh-my-posh.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\\WindowsApps\\oh-my-posh.exe')
    )) {
        if (Test-Path -LiteralPath $candidate) { $ompCmd = $candidate; break }
    }
}
if ($ompCmd -and (Test-Path -LiteralPath $ompConfig)) {
    & $ompCmd init pwsh --config $ompConfig | Invoke-Expression
}

if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& { (zoxide init powershell | Out-String) })
}

function gs { git status }
function gd { git diff }
function gds { git diff --staged }
function gl { git log --oneline --graph -20 }
function gf { git fetch --all --prune }
function .. { Set-Location .. }
function ... { Set-Location ../.. }
function ll { Get-ChildItem -Force @args }
function touch {
    param([Parameter(Mandatory = $true)][string]$Path)
    New-Item -ItemType File -Path $Path -Force | Out-Null
}
function mkcd {
    param([Parameter(Mandatory = $true)][string]$Path)
    New-Item -ItemType Directory -Path $Path -Force | Set-Location
}
Set-Alias g git -ErrorAction SilentlyContinue
if (Get-Command fzf -ErrorAction SilentlyContinue) {
    Set-Alias ff fzf -ErrorAction SilentlyContinue
}
${VIBE_PROFILE_MARKER_END}`;
}

export function renderUnixVibeProfileBlock(shell = 'zsh') {
  const initShell = shell === 'bash' ? 'bash' : 'zsh';
  return `${VIBE_PROFILE_MARKER_START}
export VIRTUAL_ENV_DISABLE_PROMPT=1
export FZF_DEFAULT_OPTS='--color=fg:#E6EDF3,bg:#0D1422,hl:#00D5FF,fg+:#FFFFFF,bg+:#162033,hl+:#22D3EE,info:#9AA7B2,prompt:#00D5FF,pointer:#A78BFA,marker:#36D399,spinner:#22D3EE,header:#6F7A86'

for __sl_dir in \\
  "$HOME/.superliora/runtime/oh-my-posh" \\
  "$HOME/.superliora/runtime/zoxide" \\
  "$HOME/.superliora/runtime/fzf"
do
  case ":$PATH:" in
    *":$__sl_dir:"*) ;;
    *) [ -d "$__sl_dir" ] && PATH="$__sl_dir:$PATH" ;;
  esac
done
unset __sl_dir
export PATH

__sl_omp_config="$HOME/.superliora/oh-my-posh/superliora-neon-noir.omp.json"
__sl_omp=""
if command -v oh-my-posh >/dev/null 2>&1; then
  __sl_omp="$(command -v oh-my-posh)"
elif [ -x "$HOME/.superliora/runtime/oh-my-posh/oh-my-posh" ]; then
  __sl_omp="$HOME/.superliora/runtime/oh-my-posh/oh-my-posh"
fi
if [ -n "$__sl_omp" ] && [ -f "$__sl_omp_config" ]; then
  eval "$("$__sl_omp" init ${initShell} --config "$__sl_omp_config")"
fi
unset __sl_omp __sl_omp_config

if command -v zoxide >/dev/null 2>&1; then
  eval "$(zoxide init ${initShell})"
fi

alias gs='git status'
alias gd='git diff'
alias gds='git diff --staged'
alias gl='git log --oneline --graph -20'
alias gf='git fetch --all --prune'
alias ll='ls -la'
alias ..='cd ..'
alias ...='cd ../..'
${VIBE_PROFILE_MARKER_END}`;
}

export function profileShellForPath(dest) {
  const lower = String(dest ?? '').replaceAll('\\', '/').toLowerCase();
  if (lower.endsWith('/.bashrc') || lower.endsWith('/bashrc')) return 'bash';
  return 'zsh';
}

export function upsertMarkedBlock(current, block) {
  const nextBlock = block.trimEnd();
  const markerPattern = new RegExp(
    `${escapeRegExp(VIBE_PROFILE_MARKER_START)}[\\s\\S]*?${escapeRegExp(VIBE_PROFILE_MARKER_END)}`,
    'm',
  );
  if (markerPattern.test(current)) return current.replace(markerPattern, nextBlock);
  const prefix = current.length === 0 || current.endsWith('\n') ? current : `${current}\n`;
  return `${prefix}${nextBlock}\n`;
}

/**
 * @returns {Promise<{
 *   skipped?: boolean,
 *   ok?: boolean,
 *   ohMyPoshInstalled?: boolean,
 *   ohMyPoshPresent?: boolean,
 *   themeWritten?: boolean,
 *   zoxideInstalled?: boolean,
 *   fzfInstalled?: boolean,
 *   terminalIconsInstalled?: boolean,
 *   profilePatched?: boolean,
 *   executionPolicySet?: boolean,
 *   message?: string,
 * }>}
 */
export async function ensureShellVibe(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (skipShellVibeRequested(env, options)) {
    return { skipped: true, ok: true };
  }
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    return { skipped: true, ok: true };
  }

  const skipPackages = options.skipPackages === true;
  const bootstrapOmp = options.ensureOhMyPosh ?? ensureOhMyPosh;
  let omp;
  try {
    omp = await bootstrapOmp({ ...options, skipPackages });
  } catch (error) {
    omp = { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  let zoxideInstalled = false;
  let fzfInstalled = false;
  let terminalIconsInstalled = false;
  if (!skipPackages) {
    if (env.SUPERLIORA_NO_ZOXIDE !== '1') {
      const zoxide = await ensureArchiveTool({
        ...options,
        name: 'zoxide',
        wingetId: ZOXIDE_WINGET_ID,
        archiveUrl: zoxideArchiveUrl(platform, options.arch ?? process.arch),
        exeName: platform === 'win32' ? 'zoxide.exe' : 'zoxide',
      });
      zoxideInstalled = zoxide.installed === true;
    }
    if (env.SUPERLIORA_NO_FZF !== '1') {
      const fzf = await ensureArchiveTool({
        ...options,
        name: 'fzf',
        wingetId: FZF_WINGET_ID,
        archiveUrl: fzfArchiveUrl(platform, options.arch ?? process.arch),
        exeName: platform === 'win32' ? 'fzf.exe' : 'fzf',
      });
      fzfInstalled = fzf.installed === true;
    }
    if (platform === 'win32') {
      const icons = options.installTerminalIcons ?? defaultInstallTerminalIcons;
      try {
        terminalIconsInstalled = icons() === true;
      } catch {
        terminalIconsInstalled = false;
      }
    }
  }

  const addPath = options.addUserPath ?? defaultAddUserPath;
  for (const dir of [
    ohMyPoshRuntimeDir(env, platform),
    vibeRuntimeDir('zoxide', env, platform),
    vibeRuntimeDir('fzf', env, platform),
  ]) {
    try {
      addPath(dir, platform);
    } catch {
      // User PATH is optional; the profile prepends the same dirs.
    }
  }

  const writeText = options.writeFile ?? defaultWriteUtf8;
  const readText = options.readText ?? defaultReadText;
  const profiles = options.noShellRc === true
    ? []
    : (options.profilePaths
      ?? (platform === 'win32' ? defaultPowerShellProfilePaths(env) : defaultUnixProfilePaths(env)));
  let profilePatched = false;
  for (const dest of profiles) {
    try {
      const current = await readText(dest);
      const block = platform === 'win32'
        ? renderVibeProfileBlock()
        : renderUnixVibeProfileBlock(profileShellForPath(dest));
      const next = upsertMarkedBlock(current ?? '', block);
      if (next !== current) {
        await writeText(dest, next);
        profilePatched = true;
      }
    } catch {
      // Keep going — one profile host is enough.
    }
  }

  let executionPolicySet = false;
  if (platform === 'win32' && options.noExecutionPolicy !== true) {
    const setPolicy = options.setExecutionPolicy ?? defaultSetExecutionPolicy;
    try {
      executionPolicySet = setPolicy() === true;
    } catch {
      executionPolicySet = false;
    }
  }

  return {
    skipped: false,
    ok: true,
    ohMyPoshInstalled: omp.installed === true,
    ohMyPoshPresent: Boolean(omp.ompPath) || omp.alreadyPresent === true || omp.installed === true || Boolean(findOhMyPosh(options)),
    themeWritten: omp.themeWritten === true || Boolean(omp.themePath),
    zoxideInstalled,
    fzfInstalled,
    terminalIconsInstalled,
    profilePatched,
    executionPolicySet,
    message: omp.message,
  };
}

async function ensureArchiveTool(options) {
  const platform = options.platform ?? process.platform;
  const found = findToolExe(options.name, options);
  if (found) return { installed: false, alreadyPresent: true, path: found.path };
  if (platform === 'win32') {
    const runWinget = options.runWinget ?? ((id) => defaultRunWingetId(id));
    const winget = runWinget(options.wingetId);
    if (winget.status === 0) {
      return { installed: true, via: 'winget' };
    }
  }
  try {
    const destDir = vibeRuntimeDir(options.name, options.env ?? process.env, platform);
    const archiveName = platform === 'win32' ? `${options.name}.zip` : `${options.name}.tar.gz`;
    const archive = hostJoin(platform, destDir, archiveName);
    const download = options.downloadToFile ?? downloadToFile;
    await mkdir(destDir, { recursive: true });
    await download(options.archiveUrl, archive);
    const expand = options.expandZip ?? defaultExpandArchive;
    await expand(archive, destDir, platform);
    const exe = hostJoin(platform, destDir, options.exeName);
    const isFile = options.isFile ?? ((p) => existsSync(p));
    if (platform !== 'win32' && isFile(exe)) {
      try {
        await chmod(exe, 0o755);
      } catch {
        // chmod is best-effort
      }
    }
    return isFile(exe)
      ? { installed: true, via: platform === 'win32' ? 'zip' : 'tar', path: exe }
      : { installed: false, message: `${options.name} archive had no ${options.exeName}` };
  } catch (error) {
    return { installed: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function defaultRunWingetId(id) {
  const cmd = findWinget()?.wingetPath ?? 'winget';
  const result = spawnSync(
    cmd,
    [
      'install',
      '-e',
      '--id',
      id,
      '--accept-package-agreements',
      '--accept-source-agreements',
      '--disable-interactivity',
      '--silent',
      '--scope',
      'user',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  return {
    status: result.error ? 1 : (result.status ?? 1),
    message: result.stderr || result.stdout || result.error?.message,
  };
}

async function defaultExpandArchive(archivePath, dest, platform = process.platform) {
  await mkdir(dest, { recursive: true });
  if (platform === 'win32') {
    spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Path '${escapePs(archivePath)}' -DestinationPath '${escapePs(dest)}' -Force`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    return;
  }
  spawnSync('tar', ['-xzf', archivePath, '-C', dest], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function defaultInstallTerminalIcons() {
  if (process.platform !== 'win32') return false;
  const script = [
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12",
    "if (Get-Module -ListAvailable -Name Terminal-Icons) { 'PRESENT'; exit 0 }",
    "Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction SilentlyContinue",
    "Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser -ErrorAction SilentlyContinue | Out-Null",
    "Install-Module Terminal-Icons -Scope CurrentUser -Force -AllowClobber -ErrorAction Stop",
    "'INSTALLED'",
  ].join('; ');
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  });
  const out = `${ps.stdout ?? ''}${ps.stderr ?? ''}`;
  return ps.status === 0 && /INSTALLED|PRESENT/i.test(out);
}

function defaultSetExecutionPolicy() {
  if (process.platform !== 'win32') return false;
  const script = [
    "$p = Get-ExecutionPolicy -Scope CurrentUser -ErrorAction SilentlyContinue",
    "if ($p -in @('RemoteSigned','Unrestricted','Bypass')) { 'UNCHANGED'; exit 0 }",
    "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force",
    "'CHANGED'",
  ].join('; ');
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return ps.status === 0 && /CHANGED/i.test(ps.stdout ?? '');
}

function defaultAddUserPath(dir, platform = process.platform) {
  if (platform !== 'win32') return;
  applyUserPathWin(dir, { envName: 'Path' });
}

function defaultWhich(name, env) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
  if (result.status !== 0) return undefined;
  const line = (result.stdout ?? '').split(/\r?\n/).map((part) => part.trim()).find(Boolean);
  return line || undefined;
}

async function defaultReadText(dest) {
  try {
    return await readFile(dest, 'utf8');
  } catch {
    return '';
  }
}

async function defaultWriteUtf8(dest, text) {
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, text, 'utf8');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapePs(value) {
  return String(value ?? '').replaceAll("'", "''");
}

function winJoin(...parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && String(part).length > 0)
    .map((part, index) => {
      const text = String(part);
      if (index === 0) return text.replace(/[\\/]+$/, '');
      return text.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
    })
    .join('\\');
}
