import type { Kaos } from '@superliora/kaos';
import * as pathe from 'pathe';

import { isSensitiveFile } from '../../policies/sensitive';
import type { WorkspaceConfig } from '../../support/workspace';
import type { ContextFile } from './context-types';

const MAX_CANDIDATE_FILES = 250;
const MAX_DISCOVERED_PATHS = 5_000;
const MAX_FILE_BYTES = 256 * 1024;
const FILE_READ_CONCURRENCY = 24;
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
  '.vue',
  '.svelte',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.swift',
]);
const EXPLICIT_TEXT_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml']);
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

interface CollectContextFilesOptions {
  readonly kaos: Kaos;
  readonly workspace: WorkspaceConfig;
  readonly explicitPaths?: readonly string[] | undefined;
  readonly query?: string | undefined;
}

export async function collectContextFiles({
  kaos,
  workspace,
  explicitPaths,
  query,
}: CollectContextFilesOptions): Promise<ContextFile[]> {
  const paths = explicitPaths ?? (await discoverWorkspaceFiles(kaos, workspace, query));
  const files = await mapWithConcurrency(paths, FILE_READ_CONCURRENCY, async (path) => {
    if (!isCollectablePath(path, explicitPaths !== undefined)) return undefined;
    const stat = await kaos.stat(path);
    if (!isRegularFile(stat.stMode) || stat.stSize > MAX_FILE_BYTES) return undefined;
    const content = await kaos.readText(path, { errors: 'strict' });
    return {
      path,
      displayPath: relativeDisplayPath(path, workspace),
      content,
      lineCount: countLines(content),
    } satisfies ContextFile;
  });
  return files.filter((file): file is ContextFile => file !== undefined).slice(0, MAX_CANDIDATE_FILES);
}

async function discoverWorkspaceFiles(
  kaos: Kaos,
  workspace: WorkspaceConfig,
  query: string | undefined,
): Promise<string[]> {
  const queryTokens = buildQueryTokens(query);
  const paths: string[] = [];
  const queue = [workspace.workspaceDir, ...workspace.additionalDirs].toSorted(
    (a, b) => directoryPriority(a, workspace, queryTokens) - directoryPriority(b, workspace, queryTokens),
  );
  while (queue.length > 0 && paths.length < MAX_DISCOVERED_PATHS) {
    const dir = queue.shift();
    if (dir === undefined) break;
    const discovered = await walkDirectory(kaos, dir, queryTokens);
    for (const subdir of discovered.directories) {
      insertDirectoryByPriority(queue, subdir, workspace, queryTokens);
    }
    for (const path of discovered.files) {
      paths.push(path);
      if (paths.length >= MAX_DISCOVERED_PATHS) break;
    }
  }
  return paths
    .toSorted(
      (a, b) =>
        discoveryPriority(a, workspace, queryTokens) - discoveryPriority(b, workspace, queryTokens) ||
        a.localeCompare(b),
    )
    .slice(0, MAX_CANDIDATE_FILES);
}

async function walkDirectory(
  kaos: Kaos,
  dir: string,
  queryTokens: readonly string[],
): Promise<{ directories: string[]; files: string[] }> {
  let entries: string[] = [];
  try {
    for await (const entry of kaos.iterdir(dir)) {
      entries.push(entry);
    }
  } catch {
    return { directories: [], files: [] };
  }

  entries = entries.toSorted(
    (a, b) => entryPriority(pathe.join(dir, a), queryTokens) - entryPriority(pathe.join(dir, b), queryTokens),
  );
  const directories: string[] = [];
  const files: string[] = [];
  for (const entry of entries) {
    const path = pathe.isAbsolute(entry) ? entry : pathe.join(dir, entry);
    if (EXCLUDED_SEGMENTS.has(pathe.basename(path))) continue;
    let stat;
    try {
      stat = await kaos.stat(path, { followSymlinks: false });
    } catch {
      continue;
    }
    if (isDirectory(stat.stMode)) {
      directories.push(path);
      continue;
    }
    if (isRegularFile(stat.stMode) && isAutoDiscoverablePath(path)) {
      files.push(path);
    }
  }
  return { directories, files };
}

function isCollectablePath(path: string, explicit: boolean): boolean {
  if (isSensitiveFile(path)) return false;
  if (explicit) return isSupportedExplicitPath(path);
  return isAutoDiscoverablePath(path);
}

function isSupportedExplicitPath(path: string): boolean {
  const extension = pathe.extname(path).toLowerCase();
  return CODE_EXTENSIONS.has(extension) || EXPLICIT_TEXT_EXTENSIONS.has(extension);
}

function isAutoDiscoverablePath(path: string): boolean {
  if (shouldSkipPath(path)) return false;
  return CODE_EXTENSIONS.has(pathe.extname(path).toLowerCase());
}

function sourcePathPriority(path: string, workspace: WorkspaceConfig): number {
  const displayPath = relativeDisplayPath(path, workspace);
  if (/^(?:packages|apps)\/[^/]+\/src\//.test(displayPath)) return 0;
  if (displayPath.startsWith('src/')) return 1;
  if (/^(?:packages|apps)\//.test(displayPath)) return 2;
  return 3;
}

function discoveryPriority(
  path: string,
  workspace: WorkspaceConfig,
  queryTokens: readonly string[],
): number {
  const displayPath = relativeDisplayPath(path, workspace);
  return entryPriority(displayPath, queryTokens) + sourcePathPriority(path, workspace);
}

function shouldSkipPath(path: string): boolean {
  return path.split(/[\\/]+/).some((part) => EXCLUDED_SEGMENTS.has(part));
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  return content.split(/\r?\n/).length;
}

function isRegularFile(stMode: number): boolean {
  return (stMode & S_IFMT) === S_IFREG;
}

function isDirectory(stMode: number): boolean {
  return (stMode & S_IFMT) === S_IFDIR;
}

function relativeDisplayPath(path: string, workspace: WorkspaceConfig): string {
  if (path === workspace.workspaceDir) return '.';
  if (path.startsWith(workspace.workspaceDir + '/')) {
    return path.slice(workspace.workspaceDir.length + 1);
  }
  for (const dir of workspace.additionalDirs) {
    if (path === dir) return pathe.basename(dir);
    if (path.startsWith(dir + '/')) return path.slice(dir.length + 1);
  }
  return path;
}

function normalizeToken(text: string): string {
  return text.toLowerCase().replaceAll(/[^a-z0-9]+/g, '');
}

function buildQueryTokens(query: string | undefined): string[] {
  if (query === undefined) return [];
  const rawTokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 2);
  const normalized = normalizeToken(query);
  return [...new Set(normalized.length >= 2 ? [...rawTokens, normalized] : rawTokens)];
}

function directoryPriority(
  path: string,
  workspace: WorkspaceConfig,
  queryTokens: readonly string[],
): number {
  return entryPriority(relativeDisplayPath(path, workspace), queryTokens) + sourcePathPriority(path, workspace);
}

function entryPriority(path: string, queryTokens: readonly string[]): number {
  const normalizedPath = normalizeToken(path);
  let score = 0;
  for (const token of queryTokens) {
    if (!normalizedPath.includes(token)) continue;
    score -= token.length >= 6 ? 12 : 7;
  }
  const basename = pathe.basename(path).toLowerCase();
  if (basename === 'src') score -= 10;
  else if (basename.endsWith('.ts') || basename.endsWith('.tsx')) score -= 4;
  return score;
}

function insertDirectoryByPriority(
  queue: string[],
  directory: string,
  workspace: WorkspaceConfig,
  queryTokens: readonly string[],
): void {
  const priority = directoryPriority(directory, workspace, queryTokens);
  let index = 0;
  while (
    index < queue.length &&
    directoryPriority(queue[index]!, workspace, queryTokens) <= priority
  ) {
    index += 1;
  }
  queue.splice(index, 0, directory);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
