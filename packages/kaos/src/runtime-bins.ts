/**
 * SuperLiora Windows runtime bin resolution.
 *
 * install.ps1 / ensure-git.mjs / ensure-node.mjs place PortableGit and a
 * pinned Node under `~/.superliora/runtime/{git,node}`. Workers and Script
 * must prefer those absolute paths over a missing Program Files Git so
 * `bash.exe` / `git.exe` / `node.exe` resolve without a system install.
 *
 * Pure of ambient FS when callers inject `isFile` / `listDir` / `readText`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';

export interface RuntimeBinPaths {
  /** Absolute path to runtime `git.exe` when present. */
  readonly gitExe?: string;
  /** Absolute path to runtime `bash.exe` when present. */
  readonly bashExe?: string;
  /** Absolute path to runtime `node.exe` / `node` when present. */
  readonly nodeExe?: string;
  /** Absolute path to corepack `pnpm.js` next to runtime node, when present. */
  readonly pnpmJs?: string;
  /** Absolute path to `npm-cli.js` next to runtime node, when present. */
  readonly npmJs?: string;
  /** Absolute path to `npx-cli.js` next to runtime node, when present. */
  readonly npxJs?: string;
  /**
   * Directories to prepend to PATH so bare `git`/`bash`/`node`/`pnpm` resolve
   * to the runtime copies (git/cmd, git/bin, node slug dir).
   */
  readonly pathDirs: readonly string[];
}

export interface ResolveRuntimeBinsDeps {
  readonly platform: string;
  readonly env: Record<string, string | undefined>;
  readonly isFile: (path: string) => boolean;
  /** List direct children of a directory; return [] when missing. */
  readonly listDir?: (path: string) => readonly string[];
  /** Read a small text file; return undefined when missing. */
  readonly readText?: (path: string) => string | undefined;
}

/** Spawn rewrite: `pnpm`/`npm` run through runtime `node.exe` + the JS CLI. */
export interface RuntimeSpawnTarget {
  readonly file: string;
  readonly prefixArgs: readonly string[];
}

function pushUnique(out: string[], seen: Set<string>, path: string): void {
  const normalized = nodePath.win32.normalize(path.replaceAll('/', '\\'));
  const key = normalized.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(normalized);
}

function parseHomeRedirectText(text: string): string | undefined {
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    if (!nodePath.win32.isAbsolute(line) && !nodePath.posix.isAbsolute(line)) return undefined;
    return nodePath.win32.normalize(line.replaceAll('/', '\\'));
  }
  return undefined;
}

function osProfileHomes(env: Record<string, string | undefined>): readonly string[] {
  const homes: string[] = [];
  const seen = new Set<string>();
  for (const key of ['HOME', 'USERPROFILE'] as const) {
    const home = env[key]?.trim();
    if (home === undefined || home.length === 0) continue;
    pushUnique(homes, seen, home);
  }
  return homes;
}

function looksLikeDataHome(deps: ResolveRuntimeBinsDeps, dataHome: string): boolean {
  const listDir = deps.listDir ?? (() => []);
  const gitCmd = nodePath.win32.join(dataHome, 'runtime', 'git', 'cmd', 'git.exe');
  const gitBin = nodePath.win32.join(dataHome, 'runtime', 'git', 'bin', 'git.exe');
  if (deps.isFile(gitCmd) || deps.isFile(gitBin)) return true;
  const nodeRoot = nodePath.win32.join(dataHome, 'runtime', 'node');
  return listDir(nodeRoot).some((name) => name.toLowerCase().startsWith('node-v'));
}

/**
 * SuperLiora data homes that contain `runtime/{git,node}`.
 *
 * Order: `SUPERLIORA_HOME`, then `~/.superliora/home.redirect`, then an OS
 * profile that itself looks like the data home, then `~/.superliora`.
 * Looking only at `USERPROFILE\.superliora\runtime` misses redirected homes
 * and marks Windows jobs as verification-failed when `pnpm`/`node` are not
 * on PATH.
 */
function dataHomesFromEnv(deps: ResolveRuntimeBinsDeps): readonly string[] {
  const homes: string[] = [];
  const seen = new Set<string>();

  const explicit = deps.env['SUPERLIORA_HOME']?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    pushUnique(homes, seen, explicit);
  }

  for (const osHome of osProfileHomes(deps.env)) {
    const pointer = nodePath.win32.join(osHome, '.superliora');
    const redirectFile = nodePath.win32.join(pointer, 'home.redirect');
    const raw = deps.readText?.(redirectFile);
    if (raw !== undefined) {
      const redirected = parseHomeRedirectText(raw);
      if (redirected !== undefined && redirected.toLowerCase() !== pointer.toLowerCase()) {
        pushUnique(homes, seen, redirected);
      }
    }
    if (looksLikeDataHome(deps, osHome)) {
      pushUnique(homes, seen, osHome);
    }
    pushUnique(homes, seen, pointer);
  }

  return homes;
}

function pickExistingFile(isFile: (path: string) => boolean, candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function pickNewestNodeSlug(slugs: readonly string[]): string | undefined {
  if (slugs.length === 0) return undefined;
  const sorted = [...slugs].toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return sorted.at(-1);
}

/**
 * Resolve SuperLiora runtime git/bash/node absolute paths for the host.
 * Non-win32 returns empty pathDirs (POSIX uses system tools).
 */
export function resolveRuntimeBins(deps: ResolveRuntimeBinsDeps): RuntimeBinPaths {
  if (deps.platform !== 'win32') {
    return { pathDirs: [] };
  }

  const listDir = deps.listDir ?? (() => []);
  let gitExe: string | undefined;
  let bashExe: string | undefined;
  let nodeExe: string | undefined;
  let pnpmJs: string | undefined;
  let npmJs: string | undefined;
  let npxJs: string | undefined;
  const pathDirs: string[] = [];
  const seenDirs = new Set<string>();

  const pushDir = (dir: string): void => {
    const normalized = nodePath.win32.normalize(dir);
    const key = normalized.toLowerCase();
    if (seenDirs.has(key)) return;
    if (!deps.isFile(nodePath.win32.join(normalized, 'git.exe')) &&
        !deps.isFile(nodePath.win32.join(normalized, 'bash.exe')) &&
        !deps.isFile(nodePath.win32.join(normalized, 'node.exe'))) {
      // Still allow known layout dirs when the marker lives one level up —
      // callers only push dirs that already had a hit below.
    }
    seenDirs.add(key);
    pathDirs.push(normalized);
  };

  for (const home of dataHomesFromEnv(deps)) {
    const gitRoot = nodePath.win32.join(home, 'runtime', 'git');
    const gitCmd = nodePath.win32.join(gitRoot, 'cmd', 'git.exe');
    const gitBin = nodePath.win32.join(gitRoot, 'bin', 'git.exe');
    const bashBin = nodePath.win32.join(gitRoot, 'bin', 'bash.exe');
    const bashUsr = nodePath.win32.join(gitRoot, 'usr', 'bin', 'bash.exe');

    if (gitExe === undefined) {
      if (deps.isFile(gitCmd)) {
        gitExe = gitCmd;
        pushDir(nodePath.win32.dirname(gitCmd));
      } else if (deps.isFile(gitBin)) {
        gitExe = gitBin;
        pushDir(nodePath.win32.dirname(gitBin));
      }
    }

    if (bashExe === undefined) {
      if (deps.isFile(bashBin)) {
        bashExe = bashBin;
        pushDir(nodePath.win32.dirname(bashBin));
      } else if (deps.isFile(bashUsr)) {
        bashExe = bashUsr;
        pushDir(nodePath.win32.dirname(bashUsr));
      }
    }

    // Ensure git/bin is on PATH even when only cmd/git.exe was found (bash lives in bin).
    if (gitExe !== undefined && deps.isFile(bashBin)) {
      pushDir(nodePath.win32.dirname(bashBin));
    }

    if (nodeExe === undefined) {
      const nodeRoot = nodePath.win32.join(home, 'runtime', 'node');
      const children = listDir(nodeRoot);
      const slugs = children.filter((name) => name.toLowerCase().startsWith('node-v'));
      const preferred = pickNewestNodeSlug(slugs);
      const trySlugs = preferred !== undefined ? [preferred, ...slugs.filter((s) => s !== preferred)] : slugs;
      for (const slug of trySlugs) {
        const candidate = nodePath.win32.join(nodeRoot, slug, 'node.exe');
        if (deps.isFile(candidate)) {
          nodeExe = candidate;
          const nodeDir = nodePath.win32.dirname(candidate);
          pushDir(nodeDir);
          pnpmJs = pickExistingFile(deps.isFile, [
            nodePath.win32.join(nodeDir, 'node_modules', 'corepack', 'dist', 'pnpm.js'),
          ]);
          npmJs = pickExistingFile(deps.isFile, [
            nodePath.win32.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
          ]);
          npxJs = pickExistingFile(deps.isFile, [
            nodePath.win32.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js'),
          ]);
          break;
        }
      }
    }
  }

  return { gitExe, bashExe, nodeExe, pnpmJs, npmJs, npxJs, pathDirs };
}

/** Sync FS-backed resolve for production callers. */
export function resolveRuntimeBinsFromNode(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  platform: string = process.platform,
): RuntimeBinPaths {
  return resolveRuntimeBins({
    platform,
    env,
    isFile: (path) => {
      try {
        return existsSync(path) && statSync(path).isFile();
      } catch {
        return false;
      }
    },
    listDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
    readText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return undefined;
      }
    },
  });
}

/**
 * Prepend runtime bin directories to PATH (win32 `;`, else `:`).
 * Returns a new env record; does not mutate the input.
 */
export function runtimePathPrepend(
  env: Record<string, string | undefined>,
  options: {
    readonly platform?: string;
    readonly bins?: RuntimeBinPaths;
    readonly pathKey?: 'PATH' | 'Path';
  } = {},
): Record<string, string> {
  const platform = options.platform ?? process.platform;
  const bins = options.bins ?? resolveRuntimeBinsFromNode(env, platform);
  const sep = platform === 'win32' ? ';' : ':';
  const pathKey =
    options.pathKey ??
    (platform === 'win32' && env['Path'] !== undefined && env['PATH'] === undefined ? 'Path' : 'PATH');

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }

  if (bins.pathDirs.length === 0) return out;

  const existing = out[pathKey] ?? out['PATH'] ?? out['Path'] ?? '';
  const prefix = bins.pathDirs.join(sep);
  out[pathKey] = existing.length > 0 ? `${prefix}${sep}${existing}` : prefix;
  // Keep PATH canonical on Windows when we wrote Path.
  if (pathKey === 'Path' && out['PATH'] === undefined) {
    out['PATH'] = out[pathKey]!;
  }
  return out;
}

/**
 * Map a short command name to a runtime absolute path when known.
 * Returns the input unchanged when not a runtime-managed binary or missing.
 */
export function resolveRuntimeExecutable(
  name: string,
  bins?: RuntimeBinPaths,
  platform: string = process.platform,
): string {
  const resolved = bins ?? resolveRuntimeBinsFromNode(undefined, platform);
  const base = name.replaceAll('/', '\\').split('\\').pop() ?? name;
  const lower = base.toLowerCase();

  if (lower === 'git' || lower === 'git.exe') {
    return resolved.gitExe ?? name;
  }
  if (lower === 'bash' || lower === 'bash.exe') {
    return resolved.bashExe ?? name;
  }
  if (lower === 'node' || lower === 'node.exe') {
    return resolved.nodeExe ?? name;
  }
  return name;
}

const PNPM_NAMES = new Set(['pnpm', 'pnpm.cmd', 'pnpm.exe']);
const NPM_NAMES = new Set(['npm', 'npm.cmd', 'npm.exe']);
const NPX_NAMES = new Set(['npx', 'npx.cmd', 'npx.exe']);

/**
 * Map a short command to a spawnable `{ file, prefixArgs }` on Windows.
 * `pnpm`/`npm`/`npx` run as `node.exe <cli.js> …` so we never spawn a `.cmd`
 * shim (Node `spawn` without `shell` cannot run those).
 */
export function resolveRuntimeSpawn(
  name: string,
  bins?: RuntimeBinPaths,
  platform: string = process.platform,
): RuntimeSpawnTarget {
  const resolved = bins ?? resolveRuntimeBinsFromNode(undefined, platform);
  const file = resolveRuntimeExecutable(name, resolved, platform);
  const base = name.replaceAll('/', '\\').split('\\').pop() ?? name;
  const lower = base.toLowerCase();

  if (platform === 'win32' && resolved.nodeExe !== undefined) {
    if (PNPM_NAMES.has(lower) && resolved.pnpmJs !== undefined) {
      return { file: resolved.nodeExe, prefixArgs: [resolved.pnpmJs] };
    }
    if (NPM_NAMES.has(lower) && resolved.npmJs !== undefined) {
      return { file: resolved.nodeExe, prefixArgs: [resolved.npmJs] };
    }
    if (NPX_NAMES.has(lower) && resolved.npxJs !== undefined) {
      return { file: resolved.nodeExe, prefixArgs: [resolved.npxJs] };
    }
  }

  return { file, prefixArgs: [] };
}

/** PATH directories for BashTool `pathPrefix` (sync, win32 only useful). */
export function runtimePathPrefixDirs(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  platform: string = process.platform,
): readonly string[] {
  return resolveRuntimeBinsFromNode(env, platform).pathDirs;
}
