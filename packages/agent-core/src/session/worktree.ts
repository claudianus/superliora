import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'pathe';
import { LocalKaos, type Kaos } from '@superliora/kaos';

import { createWorktree, removeWorktree, runGit } from '#/autopilot/git';
import { resolveLioraHome } from '#/config/path';
import { ErrorCodes, LioraError } from '#/errors/index';
import { slugifyWorkDirName } from '#/utils/workdir-slug';
import { ensureGitRepoForWorktrees } from './git-bootstrap';

export const SESSION_WORKTREE_CUSTOM_KEY = 'worktree' as const;

export interface SessionWorktreeMeta {
  readonly path: string;
  readonly branch: string;
  readonly repoRoot: string;
  readonly name: string;
  readonly baseRef: string;
  readonly createdAt: string;
}

export interface WorktreeRecord {
  readonly name: string;
  readonly path: string;
  readonly repoRoot: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly createdAt: string;
  lastAccessedAt: string;
  sessionId?: string;
}

export interface CreateSessionWorktreeInput {
  /** Absolute path of the source checkout (any path inside the git repo). */
  readonly repoPath: string;
  /** Optional human name; auto-generated when omitted. */
  readonly name?: string | undefined;
  /** Base ref for the new branch (default HEAD). */
  readonly baseRef?: string | undefined;
  /** SuperLiora home override (default resolveLioraHome()). */
  readonly homeDir?: string | undefined;
  /** Optional session id to stamp on the registry entry. */
  readonly sessionId?: string | undefined;
  /**
   * Auto-bootstrap a git repository when `repoPath` is not inside one (or
   * the repo has no commits yet): local `git init` + baseline commit so
   * `git worktree add` can run. Default true; opt out per process via
   * `SUPERLIORA_AUTO_GIT_INIT=0` (legacy `SUPERLIORA_CONDUCTOR_AUTO_GIT_INIT`).
   */
  readonly bootstrapRepo?: boolean | undefined;
  /** Env used for the bootstrap opt-out check (default process.env). */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

export interface CreateSessionWorktreeResult {
  readonly workDir: string;
  readonly meta: SessionWorktreeMeta;
  readonly record: WorktreeRecord;
}

export interface ListWorktreesOptions {
  readonly homeDir?: string | undefined;
  /** When set, only entries for this repo root. */
  readonly repoRoot?: string | undefined;
}

export interface RemoveWorktreeOptions {
  readonly homeDir?: string | undefined;
  /** Prefer matching by name within repoRoot when provided. */
  readonly repoRoot?: string | undefined;
  readonly nameOrPath: string;
}

export interface GcWorktreesOptions {
  readonly homeDir?: string | undefined;
  /** Drop entries older than this many days (default 14). */
  readonly maxAgeDays?: number | undefined;
  readonly dryRun?: boolean | undefined;
}

export interface HygieneWorktreesOptions {
  readonly homeDir?: string | undefined;
  /** Limit orphan-branch / stale-remote sweeps to this repo root. */
  readonly repoRoot?: string | undefined;
  /** Drop registry entries older than this many days (default 14). */
  readonly maxAgeDays?: number | undefined;
  readonly dryRun?: boolean | undefined;
  /**
   * Delete orphan local `liora/*` branches with no registry entry.
   * Merged tips are deleted; unmerged tips are archived then deleted when
   * {@link archive} is true (default). Default true.
   */
  readonly deleteOrphanBranches?: boolean | undefined;
  /**
   * Before deleting an unmerged orphan `liora/*` tip, create
   * `archive/tips/<slug>` annotated tag. Default true.
   */
  readonly archive?: boolean | undefined;
  /**
   * Delete remote heads whose tip is an ancestor of origin/main (or main).
   * Never deletes `main`. Default false.
   */
  readonly staleRemotes?: boolean | undefined;
}

export interface HygieneWorktreesResult {
  readonly removedWorktrees: readonly WorktreeRecord[];
  readonly keptWorktrees: number;
  readonly archivedTags: readonly string[];
  readonly deletedLocalBranches: readonly string[];
  readonly deletedRemoteBranches: readonly string[];
  readonly dryRun: boolean;
}

interface WorktreeRegistryFile {
  readonly version: 1;
  entries: WorktreeRecord[];
}

const REGISTRY_VERSION = 1 as const;
const DEFAULT_MAX_AGE_DAYS = 14;
const LIORA_BRANCH_PREFIX = 'liora/';
const ARCHIVE_TIPS_PREFIX = 'archive/tips/';

/** Compare paths allowing macOS /var vs /private/var divergence. */
function pathEquals(a: string, b: string): boolean {
  const ra = resolve(a);
  const rb = resolve(b);
  if (ra === rb) return true;
  const strip = (p: string) => (p.startsWith('/private/') ? p.slice('/private'.length) : p);
  return strip(ra) === strip(rb);
}


export function worktreesRoot(homeDir?: string): string {
  return join(resolveLioraHome(homeDir), 'worktrees');
}

export function worktreeRegistryPath(homeDir?: string): string {
  return join(worktreesRoot(homeDir), 'registry.json');
}

export function isSessionWorktreeMeta(value: unknown): value is SessionWorktreeMeta {
  if (value === null || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec['path'] === 'string' &&
    typeof rec['branch'] === 'string' &&
    typeof rec['repoRoot'] === 'string' &&
    typeof rec['name'] === 'string' &&
    typeof rec['baseRef'] === 'string' &&
    typeof rec['createdAt'] === 'string'
  );
}

export function sessionWorktreeFromCustom(
  custom: Record<string, unknown> | undefined,
): SessionWorktreeMeta | undefined {
  if (custom === undefined) return undefined;
  const raw = custom[SESSION_WORKTREE_CUSTOM_KEY];
  return isSessionWorktreeMeta(raw) ? raw : undefined;
}

export function buildWorktreeMetadata(meta: SessionWorktreeMeta): Record<string, unknown> {
  return { [SESSION_WORKTREE_CUSTOM_KEY]: meta };
}

export function generateWorktreeName(seed?: string): string {
  if (seed !== undefined && seed.trim().length > 0) {
    return normalizeWorktreeName(seed);
  }
  const stamp = new Date().toISOString().replaceAll(/[-:TZ.]/g, '').slice(0, 12);
  const suffix = randomBytes(2).toString('hex');
  return `wt-${stamp}-${suffix}`;
}

export function normalizeWorktreeName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new LioraError(ErrorCodes.WORKTREE_NAME_INVALID, 'Worktree name cannot be empty');
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new LioraError(
      ErrorCodes.WORKTREE_NAME_INVALID,
      `Worktree name must not contain path separators: ${trimmed}`,
    );
  }
  const slug = slugifyWorkDirName(trimmed);
  if (slug === 'workspace' && trimmed.toLowerCase() !== 'workspace') {
    throw new LioraError(
      ErrorCodes.WORKTREE_NAME_INVALID,
      `Worktree name is invalid after normalization: ${trimmed}`,
    );
  }
  return slug;
}

export async function resolveGitRepoRoot(kaos: Kaos, cwd: string): Promise<string> {
  const result = await runGit(kaos, cwd, ['rev-parse', '--show-toplevel']);
  if (!result.ok) {
    throw new LioraError(
      ErrorCodes.WORKTREE_NOT_A_GIT_REPO,
      `Not a git repository: ${cwd}`,
      { details: { cwd, stderr: result.stderr } },
    );
  }
  const root = result.stdout.trim();
  if (root.length === 0) {
    throw new LioraError(ErrorCodes.WORKTREE_NOT_A_GIT_REPO, `Not a git repository: ${cwd}`, {
      details: { cwd },
    });
  }
  return resolve(root);
}

export function repoSlugForRoot(repoRoot: string): string {
  const base = slugifyWorkDirName(basename(repoRoot));
  const hash = createHash('sha256').update(resolve(repoRoot)).digest('hex').slice(0, 8);
  return `${base}-${hash}`;
}

export function defaultWorktreePath(input: {
  readonly homeDir?: string | undefined;
  readonly repoRoot: string;
  readonly name: string;
}): string {
  return join(worktreesRoot(input.homeDir), repoSlugForRoot(input.repoRoot), input.name);
}

export async function createSessionWorktree(
  kaos: Kaos,
  input: CreateSessionWorktreeInput,
): Promise<CreateSessionWorktreeResult> {
  // Fresh/empty folders have no repo (or no commits), which used to hard-fail
  // every worktree entrypoint. Bootstrap first so `worktree add` always has
  // a repo root and a valid base ref; the result is memoized per path.
  let probePath = input.repoPath;
  if (input.bootstrapRepo !== false) {
    const repo = await ensureGitRepoForWorktrees(kaos, input.repoPath, input.env ?? process.env);
    if (!repo.ok) {
      throw new LioraError(ErrorCodes.WORKTREE_NOT_A_GIT_REPO, repo.error, {
        details: { cwd: input.repoPath },
      });
    }
    probePath = repo.root;
  }

  const repoRoot = await resolveGitRepoRoot(kaos, probePath);
  const name = generateWorktreeName(input.name);
  const baseRef = (input.baseRef?.trim() ?? 'HEAD').trim();
  const target = defaultWorktreePath({ homeDir: input.homeDir, repoRoot, name });
  const branch = `liora/${name}`;

  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });

  if (await pathExists(target)) {
    throw new LioraError(
      ErrorCodes.WORKTREE_ALREADY_EXISTS,
      `Worktree path already exists: ${target}`,
      { details: { path: target, name } },
    );
  }

  const created = await createWorktree(kaos, repoRoot, target, branch, baseRef);
  if (!created.ok) {
    throw new LioraError(
      ErrorCodes.WORKTREE_CREATE_FAILED,
      `Failed to create git worktree "${name}": ${created.stderr || created.stdout || 'unknown error'}`,
      {
        details: {
          name,
          path: target,
          repoRoot,
          branch,
          baseRef,
          stderr: created.stderr,
          exitCode: created.exitCode,
        },
      },
    );
  }

  const now = new Date().toISOString();
  const record: WorktreeRecord = {
    name,
    path: target,
    repoRoot,
    branch,
    baseRef,
    createdAt: now,
    lastAccessedAt: now,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
  };

  await upsertRegistryEntry(input.homeDir, record);

  const meta: SessionWorktreeMeta = {
    path: target,
    branch,
    repoRoot,
    name,
    baseRef,
    createdAt: now,
  };

  return { workDir: target, meta, record };
}

export async function listSessionWorktrees(
  options: ListWorktreesOptions = {},
): Promise<readonly WorktreeRecord[]> {
  const registry = await readRegistry(options.homeDir);
  const rootFilter = options.repoRoot;
  const entries = registry.entries.filter((entry) => {
    if (rootFilter === undefined) return true;
    return pathEquals(entry.repoRoot, rootFilter);
  });
  return entries.toSorted((a, b) => b.lastAccessedAt.localeCompare(a.lastAccessedAt));
}

export async function removeSessionWorktree(
  kaos: Kaos,
  options: RemoveWorktreeOptions,
): Promise<WorktreeRecord> {
  const registry = await readRegistry(options.homeDir);
  const match = findRegistryEntry(registry.entries, options);
  if (match === undefined) {
    throw new LioraError(
      ErrorCodes.WORKTREE_NOT_FOUND,
      `Worktree not found: ${options.nameOrPath}`,
      { details: { nameOrPath: options.nameOrPath, repoRoot: options.repoRoot } },
    );
  }

  try {
    await removeWorktree(kaos, match.repoRoot, match.path);
  } catch {
    // Fall through to force-remove directory even if git worktree remove fails
    // (e.g. already pruned).
  }

  await rm(match.path, { recursive: true, force: true }).catch(() => {});

  const next: WorktreeRegistryFile = {
    version: REGISTRY_VERSION,
    entries: registry.entries.filter((entry) => entry.path !== match.path),
  };
  await writeRegistry(options.homeDir, next);

  // Drop the matching liora/* branch when its tip is already in HEAD.
  if (match.branch.startsWith(LIORA_BRANCH_PREFIX)) {
    await maybeDeleteMergedLioraBranch(kaos, match.repoRoot, match.branch).catch(() => {});
  }

  return match;
}

export async function gcSessionWorktrees(
  kaos: Kaos,
  options: GcWorktreesOptions = {},
): Promise<{ readonly removed: readonly WorktreeRecord[]; readonly kept: number }> {
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const registry = await readRegistry(options.homeDir);
  const removed: WorktreeRecord[] = [];
  const kept: WorktreeRecord[] = [];

  for (const entry of registry.entries) {
    const age = Date.parse(entry.lastAccessedAt);
    const stale = Number.isFinite(age) ? age < cutoff : false;
    const missing = !(await pathExists(entry.path));
    if (!stale && !missing) {
      kept.push(entry);
      continue;
    }
    if (options.dryRun === true) {
      removed.push(entry);
      continue;
    }
    try {
      if (!missing) {
        await removeWorktree(kaos, entry.repoRoot, entry.path).catch(() => {});
        await rm(entry.path, { recursive: true, force: true }).catch(() => {});
      }
      removed.push(entry);
    } catch {
      kept.push(entry);
    }
  }

  if (options.dryRun !== true) {
    await writeRegistry(options.homeDir, { version: REGISTRY_VERSION, entries: kept });
    await pruneEmptyWorktreeDirs(options.homeDir);
  }

  return { removed, kept: kept.length };
}

export async function touchWorktreeAccess(
  homeDir: string | undefined,
  pathOrName: string,
): Promise<void> {
  const registry = await readRegistry(homeDir);
  const now = new Date().toISOString();
  const key = resolve(pathOrName);
  let changed = false;
  const entries = registry.entries.map((entry) => {
    if (
      entry.path === pathOrName ||
      entry.name === pathOrName ||
      pathEquals(entry.path, key)
    ) {
      changed = true;
      return { ...entry, lastAccessedAt: now };
    }
    return entry;
  });
  if (changed) {
    await writeRegistry(homeDir, { version: REGISTRY_VERSION, entries });
  }
}

/**
 * Reconcile registry ↔ git worktrees, age-GC, orphan `liora/*` branches
 * (archive-then-delete for unmerged tips), and optional stale remotes.
 */
export async function hygieneSessionWorktrees(
  kaos: Kaos,
  options: HygieneWorktreesOptions = {},
): Promise<HygieneWorktreesResult> {
  const dryRun = options.dryRun === true;
  const archive = options.archive !== false;
  const deleteOrphanBranches = options.deleteOrphanBranches !== false;
  const archivedTags: string[] = [];
  const deletedLocalBranches: string[] = [];
  const deletedRemoteBranches: string[] = [];

  const registry = await readRegistry(options.homeDir);
  const repoRoots = collectRepoRoots(registry.entries, options.repoRoot);

  for (const repoRoot of repoRoots) {
    await runGit(kaos, repoRoot, ['worktree', 'prune']).catch(() => {});
  }

  // Drop registry rows whose path vanished (reconcile), then age-GC the rest.
  if (!dryRun) {
    const stillPresent: WorktreeRecord[] = [];
    for (const entry of registry.entries) {
      if (await pathExists(entry.path)) {
        stillPresent.push(entry);
      }
    }
    if (stillPresent.length !== registry.entries.length) {
      await writeRegistry(options.homeDir, {
        version: REGISTRY_VERSION,
        entries: stillPresent,
      });
    }
  }

  const gc = await gcSessionWorktrees(kaos, {
    homeDir: options.homeDir,
    maxAgeDays: options.maxAgeDays,
    dryRun,
  });

  if (deleteOrphanBranches) {
    const liveRegistry = dryRun
      ? registry
      : await readRegistry(options.homeDir);
    const registeredBranches = new Set(
      liveRegistry.entries.map((entry) => entry.branch),
    );
    // Also treat GC dry-run targets as still registered so we do not
    // double-count their branches as orphans in the same dry-run pass.
    if (dryRun) {
      for (const entry of gc.removed) {
        registeredBranches.add(entry.branch);
      }
    }

    for (const repoRoot of repoRoots) {
      const result = await sweepOrphanLioraBranches(kaos, {
        repoRoot,
        registeredBranches,
        archive,
        dryRun,
      });
      archivedTags.push(...result.archivedTags);
      deletedLocalBranches.push(...result.deletedLocalBranches);
    }
  }

  if (options.staleRemotes === true) {
    for (const repoRoot of repoRoots) {
      const remotes = await sweepStaleRemoteBranches(kaos, {
        repoRoot,
        dryRun,
      });
      deletedRemoteBranches.push(...remotes);
    }
  }

  return {
    removedWorktrees: gc.removed,
    keptWorktrees: gc.kept,
    archivedTags,
    deletedLocalBranches,
    deletedRemoteBranches,
    dryRun,
  };
}

async function upsertRegistryEntry(
  homeDir: string | undefined,
  record: WorktreeRecord,
): Promise<void> {
  const registry = await readRegistry(homeDir);
  const entries = registry.entries.filter(
    (entry) => entry.path !== record.path && !(entry.repoRoot === record.repoRoot && entry.name === record.name),
  );
  entries.push(record);
  await writeRegistry(homeDir, { version: REGISTRY_VERSION, entries });
}

function findRegistryEntry(
  entries: readonly WorktreeRecord[],
  options: RemoveWorktreeOptions,
): WorktreeRecord | undefined {
  const key = options.nameOrPath.trim();
  const resolvedKey = resolve(key);
  const repoRoot =
    options.repoRoot === undefined ? undefined : resolve(options.repoRoot);

  const byPath = entries.find((entry) => pathEquals(entry.path, key) || pathEquals(entry.path, resolvedKey));
  if (byPath !== undefined) return byPath;

  const byName = entries.filter((entry) => entry.name === key);
  if (repoRoot !== undefined) {
    return byName.find((entry) => pathEquals(entry.repoRoot, repoRoot));
  }
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new LioraError(
      ErrorCodes.WORKTREE_NAME_AMBIGUOUS,
      `Multiple worktrees named "${key}"; pass a path or --repo filter`,
      { details: { name: key, paths: byName.map((e) => e.path) } },
    );
  }
  return undefined;
}

async function readRegistry(homeDir?: string): Promise<WorktreeRegistryFile> {
  const path = worktreeRegistryPath(homeDir);
  try {
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as WorktreeRegistryFile;
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      return { version: REGISTRY_VERSION, entries: [] };
    }
    return {
      version: REGISTRY_VERSION,
      entries: parsed.entries.filter(isWorktreeRecord),
    };
  } catch {
    return { version: REGISTRY_VERSION, entries: [] };
  }
}

async function writeRegistry(
  homeDir: string | undefined,
  registry: WorktreeRegistryFile,
): Promise<void> {
  const path = worktreeRegistryPath(homeDir);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
}

function isWorktreeRecord(value: unknown): value is WorktreeRecord {
  if (value === null || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec['name'] === 'string' &&
    typeof rec['path'] === 'string' &&
    typeof rec['repoRoot'] === 'string' &&
    typeof rec['branch'] === 'string' &&
    typeof rec['baseRef'] === 'string' &&
    typeof rec['createdAt'] === 'string' &&
    typeof rec['lastAccessedAt'] === 'string'
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function pruneEmptyWorktreeDirs(homeDir?: string): Promise<void> {
  const root = worktreesRoot(homeDir);
  try {
    const repos = await readdir(root, { withFileTypes: true });
    for (const entry of repos) {
      if (!entry.isDirectory() || entry.name === '.' || entry.name.startsWith('.')) continue;
      if (entry.name === 'registry.json') continue;
      const repoDir = join(root, entry.name);
      const children = await readdir(repoDir).catch(() => [] as string[]);
      if (children.length === 0) {
        await rm(repoDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {
    // ignore
  }
}


/** Create a worktree using a local Kaos (CLI / non-session entrypoints). */
export async function createSessionWorktreeAuto(
  input: CreateSessionWorktreeInput,
): Promise<CreateSessionWorktreeResult> {
  const kaos = await LocalKaos.create();
  return createSessionWorktree(kaos, input);
}

export async function removeSessionWorktreeAuto(
  options: RemoveWorktreeOptions,
): Promise<WorktreeRecord> {
  const kaos = await LocalKaos.create();
  return removeSessionWorktree(kaos, options);
}

export async function gcSessionWorktreesAuto(
  options: GcWorktreesOptions = {},
): Promise<{ readonly removed: readonly WorktreeRecord[]; readonly kept: number }> {
  const kaos = await LocalKaos.create();
  return gcSessionWorktrees(kaos, options);
}

export async function hygieneSessionWorktreesAuto(
  options: HygieneWorktreesOptions = {},
): Promise<HygieneWorktreesResult> {
  const kaos = await LocalKaos.create();
  return hygieneSessionWorktrees(kaos, options);
}

export async function resolveGitRepoRootAuto(cwd: string): Promise<string> {
  const kaos = await LocalKaos.create();
  return resolveGitRepoRoot(kaos, cwd);
}

function collectRepoRoots(
  entries: readonly WorktreeRecord[],
  repoRoot: string | undefined,
): string[] {
  if (repoRoot !== undefined) {
    return [resolve(repoRoot)];
  }
  const roots = new Set<string>();
  for (const entry of entries) {
    roots.add(resolve(entry.repoRoot));
  }
  return [...roots];
}

async function resolveMergeBaseRef(kaos: Kaos, repoRoot: string): Promise<string> {
  for (const candidate of ['origin/main', 'main', 'master', 'HEAD'] as const) {
    const verified = await runGit(kaos, repoRoot, ['rev-parse', '--verify', candidate]);
    if (verified.ok) return candidate;
  }
  return 'HEAD';
}

async function isAncestorOf(
  kaos: Kaos,
  repoRoot: string,
  tip: string,
  baseRef: string,
): Promise<boolean> {
  const result = await runGit(kaos, repoRoot, ['merge-base', '--is-ancestor', tip, baseRef]);
  return result.ok;
}

async function listLocalLioraBranches(
  kaos: Kaos,
  repoRoot: string,
): Promise<readonly string[]> {
  const result = await runGit(kaos, repoRoot, [
    'for-each-ref',
    '--format=%(refname:short)',
    `refs/heads/${LIORA_BRANCH_PREFIX}`,
  ]);
  if (!result.ok) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(LIORA_BRANCH_PREFIX));
}

function archiveTagForBranch(branch: string): string {
  const slug = branch.replaceAll('/', '-');
  return `${ARCHIVE_TIPS_PREFIX}${slug}`;
}

async function maybeDeleteMergedLioraBranch(
  kaos: Kaos,
  repoRoot: string,
  branch: string,
): Promise<boolean> {
  const baseRef = await resolveMergeBaseRef(kaos, repoRoot);
  const merged = await isAncestorOf(kaos, repoRoot, branch, baseRef);
  if (!merged) return false;
  const del = await runGit(kaos, repoRoot, ['branch', '-D', branch]);
  return del.ok;
}

async function sweepOrphanLioraBranches(
  kaos: Kaos,
  input: {
    readonly repoRoot: string;
    readonly registeredBranches: ReadonlySet<string>;
    readonly archive: boolean;
    readonly dryRun: boolean;
  },
): Promise<{ readonly archivedTags: string[]; readonly deletedLocalBranches: string[] }> {
  const archivedTags: string[] = [];
  const deletedLocalBranches: string[] = [];
  const baseRef = await resolveMergeBaseRef(kaos, input.repoRoot);
  const branches = await listLocalLioraBranches(kaos, input.repoRoot);

  for (const branch of branches) {
    if (input.registeredBranches.has(branch)) continue;

    const merged = await isAncestorOf(kaos, input.repoRoot, branch, baseRef);
    if (!merged && !input.archive) {
      // Unique tip and archive disabled — leave alone.
      continue;
    }

    if (!merged && input.archive) {
      const tag = archiveTagForBranch(branch);
      if (input.dryRun) {
        archivedTags.push(tag);
        deletedLocalBranches.push(branch);
        continue;
      }
      const existing = await runGit(kaos, input.repoRoot, ['rev-parse', '--verify', `refs/tags/${tag}`]);
      if (!existing.ok) {
        const tagged = await runGit(kaos, input.repoRoot, [
          'tag',
          '-a',
          tag,
          branch,
          '-m',
          `hygiene archive: ${branch}`,
        ]);
        if (!tagged.ok) continue;
      }
      archivedTags.push(tag);
    }

    if (input.dryRun) {
      deletedLocalBranches.push(branch);
      continue;
    }

    const del = await runGit(kaos, input.repoRoot, ['branch', '-D', branch]);
    if (del.ok) {
      deletedLocalBranches.push(branch);
    }
  }

  return { archivedTags, deletedLocalBranches };
}

async function sweepStaleRemoteBranches(
  kaos: Kaos,
  input: { readonly repoRoot: string; readonly dryRun: boolean },
): Promise<string[]> {
  const deleted: string[] = [];
  const baseRef = await resolveMergeBaseRef(kaos, input.repoRoot);
  const listed = await runGit(kaos, input.repoRoot, ['ls-remote', '--heads', 'origin']);
  if (!listed.ok) return deleted;

  const names: string[] = [];
  for (const line of listed.stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split(/\s+/);
    const ref = parts[1];
    if (ref === undefined || !ref.startsWith('refs/heads/')) continue;
    const name = ref.slice('refs/heads/'.length);
    if (name === 'main' || name === 'master') continue;
    names.push(name);
  }

  for (const name of names) {
    const tipRef = `refs/remotes/origin/${name}`;
    // Prefer fetched remote-tracking ref; fall back to ls-remote sha via fetch --dry-run skip
    let tip = tipRef;
    const hasTracking = await runGit(kaos, input.repoRoot, ['rev-parse', '--verify', tipRef]);
    if (!hasTracking.ok) {
      // Use origin/<name> after a lightweight fetch of that one ref tip from ls-remote line
      const shaLine = listed.stdout
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.endsWith(`\trefs/heads/${name}`) || l.endsWith(` refs/heads/${name}`));
      if (shaLine === undefined) continue;
      tip = shaLine.split(/\s+/)[0] ?? '';
      if (tip.length === 0) continue;
    }

    const merged = await isAncestorOf(kaos, input.repoRoot, tip, baseRef);
    if (!merged) continue;

    if (input.dryRun) {
      deleted.push(name);
      continue;
    }
    const push = await runGit(kaos, input.repoRoot, ['push', 'origin', '--delete', name]);
    if (push.ok) deleted.push(name);
  }

  return deleted;
}
