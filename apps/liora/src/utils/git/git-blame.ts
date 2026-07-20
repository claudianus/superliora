/**
 * Git blame collection for the `/blame` viewer.
 *
 * `collectGitBlame` shells out to `git blame --porcelain` for a path and
 * returns the parsed per-line commit attribution; unlike `git-log.ts` (which
 * never throws) it surfaces a readable error when git fails, since `/blame`
 * reports failures inline. `parseGitBlamePorcelain` is the pure parser so the
 * porcelain rules are testable without a git binary. Mirrors the plumbing
 * conventions in `git-log.ts`.
 */

import { execFileSync } from 'node:child_process';

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

export interface BlameCommit {
  readonly hash: string;
  readonly author: string;
  /** Unix seconds; 0 for uncommitted lines. */
  readonly authorTime: number;
  readonly summary: string;
}

export interface BlameLine {
  /** 1-based line number in the blamed file. */
  readonly lineNumber: number;
  readonly commit: BlameCommit;
  readonly content: string;
}

/** Header line: `<40-hex> <origLine> <finalLine> [<groupLines>]`. */
const HEADER_LINE = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/;

/** True for the all-zero SHA git reports for lines without a commit yet. */
export function isUncommittedBlameHash(hash: string): boolean {
  return /^0{40,64}$/.test(hash);
}

/**
 * Parse `git blame --porcelain` output into {@link BlameLine}s. Each record
 * starts with a header line, then key-value headers (`author`, `author-time`,
 * `summary`, …) that git emits in full only on a commit's FIRST occurrence,
 * then a content line prefixed with a literal TAB. Commits are cached by
 * hash so later occurrences reuse the first record's metadata. The all-zero
 * hash maps to a synthetic "Uncommitted" commit. Returns `[]` for empty or
 * unparseable input.
 */
export function parseGitBlamePorcelain(output: string): BlameLine[] {
  if (output.trim().length === 0) return [];

  const commits = new Map<string, BlameCommit>();
  const lines: BlameLine[] = [];
  let pendingHash: string | null = null;
  let pendingLineNumber = 0;
  let author = '';
  let authorTime = 0;
  let summary = '';

  for (const raw of output.split('\n')) {
    if (raw.startsWith('\t')) {
      if (pendingHash === null) continue;
      let commit = commits.get(pendingHash);
      if (commit === undefined) {
        commit = isUncommittedBlameHash(pendingHash)
          ? {
              hash: pendingHash,
              author: 'Uncommitted',
              authorTime: 0,
              summary: 'Uncommitted changes',
            }
          : { hash: pendingHash, author, authorTime, summary };
        commits.set(pendingHash, commit);
      }
      lines.push({ lineNumber: pendingLineNumber, commit, content: raw.slice(1) });
      pendingHash = null;
      author = '';
      authorTime = 0;
      summary = '';
      continue;
    }

    const header = HEADER_LINE.exec(raw);
    if (header !== null) {
      pendingHash = header[1] ?? '';
      pendingLineNumber = Number.parseInt(header[2] ?? '0', 10);
      continue;
    }

    if (raw.startsWith('author ')) {
      author = raw.slice('author '.length);
    } else if (raw.startsWith('author-time ')) {
      authorTime = Number.parseInt(raw.slice('author-time '.length), 10) || 0;
    } else if (raw.startsWith('summary ')) {
      summary = raw.slice('summary '.length);
    }
  }

  return lines;
}

/**
 * Collect the parsed blame for `relativePath` (resolved against `opts.cwd`,
 * defaulting to the current working directory). Throws a readable error when
 * git fails (not a repo, no such path, git missing, timeout).
 */
export async function collectGitBlame(
  relativePath: string,
  opts?: { readonly cwd?: string },
): Promise<BlameLine[]> {
  const workDir = opts?.cwd ?? process.cwd();
  let output: string;
  try {
    output = execFileSync('git', ['-C', workDir, 'blame', '--porcelain', '--', relativePath], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`git blame failed for ${relativePath}: ${describeGitFailure(error)}`, {
      cause: error,
    });
  }
  return parseGitBlamePorcelain(output);
}

/** First stderr line when captured, else the raw failure message. */
function describeGitFailure(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  if (typeof stderr === 'string' && stderr.trim().length > 0) {
    return stderr.trim().split('\n')[0] ?? stderr.trim();
  }
  if (stderr instanceof Uint8Array && stderr.byteLength > 0) {
    return new TextDecoder().decode(stderr).trim();
  }
  return error instanceof Error ? error.message : String(error);
}
