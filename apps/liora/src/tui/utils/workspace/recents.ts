/**
 * Recent workspace folders from the session index (most recently updated first).
 */

import { resolve } from 'node:path';

import { sameWorkspaceDir } from './paths';

export interface WorkspaceRecentSource {
  readonly workDir: string;
  readonly updatedAt?: number;
}

export function uniqueRecentWorkDirs(
  sessions: readonly WorkspaceRecentSource[],
  options: {
    readonly exclude?: string;
    readonly limit?: number;
  } = {},
): string[] {
  const ranked = [...sessions].toSorted(
    (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
  const seen = new Set<string>();
  const dirs: string[] = [];
  const limit = options.limit ?? 8;
  for (const session of ranked) {
    const dir = session.workDir.trim();
    if (dir.length === 0) continue;
    if (options.exclude !== undefined && sameWorkspaceDir(dir, options.exclude)) continue;
    const key = process.platform === 'win32' ? resolve(dir).toLowerCase() : resolve(dir);
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(resolve(dir));
    if (dirs.length >= limit) break;
  }
  return dirs;
}
