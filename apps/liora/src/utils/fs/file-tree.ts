/**
 * Project file listing + tree building for the `/files` explorer.
 *
 * `listProjectFiles` enumerates the workspace once (sync, one-shot at open):
 * it prefers `git ls-files` (tracked + untracked, gitignore-respecting) and
 * falls back to a pruned recursive walk when git is unavailable. It never
 * throws. `buildFileTree` turns the flat slash-separated paths into a nested,
 * sorted tree; `flattenVisibleTree` projects the expanded subset into ordered
 * rows for the dialog. All three are pure/side-effect-light so they stay
 * testable without a terminal.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 20_000;

/** Directory names always pruned from the filesystem-walk fallback. */
const PRUNED_DIRS = new Set([
  'node_modules',
  '.git',
  '.pnpm-store',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  '.cache',
]);

export interface FileTreeNode {
  readonly name: string;
  readonly path: string;
  readonly kind: 'directory' | 'file';
  readonly children?: readonly FileTreeNode[];
}

export interface FlatTreeRow {
  readonly node: FileTreeNode;
  readonly depth: number;
}

export interface ListProjectFilesOptions {
  readonly maxEntries?: number;
}

export interface ProjectFileListing {
  readonly paths: string[];
  readonly truncated: boolean;
  readonly source: 'git' | 'walk';
}

interface MutableNode {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  children: Map<string, MutableNode>;
}

function compareNodes(a: MutableNode, b: MutableNode): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
  const al = a.name.toLowerCase();
  const bl = b.name.toLowerCase();
  if (al < bl) return -1;
  if (al > bl) return 1;
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

function finalizeNodes(nodes: Map<string, MutableNode>): FileTreeNode[] {
  const ordered = [...nodes.values()].toSorted(compareNodes);
  return ordered.map((node) => {
    if (node.kind === 'directory') {
      return {
        name: node.name,
        path: node.path,
        kind: 'directory',
        children: finalizeNodes(node.children),
      };
    }
    return { name: node.name, path: node.path, kind: 'file' };
  });
}

/**
 * Build a nested tree from flat slash-separated relative paths. Children are
 * sorted directories-first, then case-insensitive name order. Empty / blank
 * segments are ignored; an empty input yields `[]`.
 */
export function buildFileTree(relativePaths: readonly string[]): readonly FileTreeNode[] {
  const roots = new Map<string, MutableNode>();
  for (const raw of relativePaths) {
    const segments = raw.split('/').filter((seg) => seg.length > 0 && seg !== '.');
    if (segments.length === 0) continue;

    let siblings = roots;
    let pathSoFar = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      pathSoFar = pathSoFar.length === 0 ? seg : `${pathSoFar}/${seg}`;
      const isLast = i === segments.length - 1;
      let node = siblings.get(seg);
      if (node === undefined) {
        node = {
          name: seg,
          path: pathSoFar,
          kind: isLast ? 'file' : 'directory',
          children: new Map(),
        };
        siblings.set(seg, node);
      } else if (!isLast && node.kind === 'file') {
        // A prior leaf now needs to act as a directory prefix — promote it.
        node.kind = 'directory';
      }
      siblings = node.children;
    }
  }
  return finalizeNodes(roots);
}

/**
 * Project the tree into ordered rows, descending only into directories for
 * which `isExpanded(path)` is true. `depth` is zero-based indentation level.
 */
export function flattenVisibleTree(
  nodes: readonly FileTreeNode[],
  isExpanded: (path: string) => boolean,
  depth = 0,
): FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (node.kind === 'directory' && node.children && isExpanded(node.path)) {
      rows.push(...flattenVisibleTree(node.children, isExpanded, depth + 1));
    }
  }
  return rows;
}

function listViaGit(workDir: string): string[] | null {
  try {
    const out = execFileSync(
      'git',
      ['-C', workDir, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return out.split('\0').filter((entry) => entry.length > 0);
  } catch {
    return null;
  }
}

function shouldPruneDir(name: string): boolean {
  if (PRUNED_DIRS.has(name)) return true;
  // Hidden directories are pruned except `.github` (workflows live there).
  return name.startsWith('.') && name !== '.github';
}

function walkDir(absDir: string, relPrefix: string, out: string[], cap: number): void {
  if (out.length >= cap) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (out.length >= cap) return;
    const name = entry.name;
    const rel = relPrefix.length === 0 ? name : `${relPrefix}/${name}`;
    if (entry.isDirectory()) {
      if (shouldPruneDir(name)) continue;
      walkDir(join(absDir, name), rel, out, cap);
    } else if (entry.isFile()) {
      out.push(rel);
    }
    // Symbolic links are intentionally skipped to avoid cycles.
  }
}

/**
 * Enumerate project files relative to `workDir`. Prefers git (tracked +
 * untracked, honoring gitignore); falls back to a pruned recursive walk when
 * git is missing or `workDir` is not a repository. The result is sorted and
 * capped at `maxEntries` (default 20,000); `truncated` reports whether the cap
 * was reached. Never throws.
 */
export function listProjectFiles(
  workDir: string,
  options: ListProjectFilesOptions = {},
): ProjectFileListing {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  const fromGit = listViaGit(workDir);
  if (fromGit !== null) {
    const sorted = fromGit.toSorted();
    const truncated = sorted.length > maxEntries;
    return {
      paths: truncated ? sorted.slice(0, maxEntries) : sorted,
      truncated,
      source: 'git',
    };
  }

  const walked: string[] = [];
  walkDir(workDir, '', walked, maxEntries);
  const sorted = walked.toSorted();
  return { paths: sorted, truncated: sorted.length >= maxEntries, source: 'walk' };
}
