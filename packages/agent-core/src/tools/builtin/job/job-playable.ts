/**
 * Playable dest path + safe worktree → checkout copy for greenfield fills.
 * Never touches dest `.git` or `NVIDIA Corporation/`.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import type { JobRecord } from './job-store-key';
import type { SubagentResultContract } from '../../../session/subagent/subagent-result-contract';

const FORBIDDEN_DEST_SEGMENTS = [
  '.git',
  'node_modules',
  'nvidia corporation',
  '.env',
] as const;

const PLAYABLE_ENTRY_CANDIDATES = ['index.html', 'index.htm'] as const;

export function destIsUserDesktopDocument(path: string | undefined): boolean {
  if (path === undefined || path.trim().length === 0) return false;
  const n = path.replaceAll('\\', '/');
  if (!/\/desktop\//i.test(n)) return false;
  return /\.(md|txt|markdown)$/i.test(n);
}

export function isForbiddenDestRelPath(relPath: string): boolean {
  const n = relPath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (n.length === 0) return true;
  const parts = n.split('/');
  return parts.some((part) => {
    const lower = part.toLowerCase();
    return FORBIDDEN_DEST_SEGMENTS.some((seg) => lower === seg);
  });
}

export function inferPlayableFromChangeSet(
  filesChanged: readonly string[],
  summary?: string,
): 'yes' | 'no' | 'unknown' {
  const hay = `${filesChanged.join('\n')}\n${summary ?? ''}`.toLowerCase();
  if (
    filesChanged.some((file) => /(?:^|\/)index\.html?$/i.test(file.replaceAll('\\', '/')))
  ) {
    return 'yes';
  }
  if (
    /https?:\/\/localhost\b|python\s+-m\s+http\.server|file:\/\/|playable/i.test(hay)
  ) {
    return 'yes';
  }
  if (filesChanged.some((file) => /\.html?$/i.test(file))) return 'yes';
  if (filesChanged.length === 0 && (summary === undefined || summary.trim().length === 0)) {
    return 'unknown';
  }
  return 'unknown';
}

function resolvePlayablePath(input: {
  readonly job: Pick<JobRecord, 'worktreePath' | 'repoRoot' | 'ownershipPaths'>;
  readonly filesChanged?: readonly string[];
}): string | undefined {
  const dest = input.job.repoRoot?.trim();
  const worktree = input.job.worktreePath?.trim();
  const files = input.filesChanged ?? [];
  const entry = files.find((file) =>
    PLAYABLE_ENTRY_CANDIDATES.some((name) => file.replaceAll('\\', '/').endsWith(name)),
  );
  if (dest !== undefined && dest.length > 0) {
    if (entry !== undefined) return join(dest, entry);
    const indexAtDest = PLAYABLE_ENTRY_CANDIDATES.map((name) => join(dest, name)).find((p) =>
      existsSync(p),
    );
    if (indexAtDest !== undefined) return indexAtDest;
    return dest;
  }
  if (worktree !== undefined && worktree.length > 0) {
    if (entry !== undefined) return join(worktree, entry);
    return worktree;
  }
  const ownership = input.job.ownershipPaths?.[0];
  return ownership;
}

interface SyncPlayableFilesResult {
  readonly ok: boolean;
  readonly playablePath?: string;
  readonly copied: number;
  readonly skipped: number;
  readonly error?: string;
}

/**
 * Copy product files from the job worktree onto dest (user checkout).
 * Skips `.git`, `node_modules`, and `NVIDIA Corporation/`.
 */
export function syncPlayableFilesToDest(input: {
  readonly worktreePath: string;
  readonly destPath: string;
  readonly filesChanged: readonly string[];
}): SyncPlayableFilesResult {
  const srcRoot = resolve(input.worktreePath);
  const destRoot = resolve(input.destPath);
  if (samePath(srcRoot, destRoot)) {
    return {
      ok: true,
      playablePath: resolvePlayablePath({
        job: { worktreePath: srcRoot, repoRoot: destRoot },
        filesChanged: input.filesChanged,
      }),
      copied: 0,
      skipped: 0,
    };
  }
  let copied = 0;
  let skipped = 0;
  try {
    for (const file of input.filesChanged) {
      const rel = file.replaceAll('\\', '/').replace(/^\/+/, '');
      if (isForbiddenDestRelPath(rel)) {
        skipped += 1;
        continue;
      }
      const from = join(srcRoot, rel);
      const to = join(destRoot, rel);
      if (!pathInsideRoot(destRoot, to) || !pathInsideRoot(srcRoot, from)) {
        skipped += 1;
        continue;
      }
      if (!existsSync(from) || !statSync(from).isFile()) {
        skipped += 1;
        continue;
      }
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      copied += 1;
    }
  } catch (error) {
    return {
      ok: false,
      copied,
      skipped,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    ok: true,
    playablePath: resolvePlayablePath({
      job: { worktreePath: srcRoot, repoRoot: destRoot },
      filesChanged: input.filesChanged,
    }),
    copied,
    skipped,
  };
}

export function playableStampForContract(
  contract: SubagentResultContract | undefined,
  job: Pick<JobRecord, 'worktreePath' | 'repoRoot' | 'ownershipPaths' | 'deliveryPhase'>,
): { readonly playablePath?: string; readonly copied?: number } {
  const files = contract?.files_changed ?? [];
  const dest = job.repoRoot?.trim();
  const worktree = job.worktreePath?.trim();
  if (
    dest !== undefined &&
    worktree !== undefined &&
    !samePath(dest, worktree) &&
    files.length > 0 &&
    existsSync(dest) &&
    (job.deliveryPhase === 'fill' || contract?.verification.playable === 'yes')
  ) {
    const sync = syncPlayableFilesToDest({
      worktreePath: worktree,
      destPath: dest,
      filesChanged: files,
    });
    return { playablePath: sync.playablePath, copied: sync.copied };
  }
  return {
    playablePath: resolvePlayablePath({ job, filesChanged: files }),
  };
}

function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

function pathInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel.length === 0) return true;
  if (rel.startsWith('..')) return false;
  if (rel.split(sep).includes('..')) return false;
  return true;
}
