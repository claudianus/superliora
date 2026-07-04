import type { Kaos } from '@superliora/kaos';
import * as pathe from 'pathe';

import { isSensitiveFile } from '../../policies/sensitive';
import type { WorkspaceConfig } from '../../support/workspace';
import type { ContextFile } from './context-types';

const MAX_CANDIDATE_FILES = 250;
const MAX_DISCOVERED_PATHS = 5_000;
const MAX_FILE_BYTES = 256 * 1024;
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
  const files: ContextFile[] = [];
  for (const path of paths) {
    if (files.length >= MAX_CANDIDATE_FILES) break;
    if (!isCollectablePath(path, explicitPaths !== undefined)) continue;
    const stat = await kaos.stat(path);
    if (!isRegularFile(stat.stMode) || stat.stSize > MAX_FILE_BYTES) continue;
    const content = await kaos.readText(path, { errors: 'strict' });
    files.push({
      path,
      displayPath: relativeDisplayPath(path, workspace),
      content,
      lineCount: countLines(content),
    });
  }
  return files;
}

async function discoverWorkspaceFiles(
  kaos: Kaos,
  workspace: WorkspaceConfig,
  query: string | undefined,
): Promise<string[]> {
  const paths: string[] = [];
  for (const root of [workspace.workspaceDir, ...workspace.additionalDirs]) {
    if (paths.length >= MAX_DISCOVERED_PATHS) break;
    await walkDirectory(kaos, root, paths);
  }
  return paths
    .toSorted(
      (a, b) =>
        discoveryPriority(a, workspace, query) - discoveryPriority(b, workspace, query) ||
        a.localeCompare(b),
    )
    .slice(0, MAX_CANDIDATE_FILES);
}

async function walkDirectory(kaos: Kaos, dir: string, paths: string[]): Promise<void> {
  let entries: string[] = [];
  try {
    for await (const entry of kaos.iterdir(dir)) {
      entries.push(entry);
    }
  } catch {
    return;
  }

  entries = entries.toSorted((a, b) => a.localeCompare(b));
  for (const entry of entries) {
    if (paths.length >= MAX_DISCOVERED_PATHS) return;
    const path = pathe.isAbsolute(entry) ? entry : pathe.join(dir, entry);
    if (EXCLUDED_SEGMENTS.has(pathe.basename(path))) continue;
    let stat;
    try {
      stat = await kaos.stat(path, { followSymlinks: false });
    } catch {
      continue;
    }
    if (isDirectory(stat.stMode)) {
      await walkDirectory(kaos, path, paths);
      continue;
    }
    if (isRegularFile(stat.stMode) && isAutoDiscoverablePath(path)) {
      paths.push(path);
    }
  }
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
  query: string | undefined,
): number {
  const displayPath = relativeDisplayPath(path, workspace);
  const normalizedQuery = query === undefined ? '' : normalizeToken(query);
  const queryMatch =
    normalizedQuery.length > 0 && normalizeToken(displayPath).includes(normalizedQuery) ? -20 : 0;
  return queryMatch + sourcePathPriority(path, workspace);
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
