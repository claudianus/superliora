/**
 * PATH / shell-rc helpers for SEA and source installs.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { defaultHome } from './platform.mjs';

const PATH_MARKER_START = '# >>> liora PATH >>>';
const PATH_MARKER_END = '# <<< liora PATH <<<';

/** Merge `binDir` onto a Windows User PATH string without writing the registry. */
export function mergeUserPath(currentUserPath, binDir) {
  const full = normalizeWinPath(binDir).replace(/\\+$/, '');
  const raw = currentUserPath ?? '';
  const parts = raw
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const already = parts.some(
    (part) => normalizeWinPath(part).replace(/\\+$/, '').toLowerCase() === full.toLowerCase(),
  );
  if (already) return { next: raw, changed: false };
  const next = raw.trim().length === 0 ? full : `${full};${raw}`;
  return { next, changed: true };
}

export function normalizeWinPath(filePath) {
  return String(filePath).replaceAll('/', '\\');
}

export async function ensureBinOnPath(binDir, options = {}) {
  if (options.noShellRc) return { updated: [] };

  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    let changed;
    if (typeof options.getUserPath === 'function' && typeof options.setUserPath === 'function') {
      const current = options.getUserPath();
      const merged = mergeUserPath(current, binDir);
      if (merged.changed) options.setUserPath(merged.next);
      changed = merged.changed;
    } else {
      const applied = applyUserPathWin(binDir, { envName: options.envName ?? 'Path' });
      changed = applied.changed;
    }
    process.env.PATH = `${binDir};${process.env.PATH ?? ''}`;
    return { updated: changed ? ['User PATH'] : [] };
  }

  const home = defaultHome();
  const updated = [];
  const posixSnippet = renderPosixPathSnippet(binDir, home);
  const fishSnippet = renderFishPathSnippet(binDir, home);

  for (const target of [
    join(home, '.zshrc'),
    join(home, '.bashrc'),
    join(home, '.profile'),
  ]) {
    if (await upsertMarkedBlock(target, posixSnippet)) updated.push(prettyHome(target, home));
  }
  for (const optional of [join(home, '.zprofile'), join(home, '.bash_profile')]) {
    if (existsSync(optional) && (await upsertMarkedBlock(optional, posixSnippet))) {
      updated.push(prettyHome(optional, home));
    }
  }
  const fishConfig = join(home, '.config/fish/config.fish');
  if (await upsertMarkedBlock(fishConfig, fishSnippet)) updated.push(prettyHome(fishConfig, home));

  // Session PATH
  process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
  return { updated };
}

const WIN_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WIN_ENV_TARGET = new Set(['User', 'Process', 'Machine']);

function assertWinEnvOptions(options = {}) {
  const envName = options.envName ?? 'Path';
  const target = options.target ?? 'User';
  if (!WIN_ENV_NAME.test(envName)) {
    throw new Error(`invalid Windows environment name: ${envName}`);
  }
  if (!WIN_ENV_TARGET.has(target)) {
    throw new Error(`invalid Windows environment target: ${target}`);
  }
  return { envName, target };
}

function runPowerShellUtf8(script) {
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  if (ps.status !== 0) {
    throw new Error(`PowerShell User env failed: ${ps.stderr || ps.stdout || ps.status}`);
  }
  return (ps.stdout ?? '').replace(/^\uFEFF/, '').trim();
}

function encodeWinEnvPayload(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function decodeWinEnvPayload(b64) {
  if (!b64) return '';
  return Buffer.from(String(b64).trim(), 'base64').toString('utf8');
}

/**
 * Read a User (or other) environment value without decoding CP949 stdout as UTF-8.
 * PowerShell prints UTF-8 bytes as base64; Node decodes that.
 */
export function readUserEnvWin(options = {}) {
  const spec = assertWinEnvOptions(options);
  const payload = encodeWinEnvPayload(spec);
  const out = runPowerShellUtf8(`
$ErrorActionPreference = 'Stop'
$spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$current = [Environment]::GetEnvironmentVariable([string]$spec.envName, [string]$spec.target)
if ($null -eq $current) { $current = '' }
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($current)))
`);
  return decodeWinEnvPayload(out);
}

/**
 * Write or delete a User environment value. Empty string deletes the variable.
 * The value crosses the process boundary as UTF-8 base64, not console text.
 */
export function writeUserEnvWin(value, options = {}) {
  const spec = assertWinEnvOptions(options);
  const payload = encodeWinEnvPayload({ ...spec, value: value ?? '' });
  runPowerShellUtf8(`
$ErrorActionPreference = 'Stop'
$spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$raw = [string]$spec.value
if ([string]::IsNullOrEmpty($raw)) {
  [Environment]::SetEnvironmentVariable([string]$spec.envName, $null, [string]$spec.target)
} else {
  [Environment]::SetEnvironmentVariable([string]$spec.envName, $raw, [string]$spec.target)
}
`);
}

/**
 * Merge binDir onto a Windows User PATH-like variable in one PowerShell process.
 * The current value is never sent through Node as CP949 console text.
 */
export function applyUserPathWin(binDir, options = {}) {
  const spec = assertWinEnvOptions(options);
  const payload = encodeWinEnvPayload({
    ...spec,
    binDir: normalizeWinPath(binDir),
  });
  const out = runPowerShellUtf8(`
$ErrorActionPreference = 'Stop'
$spec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$full = [IO.Path]::GetFullPath([string]$spec.binDir).TrimEnd([char]92)
$current = [Environment]::GetEnvironmentVariable([string]$spec.envName, [string]$spec.target)
if ($null -eq $current) { $current = '' }
$already = $false
foreach ($part in ($current -split ';')) {
  $trim = $part.Trim()
  if ([string]::IsNullOrWhiteSpace($trim)) { continue }
  $norm = $trim.Replace([char]47, [char]92).TrimEnd([char]92)
  if ([string]::Equals($norm, $full, [StringComparison]::OrdinalIgnoreCase)) { $already = $true; break }
}
if ($already) {
  $status = 'UNCHANGED'
  $next = $current
} else {
  $status = 'CHANGED'
  if ([string]::IsNullOrWhiteSpace($current)) { $next = $full } else { $next = $full + ';' + $current }
  [Environment]::SetEnvironmentVariable([string]$spec.envName, $next, [string]$spec.target)
}
[Console]::Out.Write($status)
[Console]::Out.Write([char]10)
[Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($next)))
`);
  const nl = out.indexOf('\n');
  const status = (nl >= 0 ? out.slice(0, nl) : out).replaceAll('\r', '').trim();
  const next = decodeWinEnvPayload(nl >= 0 ? out.slice(nl + 1) : '');
  return { changed: status === 'CHANGED', next };
}

async function upsertMarkedBlock(filePath, block) {
  await mkdir(dirname(filePath), { recursive: true });
  let current = '';
  try {
    current = await readFile(filePath, 'utf-8');
  } catch {
    current = '';
  }
  const nextBlock = `${PATH_MARKER_START}\n${block.trimEnd()}\n${PATH_MARKER_END}`;
  const markerPattern = new RegExp(
    `${escapeRegExp(PATH_MARKER_START)}[\\s\\S]*?${escapeRegExp(PATH_MARKER_END)}`,
    'm',
  );
  const next = markerPattern.test(current)
    ? current.replace(markerPattern, nextBlock)
    : `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${nextBlock}\n`;
  if (next === current) return false;
  await writeFile(filePath, next, 'utf-8');
  return true;
}

function renderPosixPathSnippet(pathDir, home) {
  const expr = shellStartupPathExpr(pathDir, home);
  return `liora_bin_dir=${quotePosixStartupExpr(expr)}
case ":$PATH:" in
  *":$liora_bin_dir:"*) ;;
  *) export PATH="$liora_bin_dir:$PATH" ;;
esac
unset liora_bin_dir
`;
}

function renderFishPathSnippet(pathDir, home) {
  const expr = shellStartupPathExpr(pathDir, home);
  return `set -l liora_bin_dir ${quoteFishStartupExpr(expr)}
if type -q fish_add_path
    fish_add_path $liora_bin_dir
else if not contains -- $liora_bin_dir $PATH
    set -gx PATH $liora_bin_dir $PATH
end
`;
}

function toPosixPath(filePath) {
  return String(filePath).replaceAll('\\', '/');
}

function shellStartupPathExpr(filePath, home) {
  const normalizedHome = toPosixPath(home).replace(/\/$/, '');
  const normalizedPath = toPosixPath(filePath);
  if (normalizedPath === normalizedHome) return '$HOME';
  if (normalizedPath.startsWith(`${normalizedHome}/`)) {
    return `$HOME/${normalizedPath.slice(normalizedHome.length + 1)}`;
  }
  return normalizedPath;
}

function quotePosix(value) {
  return `'${value.replaceAll(`'`, `'\\''`)}'`;
}

function quotePosixStartupExpr(value) {
  if (value === '$HOME' || value.startsWith('$HOME/')) {
    return `"${value.replaceAll(/["\\`]/g, '\\$&')}"`;
  }
  return quotePosix(value);
}

function quoteFish(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll(`'`, "\\'")}'`;
}

function quoteFishStartupExpr(value) {
  if (value === '$HOME' || value.startsWith('$HOME/')) {
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }
  return quoteFish(value);
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prettyHome(filePath, home) {
  const normalizedHome = toPosixPath(home).replace(/\/$/, '');
  const normalizedPath = toPosixPath(filePath);
  if (normalizedPath === normalizedHome) return '~';
  if (normalizedPath.startsWith(`${normalizedHome}/`)) {
    return `~/${normalizedPath.slice(normalizedHome.length + 1)}`;
  }
  return filePath;
}
