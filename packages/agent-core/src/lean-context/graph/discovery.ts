import type { Kaos } from '@superliora/kaos';
import * as pathe from 'pathe';

import { isSensitiveFile } from '../../tools/policies/sensitive';
import type { WorkspaceConfig } from '../../tools/support/workspace';
import { relativeDisplayPath } from '../shared/display-path';

const MAX_DISCOVERED_PATHS = 8_000;
const FILE_READ_CONCURRENCY = 16;
const DIRECTORY_WALK_CONCURRENCY = 16;
const MAX_FILE_BYTES = 512 * 1024;
const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
]);

const EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.superliora',
  '.super-kimi',
  '.changeset',
  'node_modules',
  'dist',
  'build',
  'target',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
]);

export interface DiscoveredFile {
  readonly path: string;
  readonly displayPath: string;
  readonly mtimeMs: number;
  readonly size: number;
}

export async function discoverIndexableFiles(
  kaos: Kaos,
  workspace: WorkspaceConfig,
): Promise<DiscoveredFile[]> {
  const roots = [workspace.workspaceDir, ...workspace.additionalDirs];
  const discovered: DiscoveredFile[] = [];
  for (const root of roots) {
    await walkDirectory(kaos, workspace, root, discovered);
    if (discovered.length >= MAX_DISCOVERED_PATHS) break;
  }
  return discovered.slice(0, MAX_DISCOVERED_PATHS);
}

async function walkDirectory(
  kaos: Kaos,
  workspace: WorkspaceConfig,
  dir: string,
  discovered: DiscoveredFile[],
): Promise<void> {
  if (discovered.length >= MAX_DISCOVERED_PATHS) return;
  let entries: string[] = [];
  try {
    for await (const entry of kaos.iterdir(dir)) entries.push(entry);
  } catch {
    return;
  }
  entries = entries.toSorted((a, b) => a.localeCompare(b));
  const subdirs: string[] = [];
  for (const entry of entries) {
    if (discovered.length >= MAX_DISCOVERED_PATHS) return;
    const path = pathe.join(dir, entry);
    if (isSensitiveFile(path)) continue;
    let stat;
    try {
      stat = await kaos.stat(path);
    } catch {
      continue;
    }
    if (isDirectory(stat.stMode)) {
      if (EXCLUDED_SEGMENTS.has(entry)) continue;
      subdirs.push(path);
      continue;
    }
    if (!isRegularFile(stat.stMode) || stat.stSize > MAX_FILE_BYTES) continue;
    const displayPath = relativeDisplayPath(path, workspace);
    if (!isIndexableExtension(displayPath)) continue;
    discovered.push({
      path,
      displayPath,
      mtimeMs: stat.stMtime,
      size: stat.stSize,
    });
  }
  // Sibling subtrees are independent, so walk them in parallel instead of
  // serially awaiting each one. The shared `discovered` array is pushed to
  // under the MAX_DISCOVERED_PATHS cap; ordering within the cap is
  // best-effort, and the caller sorts the final slice.
  if (subdirs.length === 0) return;
  await mapWithConcurrency(subdirs, DIRECTORY_WALK_CONCURRENCY, (subdir) =>
    walkDirectory(kaos, workspace, subdir, discovered),
  );
}

function isIndexableExtension(displayPath: string): boolean {
  const ext = pathe.extname(displayPath).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

function isDirectory(stMode: number): boolean {
  return (stMode & S_IFMT) === S_IFDIR;
}

function isRegularFile(stMode: number): boolean {
  return (stMode & S_IFMT) === S_IFREG;
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item);
    }
  });
  await Promise.all(runners);
  return results;
}

export const GRAPH_PIPELINE_CONCURRENCY = FILE_READ_CONCURRENCY;
