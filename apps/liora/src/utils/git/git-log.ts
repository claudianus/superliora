/**
 * Commit-history collection for the `/log` commit browser.
 *
 * `collectGitLog` shells out to `git log --shortstat` with a NUL-separated
 * pretty format and returns a structured report, or `null` when `workDir`
 * is not a git repo / git is missing. It never throws. `collectCommitDiff`
 * returns the parsed unified diff for a single commit (via `git show`).
 * `parseGitLog` is the pure log parser so the parsing rules are testable
 * without a git binary. Mirrors the plumbing conventions in `git-diff.ts`.
 */

import { execFileSync } from 'node:child_process';

import { parseUnifiedDiff, type GitDiffFile } from '#/utils/git/git-diff';

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

/** Default number of commits to list when no limit is given. */
export const DEFAULT_LOG_LIMIT = 30;

export interface GitLogCommit {
  /** Full commit SHA. */
  readonly hash: string;
  readonly subject: string;
  readonly author: string;
  /** Author date, ISO 8601 (`%aI`). */
  readonly dateIso: string;
  /** From `--shortstat`; 0 when absent (e.g. empty or merge commits). */
  readonly additions: number;
  readonly deletions: number;
  readonly filesChanged: number;
}

export interface GitLogReport {
  readonly branch: string | null;
  readonly commits: readonly GitLogCommit[];
}

/**
 * Parse `git log --shortstat --pretty=format:%H%x00%s%x00%an%x00%aI%x00`
 * output into {@link GitLogCommit}s. Each record is a NUL-separated header
 * (`hash\0subject\0author\0date\0`) followed by an optional shortstat line.
 * Returns `[]` for empty or unparseable input.
 */
export function parseGitLog(text: string): GitLogCommit[] {
  if (text.trim().length === 0) return [];

  // A record starts at a full SHA immediately followed by a NUL byte. NUL
  // never appears in subject/author fields, so this boundary is unambiguous.
  const records = text.split(/(?=[0-9a-f]{40,64}\u0000)/);
  const commits: GitLogCommit[] = [];

  for (const record of records) {
    if (record.trim().length === 0) continue;
    const fields = record.split('\u0000');
    const hash = fields[0]?.trim() ?? '';
    if (!/^[0-9a-f]{40,64}$/i.test(hash)) continue;

    const stat = fields[4] ?? '';
    commits.push({
      hash,
      subject: fields[1] ?? '',
      author: fields[2] ?? '',
      dateIso: fields[3] ?? '',
      additions: parseStatNumber(stat, /(\d+) insertions?\(\+\)/),
      deletions: parseStatNumber(stat, /(\d+) deletions?\(-\)/),
      filesChanged: parseStatNumber(stat, /(\d+) files? changed/),
    });
  }

  return commits;
}

function parseStatNumber(text: string, re: RegExp): number {
  const match = re.exec(text);
  return match === null ? 0 : Number.parseInt(match[1] ?? '0', 10) || 0;
}

/**
 * Collect the most recent `limit` commits for `workDir`. Returns `null`
 * when not a git repo or git is unavailable.
 */
export function collectGitLog(
  workDir: string,
  options?: { readonly limit?: number },
): GitLogReport | null {
  if (!isGitRepo(workDir)) return null;

  const limit = Math.max(1, options?.limit ?? DEFAULT_LOG_LIMIT);
  const branch = readBranch(workDir);
  const logText = runGit(workDir, [
    'log',
    '-n',
    String(limit),
    '--no-color',
    '--shortstat',
    '--pretty=format:%H%x00%s%x00%an%x00%aI%x00',
  ]);
  if (logText === null) return null;

  return { branch, commits: parseGitLog(logText) };
}

/**
 * Collect the parsed diff for a single commit. `hash` must be a 7–40 char
 * hex abbreviation or full SHA; anything else is rejected before spawning.
 * Returns `null` on failure or an empty diff.
 */
export function collectCommitDiff(workDir: string, hash: string): GitDiffFile[] | null {
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) return null;
  const showText = runGit(workDir, ['show', '--no-color', '--no-ext-diff', '--format=', '--patch', hash]);
  if (showText === null) return null;
  return parseUnifiedDiff(showText);
}

// ---------------------------------------------------------------------------
// Git plumbing (never throws) — mirrors git-diff.ts
// ---------------------------------------------------------------------------

function isGitRepo(workDir: string): boolean {
  try {
    const out = runGit(workDir, ['rev-parse', '--is-inside-work-tree']);
    return out !== null && out.trim() === 'true';
  } catch {
    return false;
  }
}

function readBranch(workDir: string): string | null {
  const branch = runGit(workDir, ['branch', '--show-current']);
  if (branch !== null && branch.trim().length > 0) return branch.trim();
  // Detached HEAD: fall back to a short revision so the header stays useful.
  const rev = runGit(workDir, ['rev-parse', '--short', 'HEAD']);
  if (rev !== null && rev.trim().length > 0) return rev.trim();
  return null;
}

function runGit(workDir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', workDir, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}
