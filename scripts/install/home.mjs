/**
 * Data-home placement: SuperLiora wants ~100 GB free. On Windows, pick a
 * roomier local drive when the profile volume is too tight. Persist via
 * SUPERLIORA_HOME + ~/.superliora/home.redirect so later `liora` launches
 * find the same tree.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';

import { writeUserEnvWin } from './path.mjs';
import { defaultHome } from './platform.mjs';

/** Comfortable SuperLiora home volume free space (~100 GB). */
export const LIORA_HOME_COMFORT_FREE_BYTES = 100 * 1024 * 1024 * 1024;
export const LIORA_HOME_ROOMIER_EXTRA_BYTES = 20 * 1024 * 1024 * 1024;
export const HOME_REDIRECT_FILENAME = 'home.redirect';
export const WINDOWS_PRODUCT_FOLDER = 'SuperLiora';

export function pointerDir(osHome = defaultHome()) {
  return join(osHome, '.superliora');
}

export function parseHomeRedirectText(text) {
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (!isAbsolute(line)) return undefined;
    return normalize(line);
  }
  return undefined;
}

export function readHomeRedirect(dir = pointerDir()) {
  try {
    const parsed = parseHomeRedirectText(readFileSync(join(dir, HOME_REDIRECT_FILENAME), 'utf8'));
    if (!parsed || sameHomePath(parsed, dir)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeHomeRedirect(target, osHome = defaultHome()) {
  const pointer = pointerDir(osHome);
  mkdirSync(pointer, { recursive: true });
  const file = join(pointer, HOME_REDIRECT_FILENAME);
  if (sameHomePath(target, pointer)) {
    try {
      unlinkSync(file);
    } catch {
      // No redirect to clear.
    }
    return;
  }
  writeFileSync(file, `# SuperLiora data home.\n${target}\n`, 'utf8');
}

export function sameHomePath(left, right, platform = process.platform) {
  const a = normalize(String(left)).replace(/[\\/]+$/, '');
  const b = normalize(String(right)).replace(/[\\/]+$/, '');
  if (platform === 'win32') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export function isLioraHomePopulated(homeDir) {
  if (existsSync(join(homeDir, 'config.toml'))) return true;
  if (existsSync(join(homeDir, 'tui.toml'))) return true;
  if (existsSync(join(homeDir, 'credentials'))) return true;
  if (existsSync(join(homeDir, 'memory', 'liora-memory.sqlite'))) return true;
  const sessions = join(homeDir, 'sessions');
  if (!existsSync(sessions)) return false;
  try {
    return readdirSync(sessions).some((name) => name !== '.' && name !== '..');
  } catch {
    return false;
  }
}

export function volumeContaining(filePath, volumes, platform = process.platform) {
  const normalized = normalize(String(filePath));
  let best;
  for (const volume of volumes) {
    const root = normalize(volume.root ?? volume.path ?? '');
    if (!root) continue;
    const prefix = root.endsWith('\\') || root.endsWith('/') ? root : `${root}\\`;
    const posixPrefix = root.endsWith('/') ? root : `${root}/`;
    const winRoot = root.toLowerCase();
    const winPath = normalized.toLowerCase();
    const hit =
      normalized === root ||
      normalized.startsWith(prefix) ||
      normalized.startsWith(posixPrefix) ||
      (platform === 'win32' && (winPath === winRoot || winPath.startsWith(winRoot)));
    if (!hit) continue;
    if (best === undefined || String(root).length > String(best.root ?? best.path).length) {
      best = volume;
    }
  }
  return best;
}

export function joinDriveRoot(root, folder) {
  const trimmed = String(root).replace(/[\\/]+$/, '');
  if (/^[A-Za-z]:$/.test(trimmed) || /^[A-Za-z]:\\/.test(String(root))) {
    return `${trimmed}\\${folder}`;
  }
  return join(root, folder);
}

/**
 * @param {{
 *   explicitHome?: string,
 *   osHome?: string,
 *   volumes?: { root: string, path?: string, freeBytes: number, totalBytes: number }[],
 *   platform?: string,
 *   cwd?: string,
 *   defaultPopulated?: boolean,
 *   comfortBytes?: number,
 *   productFolder?: string,
 * }} input
 */
export function pickDataHome(input = {}) {
  const osHome = input.osHome ?? defaultHome() ?? homedir();
  const defaultHomeDir = pointerDir(osHome);
  const platform = input.platform ?? process.platform;
  const volumes = input.volumes ?? [];
  const comfort = input.comfortBytes ?? LIORA_HOME_COMFORT_FREE_BYTES;
  const explicit = String(input.explicitHome ?? '').trim();
  if (explicit) {
    const vol = volumeContaining(explicit, volumes, platform);
    return {
      home: explicit,
      reason: 'explicit',
      relocated: !sameHomePath(explicit, defaultHomeDir, platform),
      tight: vol !== undefined && vol.freeBytes < comfort,
      freeBytes: vol?.freeBytes,
    };
  }

  const defaultVol = volumeContaining(defaultHomeDir, volumes, platform);
  const defaultFree = defaultVol?.freeBytes ?? 0;
  const defaultTight = defaultVol === undefined || defaultFree < comfort;
  const populated =
    input.defaultPopulated === undefined
      ? isLioraHomePopulated(defaultHomeDir)
      : input.defaultPopulated === true;

  if (platform !== 'win32') {
    return {
      home: defaultHomeDir,
      reason: populated ? (defaultTight ? 'existing-tight' : 'existing') : defaultTight ? 'default-tight' : 'default-ok',
      relocated: false,
      tight: defaultTight,
      freeBytes: defaultFree,
    };
  }

  if (populated) {
    return {
      home: defaultHomeDir,
      reason: defaultTight ? 'existing-tight' : 'existing',
      relocated: false,
      tight: defaultTight,
      freeBytes: defaultFree,
    };
  }

  if (!defaultTight) {
    return {
      home: defaultHomeDir,
      reason: 'default-ok',
      relocated: false,
      tight: false,
      freeBytes: defaultFree,
    };
  }

  const productFolder = input.productFolder ?? WINDOWS_PRODUCT_FOLDER;
  const cwdVol = input.cwd ? volumeContaining(input.cwd, volumes, platform) : undefined;
  const comfortable = volumes
    .filter((volume) => volume.freeBytes >= comfort)
    .sort((a, b) => b.freeBytes - a.freeBytes);

  let candidate;
  const defaultRoot = defaultVol?.root ?? defaultVol?.path ?? '';
  const cwdComfortable =
    cwdVol !== undefined &&
    cwdVol.freeBytes >= comfort &&
    !sameHomePath(cwdVol.root ?? cwdVol.path, defaultRoot, platform);
  if (cwdComfortable) {
    candidate = cwdVol;
  } else if (
    comfortable[0] &&
    !sameHomePath(comfortable[0].root ?? comfortable[0].path, defaultRoot, platform)
  ) {
    candidate = comfortable[0];
  } else {
    const roomier = [...volumes].sort((a, b) => b.freeBytes - a.freeBytes)[0];
    if (
      roomier &&
      !sameHomePath(roomier.root ?? roomier.path, defaultRoot, platform) &&
      roomier.freeBytes >= defaultFree + LIORA_HOME_ROOMIER_EXTRA_BYTES
    ) {
      candidate = roomier;
    }
  }

  if (!candidate) {
    return {
      home: defaultHomeDir,
      reason: 'default-tight',
      relocated: false,
      tight: true,
      freeBytes: defaultFree,
    };
  }

  const home = joinDriveRoot(candidate.root ?? candidate.path, productFolder);
  return {
    home,
    reason: candidate.freeBytes >= comfort ? 'roomier-drive' : 'roomier-drive-below-comfort',
    relocated: true,
    tight: candidate.freeBytes < comfort,
    freeBytes: candidate.freeBytes,
  };
}

export async function probeVolume(root) {
  try {
    const stats = await statfs(root);
    const block = Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * block;
    const totalBytes = Number(stats.blocks) * block;
    if (!Number.isFinite(freeBytes) || !Number.isFinite(totalBytes) || totalBytes <= 0) {
      return undefined;
    }
    return { root, path: root, freeBytes: Math.max(0, freeBytes), totalBytes };
  } catch {
    return undefined;
  }
}

export async function listWindowsVolumes(probe = probeVolume) {
  const volumes = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`;
    const space = await probe(root);
    if (space === undefined || space.totalBytes < 1024 * 1024 * 1024) continue;
    volumes.push(space);
  }
  return volumes;
}

export function formatGiB(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export async function planAndApplyInstallHome(options = {}) {
  const osHome = options.osHome ?? defaultHome();
  const platform = options.platform ?? process.platform;
  const explicitHome = options.explicitHome ?? process.env.SUPERLIORA_HOME;
  let volumes = options.volumes;
  if (volumes === undefined) {
    volumes = platform === 'win32' ? await listWindowsVolumes() : [];
    if (platform !== 'win32') {
      const homeVol = await probeVolume(osHome);
      if (homeVol) volumes = [homeVol];
    }
  }
  const plan = pickDataHome({
    explicitHome,
    osHome,
    volumes,
    platform,
    cwd: options.cwd ?? process.cwd(),
    defaultPopulated: options.defaultPopulated,
  });
  mkdirSync(plan.home, { recursive: true });
  process.env.SUPERLIORA_HOME = plan.home;
  if (plan.relocated) {
    writeHomeRedirect(plan.home, osHome);
    if (options.noShellRc !== true && platform === 'win32' && process.env.VITEST !== 'true') {
      try {
        writeUserEnvWin(plan.home, { envName: 'SUPERLIORA_HOME' });
      } catch {
        // Redirect file still works when User env is locked down.
      }
    }
  }
  return plan;
}
