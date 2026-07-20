/* eslint-disable import/first -- vi.mock setup must run before the imports it stubs out. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
}));

import { collectCommitDiff, collectGitLog, parseGitLog } from '#/utils/git/git-log';

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const HASH_MERGE = 'cccccccccccccccccccccccccccccccccccccccc';

function logRecord(hash: string, subject: string, author: string, date: string, stat = ''): string {
  const header = `${hash}\u0000${subject}\u0000${author}\u0000${date}\u0000`;
  return stat.length === 0 ? header : `${header}\n ${stat}\n`;
}

const LOG_TEXT = [
  logRecord(HASH_A, 'feat: add feature', 'Alice', '2026-01-03T10:00:00+00:00', '3 files changed, 10 insertions(+), 2 deletions(-)'),
  logRecord(HASH_B, 'fix: correct bug', 'Bob', '2026-01-02T10:00:00+00:00', '1 file changed, 5 insertions(+)'),
  // Merge/empty commit: no shortstat line → all counts zero.
  logRecord(HASH_MERGE, "Merge branch 'main'", 'Alice', '2026-01-01T10:00:00+00:00'),
].join('\n');

const SHOW_TEXT = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  'index 1234567..abcdefg 100644',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,2 +1,2 @@',
  '-const old = 1;',
  '+const neu = 1;',
  ' const same = 2;',
].join('\n');

/** Route mocked git invocations by their first git argument. */
function routeGit(handlers: Record<string, () => string>): (cmd: string, args: string[]) => string {
  return (_cmd: string, args: string[]) => {
    const gitArgs = args.slice(2); // drop `-C <workDir>`
    const handler = handlers[gitArgs[0] ?? ''];
    if (handler === undefined) throw new Error(`unexpected git args: ${gitArgs.join(' ')}`);
    return handler();
  };
}

describe('parseGitLog', () => {
  it('returns [] for empty or whitespace-only input', () => {
    expect(parseGitLog('')).toEqual([]);
    expect(parseGitLog('  \n\n  ')).toEqual([]);
  });

  it('parses commits with and without shortstat', () => {
    const commits = parseGitLog(LOG_TEXT);
    expect(commits).toHaveLength(3);

    expect(commits[0]).toMatchObject({
      hash: HASH_A,
      subject: 'feat: add feature',
      author: 'Alice',
      dateIso: '2026-01-03T10:00:00+00:00',
      additions: 10,
      deletions: 2,
      filesChanged: 3,
    });

    // Insertions-only stat: deletions/files default to their parsed values.
    expect(commits[1]).toMatchObject({
      hash: HASH_B,
      subject: 'fix: correct bug',
      author: 'Bob',
      additions: 5,
      deletions: 0,
      filesChanged: 1,
    });

    // Merge commit without a shortstat line → zeroed counts.
    expect(commits[2]).toMatchObject({
      hash: HASH_MERGE,
      subject: "Merge branch 'main'",
      author: 'Alice',
      additions: 0,
      deletions: 0,
      filesChanged: 0,
    });
  });

  it('parses a deletions-only shortstat', () => {
    const text = logRecord(HASH_A, 'chore: remove', 'Alice', '2026-01-01T00:00:00+00:00', '2 files changed, 7 deletions(-)');
    const [commit] = parseGitLog(text);
    expect(commit).toMatchObject({ additions: 0, deletions: 7, filesChanged: 2 });
  });
});

describe('collectGitLog', () => {
  beforeEach(() => {
    mocks.execFileSync.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when not a git repository', () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });
    expect(collectGitLog('/tmp/nope')).toBeNull();
  });

  it('collects branch and parsed commits', () => {
    mocks.execFileSync.mockImplementation(
      routeGit({
        'rev-parse': () => 'true\n',
        branch: () => 'main\n',
        log: () => LOG_TEXT,
      }),
    );
    const report = collectGitLog('/tmp/repo');
    expect(report?.branch).toBe('main');
    expect(report?.commits).toHaveLength(3);
    expect(report?.commits[0]?.hash).toBe(HASH_A);
  });

  it('passes the limit through to git log (default 30)', () => {
    mocks.execFileSync.mockImplementation(
      routeGit({
        'rev-parse': () => 'true\n',
        branch: () => 'main\n',
        log: () => LOG_TEXT,
      }),
    );
    collectGitLog('/tmp/repo');
    const defaultCall = mocks.execFileSync.mock.calls.find(
      (call) => (call[1] as string[]).slice(2)[0] === 'log',
    );
    expect(defaultCall?.[1]).toContain('-n');
    expect(defaultCall?.[1]).toContain('30');
  });

  it('honors a custom limit', () => {
    mocks.execFileSync.mockImplementation(
      routeGit({
        'rev-parse': () => 'true\n',
        branch: () => 'main\n',
        log: () => LOG_TEXT,
      }),
    );
    collectGitLog('/tmp/repo', { limit: 5 });
    const logCall = mocks.execFileSync.mock.calls.find(
      (call) => (call[1] as string[]).slice(2)[0] === 'log',
    );
    const gitArgs = (logCall?.[1] as string[]).slice(2);
    expect(gitArgs[0]).toBe('log');
    expect(gitArgs[1]).toBe('-n');
    expect(gitArgs[2]).toBe('5');
  });
});

describe('collectCommitDiff', () => {
  beforeEach(() => {
    mocks.execFileSync.mockReset();
  });

  it('rejects non-hex hashes without spawning git', () => {
    expect(collectCommitDiff('/tmp/repo', 'not-a-hash')).toBeNull();
    expect(collectCommitDiff('/tmp/repo', 'abc')).toBeNull(); // too short (< 7)
    expect(mocks.execFileSync).not.toHaveBeenCalled();
  });

  it('parses the commit diff from git show output', () => {
    mocks.execFileSync.mockImplementation(
      routeGit({
        show: () => SHOW_TEXT,
      }),
    );
    const files = collectCommitDiff('/tmp/repo', HASH_A);
    expect(files).toHaveLength(1);
    expect(files?.[0]?.path).toBe('src/foo.ts');
    expect(files?.[0]?.added).toBe(1);
    expect(files?.[0]?.deleted).toBe(1);
  });

  it('returns null when git show fails', () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('fatal: bad revision');
    });
    expect(collectCommitDiff('/tmp/repo', HASH_A)).toBeNull();
  });
});
