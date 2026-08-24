/**
 * Workspace session catalog — jobs persist per repo, not only inside one TUI chat.
 * Active / recent / archived shelves; land + TTL keep it from growing forever.
 */

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'pathe';

import { resolveLioraHome } from '../../../config/path';
import { encodeWorkDirKey } from '../../../session/store/workdir-key';
import { CONDUCTOR_WORKTREE_FAIL_TTL_DAYS } from './job-runtime';
import type {
  JobKind,
  JobLandChoice,
  JobLandReceipt,
  JobRecord,
  JobStatus,
  JobSurfaceKind,
  JobTaskTrack,
} from './job-store-key';
import { slugifySessionName } from './job-store-key';

export const WORKSPACE_SESSION_CATALOG_VERSION = 1 as const;

export type WorkspaceSessionShelf = 'active' | 'recent' | 'archived';

export interface WorkspaceSessionEntry {
  readonly jobId: string;
  readonly title: string;
  readonly status: JobStatus;
  readonly kind: JobKind;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workDir: string;
  readonly sourceAgentDir?: string;
  readonly worktreePath?: string;
  readonly worktreeBranch?: string;
  readonly repoRoot?: string;
  readonly sessionName?: string;
  readonly sessionNamePinned?: boolean;
  readonly landChoice?: JobLandChoice;
  readonly portOffset?: number;
  readonly workerHomedir?: string;
  readonly workerResumeAgentId?: string;
  readonly landReceipt?: JobLandReceipt;
  readonly archivedAt?: string;
  readonly prompt?: string;
  readonly ownershipPaths?: readonly string[];
  readonly surfaceKind?: JobSurfaceKind;
  readonly successCriteria?: readonly string[];
  readonly taskTrack?: JobTaskTrack;
  readonly notes?: string;
}

export interface WorkspaceSessionCatalog {
  readonly version: typeof WORKSPACE_SESSION_CATALOG_VERSION;
  readonly workDir: string;
  readonly updatedAt: string;
  readonly entries: readonly WorkspaceSessionEntry[];
}

const ACTIVE_STATUSES = new Set<JobStatus>([
  'queued',
  'running',
  'blocked',
  'needs_user',
  'interrupted',
]);

export function workspaceSessionCatalogDir(
  workDir: string,
  homeDir: string = resolveLioraHome(),
): string {
  return join(homeDir, 'workspace-sessions', encodeWorkDirKey(workDir));
}

export function workspaceSessionCatalogPath(
  workDir: string,
  homeDir: string = resolveLioraHome(),
): string {
  return join(workspaceSessionCatalogDir(workDir, homeDir), 'catalog.json');
}

export function workspaceSessionTtlMs(
  failTtlDays: number = CONDUCTOR_WORKTREE_FAIL_TTL_DAYS,
): number {
  return Math.max(1, failTtlDays) * 24 * 60 * 60 * 1000;
}

export function classifyWorkspaceShelf(
  entry: Pick<
    WorkspaceSessionEntry,
    | 'status'
    | 'landReceipt'
    | 'archivedAt'
    | 'worktreePath'
    | 'updatedAt'
    | 'landChoice'
    | 'sessionNamePinned'
  >,
  nowMs: number = Date.now(),
  ttlMs: number = workspaceSessionTtlMs(),
): WorkspaceSessionShelf {
  if (entry.archivedAt !== undefined && entry.archivedAt.trim().length > 0) {
    return 'archived';
  }
  if (entry.landReceipt !== undefined) return 'archived';
  if (ACTIVE_STATUSES.has(entry.status)) return 'active';
  const tree = entry.worktreePath?.trim();
  const keepOpen =
    entry.landChoice === 'keep' ||
    entry.landChoice === 'pending' ||
    entry.sessionNamePinned === true;
  if (keepOpen && tree !== undefined && tree.length > 0) return 'recent';
  const updated = Date.parse(entry.updatedAt);
  const stale = Number.isFinite(updated) && nowMs - updated > ttlMs;
  if (stale) return 'archived';
  if (tree === undefined || tree.length === 0) return 'archived';
  return 'recent';
}

export function jobRecordToWorkspaceEntry(
  job: JobRecord,
  input: {
    readonly workDir: string;
    readonly sourceAgentDir?: string;
    readonly archivedAt?: string;
  },
): WorkspaceSessionEntry {
  return {
    jobId: job.id,
    title: job.title,
    status: job.status,
    kind: job.kind,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    workDir: input.workDir,
    sourceAgentDir: input.sourceAgentDir,
    worktreePath: job.worktreePath,
    worktreeBranch: job.worktreeBranch,
    repoRoot: job.repoRoot,
    sessionName: job.sessionName,
    sessionNamePinned: job.sessionNamePinned,
    landChoice: job.landChoice,
    portOffset: job.portOffset,
    workerHomedir: job.workerHomedir,
    workerResumeAgentId: job.workerResumeAgentId,
    landReceipt: job.landReceipt,
    archivedAt: input.archivedAt,
    prompt: job.prompt,
    ownershipPaths: job.ownershipPaths,
    surfaceKind: job.surfaceKind,
    successCriteria: job.successCriteria,
    taskTrack: job.taskTrack,
    notes: job.notes,
  };
}

export function emptyWorkspaceCatalog(workDir: string): WorkspaceSessionCatalog {
  return {
    version: WORKSPACE_SESSION_CATALOG_VERSION,
    workDir,
    updatedAt: new Date(0).toISOString(),
    entries: [],
  };
}

export function readWorkspaceCatalog(
  workDir: string,
  homeDir: string = resolveLioraHome(),
): WorkspaceSessionCatalog {
  const path = workspaceSessionCatalogPath(workDir, homeDir);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as WorkspaceSessionCatalog;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      parsed.version !== WORKSPACE_SESSION_CATALOG_VERSION ||
      !Array.isArray(parsed.entries)
    ) {
      return emptyWorkspaceCatalog(workDir);
    }
    return parsed;
  } catch {
    return emptyWorkspaceCatalog(workDir);
  }
}

export function writeWorkspaceCatalog(
  catalog: WorkspaceSessionCatalog,
  homeDir: string = resolveLioraHome(),
): void {
  const path = workspaceSessionCatalogPath(catalog.workDir, homeDir);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  try {
    renameSync(tmp, path);
  } catch {
    try {
      unlinkSync(path);
    } catch {
      // replace
    }
    renameSync(tmp, path);
  }
}

export function upsertWorkspaceCatalogJobs(input: {
  readonly workDir: string;
  readonly jobs: readonly JobRecord[];
  readonly sourceAgentDir?: string;
  readonly homeDir?: string;
  readonly now?: Date;
}): WorkspaceSessionCatalog {
  const homeDir = input.homeDir ?? resolveLioraHome();
  const now = (input.now ?? new Date()).toISOString();
  const current = readWorkspaceCatalog(input.workDir, homeDir);
  const byId = new Map(current.entries.map((entry) => [entry.jobId, entry]));
  for (const job of input.jobs) {
    const prev = byId.get(job.id);
    byId.set(
      job.id,
      jobRecordToWorkspaceEntry(job, {
        workDir: input.workDir,
        sourceAgentDir: input.sourceAgentDir ?? prev?.sourceAgentDir,
        archivedAt: prev?.archivedAt,
      }),
    );
  }
  const next: WorkspaceSessionCatalog = {
    version: WORKSPACE_SESSION_CATALOG_VERSION,
    workDir: input.workDir,
    updatedAt: now,
    entries: [...byId.values()].toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
  writeWorkspaceCatalog(next, homeDir);
  return next;
}

export function archiveWorkspaceSession(input: {
  readonly workDir: string;
  readonly jobId: string;
  readonly homeDir?: string;
  readonly now?: Date;
}): WorkspaceSessionEntry | undefined {
  const homeDir = input.homeDir ?? resolveLioraHome();
  const catalog = readWorkspaceCatalog(input.workDir, homeDir);
  const at = (input.now ?? new Date()).toISOString();
  let found: WorkspaceSessionEntry | undefined;
  const entries = catalog.entries.map((entry) => {
    if (entry.jobId !== input.jobId) return entry;
    found = { ...entry, archivedAt: at, updatedAt: at };
    return found;
  });
  if (found === undefined) return undefined;
  writeWorkspaceCatalog(
    { ...catalog, updatedAt: at, entries },
    homeDir,
  );
  return found;
}

export function listWorkspaceSessions(input: {
  readonly workDir: string;
  readonly homeDir?: string;
  readonly shelf?: WorkspaceSessionShelf;
  readonly nowMs?: number;
  readonly ttlMs?: number;
}): readonly (WorkspaceSessionEntry & { readonly shelf: WorkspaceSessionShelf })[] {
  const homeDir = input.homeDir ?? resolveLioraHome();
  const catalog = readWorkspaceCatalog(input.workDir, homeDir);
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? workspaceSessionTtlMs();
  const rows = catalog.entries.map((entry) => ({
    ...entry,
    shelf: classifyWorkspaceShelf(entry, nowMs, ttlMs),
  }));
  if (input.shelf === undefined) return rows;
  return rows.filter((row) => row.shelf === input.shelf);
}

/** Rebuild a ledger row so another TUI chat can continue the same job id. */
export function workspaceEntryToJobRecord(entry: WorkspaceSessionEntry): JobRecord {
  const runningElsewhere = entry.status === 'running' || entry.status === 'needs_user';
  return {
    id: entry.jobId,
    title: entry.title,
    status: runningElsewhere ? 'interrupted' : entry.status,
    kind: entry.kind,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    prompt: entry.prompt,
    ownershipPaths: entry.ownershipPaths,
    surfaceKind: entry.surfaceKind,
    successCriteria: entry.successCriteria,
    taskTrack: entry.taskTrack,
    notes: [
      entry.notes,
      runningElsewhere
        ? 'workspace-catalog: adopted from another chat as interrupted (avoid double-spawn)'
        : `workspace-catalog: adopted from ${entry.sourceAgentDir ?? 'workspace'}`,
    ]
      .filter(Boolean)
      .join('\n'),
    worktreePath: entry.worktreePath,
    worktreeBranch: entry.worktreeBranch,
    repoRoot: entry.repoRoot,
    sessionName: entry.sessionName,
    sessionNamePinned: entry.sessionNamePinned,
    landChoice: entry.landChoice,
    portOffset: entry.portOffset,
    workerHomedir: entry.workerHomedir,
    workerResumeAgentId: entry.workerResumeAgentId,
    landReceipt: entry.landReceipt,
    priority: 0,
  };
}

/** Match a catalog row by job id or session name (exact, then slug). */
export function findWorkspaceSession(
  workDir: string,
  idOrName: string,
  homeDir?: string,
): WorkspaceSessionEntry | undefined {
  const needle = idOrName.trim();
  if (needle.length === 0) return undefined;
  const rows = listWorkspaceSessions({ workDir, homeDir });
  const byId = rows.find((row) => row.jobId === needle);
  if (byId !== undefined) return byId;
  const lower = needle.toLowerCase();
  const byName = rows.find((row) => (row.sessionName ?? '').toLowerCase() === lower);
  if (byName !== undefined) return byName;
  const slug = slugifySessionName(needle);
  return rows.find((row) => slugifySessionName(row.sessionName ?? row.title) === slug);
}

export function allocateUniqueSessionName(
  workDir: string,
  desired: string,
  opts: { readonly homeDir?: string; readonly excludeJobId?: string } = {},
): string {
  const base = slugifySessionName(desired);
  const taken = new Set(
    listWorkspaceSessions({ workDir, homeDir: opts.homeDir })
      .filter((row) => row.jobId !== opts.excludeJobId)
      .map((row) => (row.sessionName ?? '').toLowerCase())
      .filter((name) => name.length > 0),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}
