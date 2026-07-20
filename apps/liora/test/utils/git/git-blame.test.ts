/* eslint-disable import/first -- vi.mock setup must run before the imports it stubs out. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
}));

import {
  collectGitBlame,
  isUncommittedBlameHash,
  parseGitBlamePorcelain,
} from '#/utils/git/git-blame';

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ZERO_HASH = '0'.repeat(40);
const TIME_A = 1_767_225_600; // 2026-01-01T00:00:00Z
const TIME_B = 1_767_312_000; // 2026-01-02T00:00:00Z

// Lines 1–2 share HASH_A: full headers appear only on the first occurrence,
// the second record is header + TAB content only. HASH_B is a second commit;
// the all-zero hash marks an uncommitted line.
const BLAME_TEXT = [
  `${HASH_A} 1 1 2`,
  'author Alice',
  'author-mail <alice@example.com>',
  `author-time ${String(TIME_A)}`,
  'author-tz +0000',
  'committer Alice',
  'committer-mail <alice@example.com>',
  `committer-time ${String(TIME_A)}`,
  'committer-tz +0000',
  'summary feat: add header',
  'filename src/app.ts',
  "\timport { run } from './run';",
  `${HASH_A} 2 2`,
  "\timport { log } from './log';",
  `${HASH_B} 3 3 1`,
  'author Bob',
  'author-mail <bob@example.com>',
  `author-time ${String(TIME_B)}`,
  'author-tz +0000',
  'committer Bob',
  `committer-time ${String(TIME_B)}`,
  'committer-tz +0000',
  'summary fix: correct footer',
  'filename src/app.ts',
  '\tconst special = "tab\tand \\ backslash";',
  `${ZERO_HASH} 4 4 1`,
  'author Not Committed Yet',
  'author-mail <not.committed@yet>',
  'author-time 0',
  'author-tz +0000',
  'committer Not Committed Yet',
  'committer-time 0',
  'committer-tz +0000',
  'summary ',
  'filename src/app.ts',
  '\tconst pending = 1;',
].join('\n');

describe('parseGitBlamePorcelain', () => {
  it('returns [] for empty or whitespace-only input', () => {
    expect(parseGitBlamePorcelain('')).toEqual([]);
    expect(parseGitBlamePorcelain('  \n\n  ')).toEqual([]);
  });

  it('caches commit metadata across lines of the same commit', () => {
    const lines = parseGitBlamePorcelain(BLAME_TEXT);
    expect(lines).toHaveLength(4);

    const [first, second] = lines;
    expect(first).toMatchObject({
      lineNumber: 1,
      content: "import { run } from './run';",
    });
    expect(first?.commit).toMatchObject({
      hash: HASH_A,
      author: 'Alice',
      authorTime: TIME_A,
      summary: 'feat: add header',
    });

    // The second occurrence repeats no headers → same cached commit object.
    expect(second?.lineNumber).toBe(2);
    expect(second?.content).toBe("import { log } from './log';");
    expect(second?.commit).toBe(first?.commit);
  });

  it('parses a second commit with its own metadata', () => {
    const lines = parseGitBlamePorcelain(BLAME_TEXT);
    expect(lines[2]).toMatchObject({
      lineNumber: 3,
      commit: {
        hash: HASH_B,
        author: 'Bob',
        authorTime: TIME_B,
        summary: 'fix: correct footer',
      },
    });
  });

  it('maps the all-zero hash to a synthetic uncommitted commit', () => {
    const lines = parseGitBlamePorcelain(BLAME_TEXT);
    expect(lines[3]?.lineNumber).toBe(4);
    expect(lines[3]?.commit).toMatchObject({
      hash: ZERO_HASH,
      author: 'Uncommitted',
      authorTime: 0,
      summary: 'Uncommitted changes',
    });
  });

  it('strips only the leading TAB and preserves special characters', () => {
    const lines = parseGitBlamePorcelain(BLAME_TEXT);
    expect(lines[2]?.content).toBe('const special = "tab\tand \\ backslash";');
    expect(lines[3]?.content).toBe('const pending = 1;');
  });
});

describe('isUncommittedBlameHash', () => {
  it('accepts only all-zero SHAs', () => {
    expect(isUncommittedBlameHash(ZERO_HASH)).toBe(true);
    expect(isUncommittedBlameHash(HASH_A)).toBe(false);
    expect(isUncommittedBlameHash('000')).toBe(false);
  });
});

describe('collectGitBlame', () => {
  beforeEach(() => {
    mocks.execFileSync.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs git blame --porcelain and parses the output', async () => {
    mocks.execFileSync.mockReturnValue(BLAME_TEXT);
    const lines = await collectGitBlame('src/app.ts', { cwd: '/tmp/repo' });
    expect(lines).toHaveLength(4);
    expect(lines[0]?.commit.author).toBe('Alice');

    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    const [cmd, args] = mocks.execFileSync.mock.calls[0] ?? [];
    expect(cmd).toBe('git');
    expect(args).toEqual(['-C', '/tmp/repo', 'blame', '--porcelain', '--', 'src/app.ts']);
  });

  it('defaults the work dir to the current working directory', async () => {
    mocks.execFileSync.mockReturnValue('');
    await collectGitBlame('README.md');
    const args = mocks.execFileSync.mock.calls[0]?.[1] as string[];
    expect(args.slice(0, 3)).toEqual(['-C', process.cwd(), 'blame']);
  });

  it('throws a readable error when git fails, preserving the cause', async () => {
    const original = Object.assign(new Error('Command failed'), {
      stderr: "fatal: no such path 'missing.ts' in HEAD",
    });
    mocks.execFileSync.mockImplementation(() => {
      throw original;
    });

    await expect(collectGitBlame('missing.ts', { cwd: '/tmp/repo' })).rejects.toThrow(
      /git blame failed for missing\.ts: fatal: no such path/,
    );
    await expect(collectGitBlame('missing.ts', { cwd: '/tmp/repo' })).rejects.toMatchObject({
      cause: original,
    });
  });

  it('falls back to the error message when stderr is absent', async () => {
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('spawnSync git ENOENT');
    });
    await expect(collectGitBlame('src/app.ts', { cwd: '/tmp/repo' })).rejects.toThrow(
      /git blame failed for src\/app\.ts: spawnSync git ENOENT/,
    );
  });
});
