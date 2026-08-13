/**
 * Ensure Git (and on Windows, Git Bash) is available for the agent shell.
 * Missing Windows Git is bootstrapped as PortableGit under ~/.superliora/runtime/git.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { downloadToFile } from './download.mjs';
import { applyUserPathWin } from './path.mjs';
import { defaultHome, defaultRuntimeGitDir } from './platform.mjs';
import { spawnInstall } from './spawn.mjs';

export const DEFAULT_PORTABLE_GIT = {
  version: '2.55.0.4',
  tag: 'v2.55.0.windows.4',
};

export function portableGitFilename(arch = process.arch, version = DEFAULT_PORTABLE_GIT.version) {
  return arch === 'arm64'
    ? `PortableGit-${version}-arm64.7z.exe`
    : `PortableGit-${version}-64-bit.7z.exe`;
}

export function portableGitDownloadUrl(
  arch = process.arch,
  spec = DEFAULT_PORTABLE_GIT,
) {
  return `https://github.com/git-for-windows/git/releases/download/${spec.tag}/${portableGitFilename(arch, spec.version)}`;
}

export function wellKnownGitBashCandidates(env = process.env, runtimeDir = defaultRuntimeGitDir()) {
  const localAppData = env.LOCALAPPDATA?.trim();
  const home = defaultHome();
  const list = [
    join(runtimeDir, 'bin', 'bash.exe'),
    join(runtimeDir, 'usr', 'bin', 'bash.exe'),
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
  ];
  if (localAppData) {
    list.push(join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'));
    list.push(join(localAppData, 'Programs', 'Git', 'usr', 'bin', 'bash.exe'));
  }
  if (home) {
    list.push(join(home, 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe'));
  }
  return list;
}

export function gitRootFromBash(bashPath) {
  const normalized = String(bashPath).replaceAll('/', '\\');
  const lower = normalized.toLowerCase();
  if (lower.endsWith('\\usr\\bin\\bash.exe')) {
    return normalized.slice(0, -'\\usr\\bin\\bash.exe'.length);
  }
  if (lower.endsWith('\\bin\\bash.exe')) {
    return normalized.slice(0, -'\\bin\\bash.exe'.length);
  }
  return undefined;
}

/**
 * @returns {{ bashPath: string, gitPath?: string, root?: string, source?: string } | null}
 */
export function findExistingGit(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const isFile = options.isFile ?? ((p) => existsSync(p));
  const runtimeDir = options.runtimeDir ?? defaultRuntimeGitDir();

  if (platform === 'win32') {
    for (const name of ['LIORA_SHELL_PATH', 'KIMI_SHELL_PATH']) {
      const override = env[name]?.trim();
      if (override && isFile(override)) {
        return { bashPath: override, root: gitRootFromBash(override), source: name };
      }
    }
    for (const candidate of wellKnownGitBashCandidates(env, runtimeDir)) {
      if (isFile(candidate)) {
        const root = gitRootFromBash(candidate);
        const gitPath = root ? join(root, 'cmd', 'git.exe') : undefined;
        return {
          bashPath: candidate,
          gitPath: gitPath && isFile(gitPath) ? gitPath : undefined,
          root,
          source: 'well-known',
        };
      }
    }
    return null;
  }

  const which = spawnSync(platform === 'win32' ? 'where' : 'which', ['git'], {
    encoding: 'utf8',
    env,
  });
  if (which.status === 0) {
    const gitPath = (which.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (gitPath) return { gitPath, bashPath: '/bin/bash', source: 'path' };
  }
  return null;
}

/**
 * @returns {Promise<{
 *   bootstrapped: boolean,
 *   skipped?: boolean,
 *   missing?: boolean,
 *   bashPath?: string,
 *   gitPath?: string,
 *   root?: string,
 *   message?: string,
 * }>}
 */
export async function ensureGit(options = {}) {
  if (options.skip === true || process.env.SUPERLIORA_SKIP_GIT === '1') {
    return { bootstrapped: false, skipped: true };
  }

  const platform = options.platform ?? process.platform;
  const existing = findExistingGit(options);
  if (existing) {
    prependGitRuntimePath(existing.root, platform);
    return { ...existing, bootstrapped: false };
  }

  if (platform === 'win32') {
    return bootstrapWindowsPortableGit(options);
  }

  const fromPkg = tryUnixPackageGit(platform);
  if (fromPkg) {
    return { ...fromPkg, bootstrapped: true };
  }

  const message =
    platform === 'darwin'
      ? 'Git is required. Install Xcode Command Line Tools (xcode-select --install) or Homebrew git, then re-run.'
      : 'Git is required. Install git (for example: apt install git) and re-run.';
  return { bootstrapped: false, missing: true, message };
}

async function bootstrapWindowsPortableGit(options) {
  const runtimeDir = options.runtimeDir ?? defaultRuntimeGitDir();
  const bashMarker = join(runtimeDir, 'bin', 'bash.exe');
  const gitMarker = join(runtimeDir, 'cmd', 'git.exe');
  if (existsSync(bashMarker)) {
    prependGitRuntimePath(runtimeDir, 'win32', options);
    return { bootstrapped: false, bashPath: bashMarker, gitPath: gitMarker, root: runtimeDir };
  }

  const arch = options.arch ?? process.arch;
  const spec = options.portableGit ?? DEFAULT_PORTABLE_GIT;
  const url = portableGitDownloadUrl(arch, spec);
  const filename = portableGitFilename(arch, spec.version);
  await mkdir(runtimeDir, { recursive: true });
  const sfxPath = join(runtimeDir, filename);
  const download = options.downloadToFile ?? downloadToFile;
  await download(url, sfxPath);

  await rm(join(runtimeDir, 'bin'), { recursive: true, force: true }).catch(() => {});
  const extract = options.extractSfx ?? extractPortableGitSfx;
  await extract(sfxPath, runtimeDir);
  await rm(sfxPath, { force: true }).catch(() => {});

  if (!existsSync(bashMarker)) {
    throw new Error(`Git bootstrap failed: missing ${bashMarker}`);
  }
  prependGitRuntimePath(runtimeDir, 'win32', options);
  return {
    bootstrapped: true,
    bashPath: bashMarker,
    gitPath: existsSync(gitMarker) ? gitMarker : undefined,
    root: runtimeDir,
  };
}

export async function extractPortableGitSfx(sfxPath, destDir) {
  await mkdir(destDir, { recursive: true });
  const result = spawnSync(sfxPath, ['-y', `-o${destDir}`], {
    encoding: 'utf8',
    windowsVerbatimArguments: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `PortableGit extract failed: ${result.stderr || result.stdout || result.status}`,
    );
  }
}

function prependGitRuntimePath(root, platform, options = {}) {
  if (!root) return;
  if (platform === 'win32') {
    const cmd = join(root, 'cmd');
    const bin = join(root, 'bin');
    process.env.PATH = `${cmd};${bin};${process.env.PATH ?? ''}`;
    if (!options.noShellRc) {
      try {
        applyUserPathWin(cmd);
      } catch {
        // Session PATH is enough for this install process.
      }
    }
    return;
  }
  process.env.PATH = `${join(root, 'bin')}:${process.env.PATH ?? ''}`;
}

function tryUnixPackageGit(platform) {
  if (platform === 'darwin') {
    const brew = spawnInstall('brew', ['install', 'git'], { encoding: 'utf8' });
    if (brew.status === 0) {
      const which = spawnSync('which', ['git'], { encoding: 'utf8' });
      const gitPath = (which.stdout ?? '').trim();
      if (gitPath) return { gitPath, bashPath: '/bin/bash', source: 'brew' };
    }
  }
  return null;
}
