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

export async function ensureBinOnPath(binDir, options = {}) {
  if (options.noShellRc) return { updated: [] };

  if (process.platform === 'win32') {
    addUserPathWin(binDir);
    return { updated: ['User PATH'] };
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

function addUserPathWin(binDir) {
  const ps = `
$full = [IO.Path]::GetFullPath('${binDir.replaceAll("'", "''")}')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @()
if (-not [string]::IsNullOrWhiteSpace($userPath)) {
  $parts = $userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}
$already = $false
foreach ($part in $parts) {
  if ([string]::Equals($part.TrimEnd('\\'), $full.TrimEnd('\\'), [StringComparison]::OrdinalIgnoreCase)) { $already = $true; break }
}
if (-not $already) {
  $next = if ([string]::IsNullOrWhiteSpace($userPath)) { $full } else { "$full;$userPath" }
  [Environment]::SetEnvironmentVariable('Path', $next, 'User')
}
`;
  spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  process.env.PATH = `${binDir};${process.env.PATH ?? ''}`;
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

function shellStartupPathExpr(filePath, home) {
  const normalizedHome = home.endsWith('/') ? home.slice(0, -1) : home;
  if (filePath === normalizedHome) return '$HOME';
  if (filePath.startsWith(`${normalizedHome}/`)) return `$HOME/${filePath.slice(normalizedHome.length + 1)}`;
  return filePath;
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
  const normalizedHome = home.endsWith('/') ? home.slice(0, -1) : home;
  if (filePath === normalizedHome) return '~';
  if (filePath.startsWith(`${normalizedHome}/`)) return `~/${filePath.slice(normalizedHome.length + 1)}`;
  return filePath;
}
