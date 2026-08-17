/**
 * Best-effort Oh My Posh install + SuperLiora Neon Noir theme.
 * Outer-shell prompt only — not the SuperLiora TUI. Never throws.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { downloadToFile } from './download.mjs';
import { findWinget } from './ensure-winget.mjs';
import { hostJoin } from './host-path.mjs';
import { archId, defaultHome } from './platform.mjs';

export const OMP_WINGET_ID = 'JanDeDobbeleer.OhMyPosh';
export const OMP_EXE_URL =
  'https://github.com/JanDeDobbeleer/oh-my-posh/releases/latest/download/posh-windows-amd64.exe';
export const OMP_THEME_NAME = 'superliora-neon-noir.omp.json';

export function ohMyPoshDownloadUrl(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return OMP_EXE_URL;
  const cpu = archId(arch);
  if (platform === 'darwin') {
    return `https://github.com/JanDeDobbeleer/oh-my-posh/releases/latest/download/posh-darwin-${cpu === 'arm64' ? 'arm64' : 'amd64'}`;
  }
  return `https://github.com/JanDeDobbeleer/oh-my-posh/releases/latest/download/posh-linux-${cpu === 'arm64' ? 'arm64' : 'amd64'}`;
}

export function skipOhMyPoshRequested(env = process.env, options = {}) {
  if (options.skip === true) return true;
  return env.SUPERLIORA_NO_POSH === '1';
}

export function ohMyPoshThemePath(env = process.env, platform = process.platform) {
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  return hostJoin(platform, home, '.superliora', 'oh-my-posh', OMP_THEME_NAME);
}

export function ohMyPoshRuntimeDir(env = process.env, platform = process.platform) {
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  return hostJoin(platform, home, '.superliora', 'runtime', 'oh-my-posh');
}

export function wellKnownOhMyPoshCandidates(env = process.env, platform = process.platform) {
  const home = env.HOME ?? env.USERPROFILE ?? defaultHome();
  if (platform !== 'win32') {
    return [
      hostJoin(platform, ohMyPoshRuntimeDir(env, platform), 'oh-my-posh'),
      hostJoin(platform, home, '.local', 'bin', 'oh-my-posh'),
      '/opt/homebrew/bin/oh-my-posh',
      '/usr/local/bin/oh-my-posh',
    ];
  }
  const localAppData = (env.LOCALAPPDATA ?? '').trim();
  const list = [winJoin(ohMyPoshRuntimeDir(env, platform), 'oh-my-posh.exe')];
  if (localAppData) {
    list.push(winJoin(localAppData, 'Programs', 'oh-my-posh', 'bin', 'oh-my-posh.exe'));
    list.push(winJoin(localAppData, 'Microsoft', 'WindowsApps', 'oh-my-posh.exe'));
  }
  if (home) {
    list.push(winJoin(home, 'AppData', 'Local', 'Programs', 'oh-my-posh', 'bin', 'oh-my-posh.exe'));
  }
  return list;
}

export function findOhMyPosh(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const isFile = options.isFile ?? ((p) => existsSync(p));
  const which = options.which ?? defaultWhich;
  const fromPath = which('oh-my-posh', env) ?? which('oh-my-posh.exe', env);
  if (fromPath && isFile(fromPath)) {
    return { ompPath: fromPath, source: 'path', alreadyPresent: true };
  }
  for (const candidate of wellKnownOhMyPoshCandidates(env, platform)) {
    if (isFile(candidate)) {
      return { ompPath: candidate, source: 'well-known', alreadyPresent: true };
    }
  }
  return null;
}

/** Copied from apps/liora/src/tui/theme/colors.ts `neonNoirColors` — do not import TUI from the installer. */
export function renderNeonNoirOmpTheme() {
  return {
    $schema: 'https://raw.githubusercontent.com/JanDeDobbeleer/oh-my-posh/main/themes/schema.json',
    version: 3,
    final_space: true,
    console_title_template: '{{ .Folder }}',
    palette: {
      primary: '#00D5FF',
      accent: '#A78BFA',
      text: '#E6EDF3',
      muted: '#6F7A86',
      dim: '#9AA7B2',
      success: '#36D399',
      warning: '#F5C542',
      error: '#FF5C7A',
      glow: '#22D3EE',
    },
    blocks: [
      {
        type: 'prompt',
        alignment: 'left',
        segments: [
          {
            type: 'os',
            style: 'plain',
            foreground: 'p:muted',
            template: '{{.Icon}} ',
          },
          {
            type: 'path',
            style: 'plain',
            foreground: 'p:primary',
            template: '{{ .Path }} ',
            properties: { style: 'agnoster_short', home_icon: '~' },
          },
          {
            type: 'git',
            style: 'plain',
            foreground: 'p:accent',
            template: '{{ .HEAD }}{{ if .Working.Changed }}*{{ end }}{{ if .Staging.Changed }}+{{ end }} ',
            properties: { fetch_status: true, branch_icon: '\ue725 ' },
          },
          {
            type: 'node',
            style: 'plain',
            foreground: 'p:success',
            template: '\ue718 {{ .Full }} ',
            properties: { fetch_version: true },
          },
          {
            type: 'python',
            style: 'plain',
            foreground: 'p:warning',
            template: '\ue235 {{ if .Venv }}{{ .Venv }} {{ end }}{{ .Full }} ',
          },
          {
            type: 'executiontime',
            style: 'plain',
            foreground: 'p:glow',
            template: '{{ .FormattedMs }} ',
            properties: { threshold: 500, style: 'round' },
          },
        ],
      },
      {
        type: 'prompt',
        alignment: 'left',
        newline: true,
        segments: [
          {
            type: 'text',
            style: 'plain',
            foreground_templates: [
              '{{ if gt .Code 0 }}p:error{{ end }}',
              'p:primary',
            ],
            template: '\u276f',
          },
        ],
      },
    ],
    transient_prompt: {
      background: 'transparent',
      foreground: 'p:muted',
      template: '\u276f ',
    },
  };
}

export async function writeOhMyPoshTheme(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const dest = options.themePath ?? ohMyPoshThemePath(env, platform);
  const writeJson = options.writeFile ?? defaultWriteUtf8;
  await writeJson(dest, `${JSON.stringify(renderNeonNoirOmpTheme(), null, 2)}\n`);
  return dest;
}

/**
 * @returns {Promise<{
 *   skipped?: boolean,
 *   alreadyPresent?: boolean,
 *   installed?: boolean,
 *   themeWritten?: boolean,
 *   ok?: boolean,
 *   ompPath?: string,
 *   themePath?: string,
 *   via?: string,
 *   message?: string,
 * }>}
 */
export async function ensureOhMyPosh(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    return { skipped: true, ok: true };
  }
  if (skipOhMyPoshRequested(env, options)) {
    return { skipped: true, ok: true };
  }

  let themePath;
  try {
    themePath = await writeOhMyPoshTheme(options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { skipped: false, ok: false, themeWritten: false, message: detail };
  }

  const found = findOhMyPosh(options);
  if (found) {
    return {
      skipped: false,
      alreadyPresent: true,
      installed: false,
      themeWritten: true,
      ok: true,
      themePath,
      ...found,
    };
  }

  if (options.skipPackages === true) {
    return { skipped: true, ok: true, themeWritten: true, themePath };
  }

  if (platform === 'win32') {
    const runWinget = options.runWinget ?? defaultRunWingetOmp;
    const winget = runWinget();
    if (winget.status === 0) {
      const after = findOhMyPosh(options);
      return {
        skipped: false,
        installed: true,
        themeWritten: true,
        ok: true,
        via: 'winget',
        themePath,
        ompPath: after?.ompPath,
      };
    }
  }

  try {
    const viaExe = await installOhMyPoshBinary(options);
    const after = findOhMyPosh(options);
    return {
      skipped: false,
      installed: viaExe.ok === true,
      themeWritten: true,
      ok: viaExe.ok === true || Boolean(after),
      via: viaExe.via ?? 'download',
      themePath,
      ompPath: after?.ompPath,
      message: viaExe.ok ? undefined : viaExe.message,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { skipped: false, installed: false, themeWritten: true, ok: false, themePath, message: detail };
  }
}

async function installOhMyPoshBinary(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const destDir = options.runtimeDir ?? ohMyPoshRuntimeDir(env, platform);
  const destName = platform === 'win32' ? 'oh-my-posh.exe' : 'oh-my-posh';
  const dest = hostJoin(platform, destDir, destName);
  const download = options.downloadToFile ?? downloadToFile;
  await mkdir(destDir, { recursive: true });
  await download(ohMyPoshDownloadUrl(platform, options.arch ?? process.arch), dest);
  if (platform !== 'win32') {
    try {
      await chmod(dest, 0o755);
    } catch {
      // chmod is best-effort on exotic filesystems
    }
  }
  return existsSync(dest) || (options.isFile?.(dest) === true)
    ? { ok: true, via: 'download' }
    : { ok: false, message: `Oh My Posh download did not produce ${destName}` };
}

function defaultRunWingetOmp() {
  const cmd = findWinget()?.wingetPath ?? 'winget';
  const result = spawnSync(
    cmd,
    [
      'install',
      '-e',
      '--id',
      OMP_WINGET_ID,
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

async function defaultWriteUtf8(dest, text) {
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, text, 'utf8');
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

