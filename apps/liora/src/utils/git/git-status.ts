/**
 * Cached git branch + working-tree status for the footer/statusline.
 *
 * Reads never run on the render path: `getStatus()` returns the last-known
 * snapshot synchronously and kicks an async (`execFile`) refresh when a TTL
 * lapses, firing `onChange` only when the data actually changed. A synchronous
 * `git status` inside a footer render froze the event loop every 5–15s —
 * hundreds of ms on large repos, far past the 8ms frame budget.
 * Pull-request lookup was already async and keeps its own cache.
 */

import { execFile, spawnSync } from 'node:child_process';

const BRANCH_TTL_MS = 5_000;
const STATUS_TTL_MS = 15_000;
const PULL_REQUEST_TTL_MS = 60_000;
const SPAWN_TIMEOUT_MS = 500;
const PR_SPAWN_TIMEOUT_MS = 5_000;

export const GIT_CHANGED_FILES_PREVIEW_MAX = 3;

export interface GitStatus {
  readonly branch: string;
  readonly dirty: boolean;
  readonly ahead: number;
  readonly behind: number;
  readonly diffAdded: number;
  readonly diffDeleted: number;
  /** Full porcelain changed-file count (not capped). */
  readonly changedFileCount: number;
  /** Up to {@link GIT_CHANGED_FILES_PREVIEW_MAX} compact porcelain previews, e.g. `M src/foo.ts`. */
  readonly changedFiles: readonly string[];
  readonly pullRequest: PullRequestInfo | null;
}

export interface PullRequestInfo {
  readonly number: number;
  readonly url: string;
}

export interface GitStatusCache {
  /** Returns the last-known status, or `null` when unknown / not a git repo. */
  getStatus(): GitStatus | null;
  /** Stops in-flight refreshes from firing `onChange` after teardown. Idempotent. */
  dispose(): void;
}

export interface GitStatusCacheOptions {
  readonly onChange?: () => void;
}

interface BranchState {
  value: string | null;
  fetchedAt: number;
}

interface StatusState {
  dirty: boolean;
  ahead: number;
  behind: number;
  diffAdded: number;
  diffDeleted: number;
  changedFileCount: number;
  changedFiles: readonly string[];
  fetchedAt: number;
}

interface PullRequestState {
  value: PullRequestInfo | null;
  branch: string | null;
  fetchedAt: number;
  pendingBranch: string | null;
  requestId: number;
}

const AHEAD_BEHIND_RE = /\[(?:ahead (\d+))?(?:, )?(?:behind (\d+))?\]/;

const EMPTY_STATUS: Omit<StatusState, 'fetchedAt'> = {
  dirty: false,
  ahead: 0,
  behind: 0,
  diffAdded: 0,
  diffDeleted: 0,
  changedFileCount: 0,
  changedFiles: [],
};

export function createGitStatusCache(
  workDir: string,
  options: GitStatusCacheOptions = {},
): GitStatusCache {
  let disposed = false;
  const isRepo = detectGitRepo(workDir);
  const canLookupPr = isRepo && hasGitRemote(workDir);
  let branch: BranchState = { value: null, fetchedAt: 0 };
  let status: StatusState = { ...EMPTY_STATUS, fetchedAt: 0 };
  let branchRefreshInFlight = false;
  let statusRefreshInFlight = false;
  let pullRequest: PullRequestState = {
    value: null,
    branch: null,
    fetchedAt: 0,
    pendingBranch: null,
    requestId: 0,
  };

  return {
    getStatus: () => {
      if (!isRepo || disposed) return null;

      const now = Date.now();
      if (!branchRefreshInFlight && now - branch.fetchedAt >= BRANCH_TTL_MS) {
        branchRefreshInFlight = true;
        void readBranch(workDir).then((value) => {
          branchRefreshInFlight = false;
          if (disposed) return;
          const changed = value !== branch.value;
          branch = { value, fetchedAt: Date.now() };
          if (changed) options.onChange?.();
        });
      }
      if (branch.value === null) return null;

      if (!statusRefreshInFlight && now - status.fetchedAt >= STATUS_TTL_MS) {
        statusRefreshInFlight = true;
        void readStatus(workDir).then((next) => {
          statusRefreshInFlight = false;
          if (disposed) return;
          const changed = !sameStatus(status, next);
          status = { ...next, fetchedAt: Date.now() };
          if (changed) options.onChange?.();
        });
      }
      refreshPullRequestIfNeeded(branch.value, now);

      return {
        branch: branch.value,
        dirty: status.dirty,
        ahead: status.ahead,
        behind: status.behind,
        diffAdded: status.diffAdded,
        diffDeleted: status.diffDeleted,
        changedFileCount: status.changedFileCount,
        changedFiles: status.changedFiles,
        pullRequest: pullRequest.branch === branch.value ? pullRequest.value : null,
      };
    },
    dispose: () => {
      disposed = true;
    },
  };

  function refreshPullRequestIfNeeded(branchName: string, now: number): void {
    if (!canLookupPr) return;
    if (pullRequest.pendingBranch === branchName) return;
    const fetchedAt = pullRequest.branch === branchName ? pullRequest.fetchedAt : 0;
    if (now - fetchedAt < PULL_REQUEST_TTL_MS) return;

    const requestId = pullRequest.requestId + 1;
    pullRequest = {
      value: pullRequest.branch === branchName ? pullRequest.value : null,
      branch: branchName,
      fetchedAt,
      pendingBranch: branchName,
      requestId,
    };

    void readPullRequest(workDir).then((value) => {
      if (disposed || pullRequest.requestId !== requestId) return;

      const previous = pullRequest.branch === branchName ? pullRequest.value : null;
      const changed = !samePullRequest(previous, value);
      pullRequest = {
        value,
        branch: branchName,
        fetchedAt: Date.now(),
        pendingBranch: null,
        requestId,
      };
      if (changed) options.onChange?.();
    });
  }
}

function sameStatus(a: StatusState, b: Omit<StatusState, 'fetchedAt'>): boolean {
  return (
    a.dirty === b.dirty &&
    a.ahead === b.ahead &&
    a.behind === b.behind &&
    a.diffAdded === b.diffAdded &&
    a.diffDeleted === b.diffDeleted &&
    a.changedFileCount === b.changedFileCount &&
    a.changedFiles.length === b.changedFiles.length &&
    a.changedFiles.every((file, index) => file === b.changedFiles[index])
  );
}

/**
 * One-time construction probes (repo detection, remote presence). These are
 * the only synchronous spawns in this module and they run once at cache
 * creation (startup), never per frame or per TTL refresh.
 */
function detectGitRepo(workDir: string): boolean {
  try {
    const result = spawnSync('git', ['-C', workDir, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
    });
    return result.status === 0 && result.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

function hasGitRemote(workDir: string): boolean {
  try {
    const result = spawnSync('git', ['-C', workDir, 'remote'], {
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
    });
    return result.status === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function readBranch(workDir: string): Promise<string | null> {
  const out = await execFileText('git', ['-C', workDir, 'branch', '--show-current']);
  if (out === null) return null;
  const name = out.trim();
  return name.length > 0 ? name : null;
}

interface StatusResult {
  dirty: boolean;
  ahead: number;
  behind: number;
  diffAdded: number;
  diffDeleted: number;
  changedFileCount: number;
  changedFiles: readonly string[];
}

async function readStatus(workDir: string): Promise<StatusResult> {
  const stdout = await execFileText(
    'git',
    ['-C', workDir, 'status', '--porcelain', '-b'],
    4 * 1024 * 1024,
  );
  if (stdout === null) return { ...EMPTY_STATUS };

  let dirty = false;
  let ahead = 0;
  let behind = 0;
  let changedFileCount = 0;
  const changedFiles: string[] = [];
  for (const line of stdout.split('\n')) {
    if (line.startsWith('## ')) {
      const m = AHEAD_BEHIND_RE.exec(line);
      if (m) {
        ahead = Number.parseInt(m[1] ?? '0', 10) || 0;
        behind = Number.parseInt(m[2] ?? '0', 10) || 0;
      }
    } else if (line.trim().length > 0) {
      dirty = true;
      changedFileCount += 1;
      const preview = formatPorcelainChangedFile(line);
      if (preview != null && changedFiles.length < GIT_CHANGED_FILES_PREVIEW_MAX) {
        changedFiles.push(preview);
      }
    }
  }
  const diff = dirty ? await readDiffStats(workDir) : { added: 0, deleted: 0 };
  return {
    dirty,
    ahead,
    behind,
    diffAdded: diff.added,
    diffDeleted: diff.deleted,
    changedFileCount,
    changedFiles,
  };
}

/** Compact porcelain preview: `M path`, `~ path` (untracked), `D path`, … */
export function formatPorcelainChangedFile(line: string): string | null {
  if (line.startsWith('## ') || line.trim().length === 0) return null;
  const match = /^(.)(.)\s+(.+)$/.exec(line);
  if (match == null) return null;

  const indexStatus = match[1] ?? ' ';
  const workTreeStatus = match[2] ?? ' ';
  let path = match[3] ?? '';
  const renameArrow = path.indexOf(' -> ');
  if (renameArrow >= 0) {
    path = path.slice(renameArrow + 4);
  }

  if (indexStatus === '?' && workTreeStatus === '?') {
    return `~ ${path}`;
  }

  const code =
    indexStatus !== ' ' && indexStatus !== '?'
      ? indexStatus
      : workTreeStatus !== ' ' && workTreeStatus !== '?'
        ? workTreeStatus
        : 'M';
  if (code === 'M' || code === 'A' || code === 'D' || code === 'R' || code === 'U') {
    return `${code} ${path}`;
  }
  return `M ${path}`;
}

async function readDiffStats(workDir: string): Promise<{ added: number; deleted: number }> {
  const stdout = await execFileText(
    'git',
    ['-C', workDir, 'diff', '--numstat', 'HEAD', '--'],
    4 * 1024 * 1024,
  );
  if (stdout === null) return { added: 0, deleted: 0 };

  let added = 0;
  let deleted = 0;
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    const [addedText, deletedText] = line.split('\t');
    added += parseDiffNumstatCount(addedText);
    deleted += parseDiffNumstatCount(deletedText);
  }
  return { added, deleted };
}

function parseDiffNumstatCount(value: string | undefined): number {
  if (value === undefined || value === '-') return 0;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function execFileText(
  command: string,
  args: readonly string[],
  maxBuffer = 256 * 1024,
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        command,
        [...args],
        {
          encoding: 'utf8',
          timeout: SPAWN_TIMEOUT_MS,
          maxBuffer,
        },
        (error, stdout) => {
          resolve(error === null && typeof stdout === 'string' ? stdout : null);
        },
      );
    } catch {
      resolve(null);
    }
  });
}

function readPullRequest(workDir: string): Promise<PullRequestInfo | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        'gh',
        ['pr', 'view', '--json', 'number,url'],
        {
          cwd: workDir,
          encoding: 'utf8',
          env: {
            ...process.env,
            GH_NO_UPDATE_NOTIFIER: '1',
            GH_PROMPT_DISABLED: '1',
          },
          timeout: PR_SPAWN_TIMEOUT_MS,
          maxBuffer: 256 * 1024,
        },
        (error, stdout) => {
          if (error !== null) {
            resolve(null);
            return;
          }
          resolve(parsePullRequest(stdout));
        },
      );
    } catch {
      resolve(null);
    }
  });
}

function samePullRequest(a: PullRequestInfo | null, b: PullRequestInfo | null): boolean {
  if (a === null || b === null) return a === b;
  return a.number === b.number && a.url === b.url;
}

function parsePullRequest(stdout: string): PullRequestInfo | null {
  try {
    const raw = JSON.parse(stdout) as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const number = record['number'];
    const url = record['url'];
    if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) return null;
    if (typeof url !== 'string' || !isSafeHttpUrl(url)) return null;
    return { number, url };
  } catch {
    return null;
  }
}

function isSafeHttpUrl(value: string): boolean {
  if (hasControlChars(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export interface FormatGitBadgeOptions {
  readonly linkPullRequest?: boolean;
}

export function formatGitBadgeBase(status: GitStatus): string {
  const parts: string[] = [];
  const diff = formatDiffStats(status);
  if (diff) parts.push(diff);
  let sync = '';
  if (status.ahead > 0) sync += `↑${status.ahead}`;
  if (status.behind > 0) sync += `↓${status.behind}`;
  if (sync) parts.push(sync);
  return parts.length === 0 ? status.branch : `${status.branch} [${parts.join(' ')}]`;
}

export function formatPullRequestBadge(
  pullRequest: PullRequestInfo,
  options: FormatGitBadgeOptions = {},
): string {
  const prText = `[PR#${String(pullRequest.number)}]`;
  return options.linkPullRequest ? toTerminalHyperlink(prText, pullRequest.url) : prText;
}

export function formatGitBadge(status: GitStatus, options: FormatGitBadgeOptions = {}): string {
  const base = formatGitBadgeBase(status);
  if (status.pullRequest === null) return base;

  return `${base} ${formatPullRequestBadge(status.pullRequest, options)}`;
}

function formatDiffStats(status: GitStatus): string | null {
  const parts: string[] = [];
  if (status.diffAdded > 0) parts.push(`+${String(status.diffAdded)}`);
  if (status.diffDeleted > 0) parts.push(`-${String(status.diffDeleted)}`);
  if (parts.length > 0) return parts.join(' ');
  return status.dirty ? '±' : null;
}

function toTerminalHyperlink(text: string, url: string): string {
  if (!isSafeHttpUrl(url)) return text;
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}
