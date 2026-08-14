/**
 * SuperLiora Windows runtime bin resolution.
 *
 * install.ps1 / ensure-git.mjs / ensure-node.mjs place PortableGit and a
 * pinned Node under `~/.superliora/runtime/{git,node}`. Workers and Script
 * must prefer those absolute paths over a missing Program Files Git so
 * `bash.exe` / `git.exe` / `node.exe` resolve without a system install.
 *
 * Pure of ambient FS when callers inject `isFile` / `listDir`.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';

export interface RuntimeBinPaths {
  /** Absolute path to runtime `git.exe` when present. */
  readonly gitExe?: string;
  /** Absolute path to runtime `bash.exe` when present. */
  readonly bashExe?: string;
  /** Absolute path to runtime `node.exe` / `node` when present. */
  readonly nodeExe?: string;
  /**
   * Directories to prepend to PATH so bare `git`/`bash`/`node` resolve to
   * the runtime copies (git/cmd, git/bin, node slug dir).
   */
  readonly pathDirs: readonly string[];
}

export interface ResolveRuntimeBinsDeps {
  readonly platform: string;
  readonly env: Record<string, string | undefined>;
  readonly isFile: (path: string) => boolean;
  /** List direct children of a directory; return [] when missing. */
  readonly listDir?: (path: string) => readonly string[];
}

function homesFromEnv(env: Record<string, string | undefined>): readonly string[] {
  const homes: string[] = [];
  const seen = new Set<string>();
  for (const key of ['HOME', 'USERPROFILE'] as const) {
    const home = env[key]?.trim();
    if (home === undefined || home.length === 0) continue;
    const normalized = nodePath.win32.normalize(home.replaceAll('/', '\\'));
    const keyLower = normalized.toLowerCase();
    if (seen.has(keyLower)) continue;
    seen.add(keyLower);
    homes.push(normalized);
  }
  return homes;
}

function pickNewestNodeSlug(slugs: readonly string[]): string | undefined {
  if (slugs.length === 0) return undefined;
  const sorted = [...slugs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return sorted[sorted.length - 1];
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

  for (const home of homesFromEnv(deps.env)) {
    const gitRoot = nodePath.win32.join(home, '.superliora', 'runtime', 'git');
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
      const nodeRoot = nodePath.win32.join(home, '.superliora', 'runtime', 'node');
      const children = listDir(nodeRoot);
      const slugs = children.filter((name) => name.toLowerCase().startsWith('node-v'));
      const preferred = pickNewestNodeSlug(slugs);
      const trySlugs = preferred !== undefined ? [preferred, ...slugs.filter((s) => s !== preferred)] : slugs;
      for (const slug of trySlugs) {
        const candidate = nodePath.win32.join(nodeRoot, slug, 'node.exe');
        if (deps.isFile(candidate)) {
          nodeExe = candidate;
          pushDir(nodePath.win32.dirname(candidate));
          break;
        }
      }
    }
  }

  return { gitExe, bashExe, nodeExe, pathDirs };
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

/** PATH directories for BashTool `pathPrefix` (sync, win32 only useful). */
export function runtimePathPrefixDirs(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  platform: string = process.platform,
): readonly string[] {
  return resolveRuntimeBinsFromNode(env, platform).pathDirs;
}
