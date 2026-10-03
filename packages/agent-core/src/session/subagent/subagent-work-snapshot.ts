import type { Kaos } from '@superliora/kaos';

import { runGit, type GitResult } from '../git-context';
import { hasUnsettledExecutionResources } from '../job/git';

export interface GitWorkSnapshot {
  readonly head: string | undefined;
  readonly dirtyFiles: readonly string[];
}

/** Git delta observed in the worker cwd; shared cwd changes are not attributed. */
export function computeFilesChanged(options: {
  readonly committedChanged: readonly string[];
  readonly dirtyBefore: readonly string[];
  readonly dirtyNow: readonly string[];
}): string[] {
  const before = new Set(options.dirtyBefore);
  const merged = new Set<string>();
  for (const file of [...options.committedChanged, ...options.dirtyNow]) {
    if (file.length > 0 && !before.has(file)) merged.add(file);
  }
  return [...merged].toSorted();
}

export function snapshotChildWork(child: { readonly kaos: Kaos; readonly config: { readonly cwd: string } }, signal?: AbortSignal): Promise<GitWorkSnapshot> {
  return snapshotGitWork(child.kaos, child.config.cwd, signal);
}

export async function snapshotGitWork(kaos: Kaos, cwd: string, signal?: AbortSignal): Promise<GitWorkSnapshot> {
  const [head, status] = await Promise.allSettled([
    runGit(kaos, cwd, ['rev-parse', 'HEAD'], signal),
    runGit(kaos, cwd, ['status', '--porcelain'], signal),
  ] as const);
  if (head.status === 'rejected' && status.status === 'rejected') {
    const errors: readonly unknown[] = [head.reason, status.reason];
    const error = new AggregateError(errors, 'Worker Git snapshot failed.');
    if (errors.some(hasUnsettledExecutionResources)) {
      Object.defineProperty(error, 'resourcesSettled', {
        get: () => !errors.some(hasUnsettledExecutionResources),
      });
    }
    throw error;
  }
  if (head.status === 'rejected') throw head.reason;
  if (status.status === 'rejected') throw status.reason;
  return {
    head: head.value.ok && head.value.stdout.length > 0 ? head.value.stdout : undefined,
    dirtyFiles: parseStatusPorcelain(status.value),
  };
}

export async function collectFilesChanged(
  kaos: Kaos,
  cwd: string,
  before: GitWorkSnapshot,
  signal?: AbortSignal,
): Promise<string[]> {
  const after = await snapshotGitWork(kaos, cwd, signal);
  let committedChanged: string[] = [];
  if (before.head !== undefined && after.head !== undefined && before.head !== after.head) {
    const diff = await runGit(kaos, cwd, ['diff', '--name-only', `${before.head}..${after.head}`], signal);
    if (diff.ok && diff.stdout.length > 0) {
      committedChanged = diff.stdout.split('\n').filter((line) => line.length > 0);
    }
  }
  return computeFilesChanged({
    committedChanged,
    dirtyBefore: before.dirtyFiles,
    dirtyNow: after.dirtyFiles,
  });
}

function parseStatusPorcelain(result: GitResult): string[] {
  if (!result.ok || result.stdout.length === 0) return [];
  const files: string[] = [];
  for (const line of result.stdout.split('\n')) {
    if (line.length < 4) continue;
    let path = line.slice(3).trim();
    const arrow = path.indexOf(' -> ');
    if (arrow >= 0) path = path.slice(arrow + 4);
    if (path.length > 0) files.push(path);
  }
  return files;
}
