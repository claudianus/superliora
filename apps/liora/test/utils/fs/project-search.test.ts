/* eslint-disable import/first -- vi.mock setup must run before the imports it stubs out. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
}));

import { searchProject } from '#/utils/fs/project-search';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'liora-project-search-'));
}

function rgError(status: number): Error {
  return Object.assign(new Error(`rg exited with ${String(status)}`), { status });
}

describe('searchProject (built-in engine)', () => {
  let dir: string;

  beforeEach(() => {
    mocks.execFileSync.mockReset();
    // Force the built-in path: rg "missing" and git unavailable → fs walk.
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('spawn failed');
    });
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty results for a blank pattern', () => {
    expect(searchProject(dir, '   ')).toEqual({
      pattern: '',
      matches: [],
      fileCount: 0,
      truncated: false,
      engine: 'builtin',
    });
  });

  it('finds case-insensitive matches with path, line, and text', () => {
    writeFileSync(join(dir, 'app.ts'), 'const alpha = 1;\n// ALPHA here\nconst beta = 2;\n');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'lib.ts'), 'no match\nexport const Alpha = 3;\n');

    const results = searchProject(dir, 'alpha');

    expect(results.engine).toBe('builtin');
    expect(results.pattern).toBe('alpha');
    expect(results.truncated).toBe(false);
    expect(results.fileCount).toBe(2);
    expect(results.matches).toEqual([
      { path: 'app.ts', line: 1, text: 'const alpha = 1;' },
      { path: 'app.ts', line: 2, text: '// ALPHA here' },
      { path: 'src/lib.ts', line: 2, text: 'export const Alpha = 3;' },
    ]);
  });

  it('treats a compilable pattern as a regex', () => {
    writeFileSync(join(dir, 're.ts'), 'foo123\nfoo\nbar42\n');

    const results = searchProject(dir, 'foo\\d+');

    expect(results.matches).toEqual([{ path: 're.ts', line: 1, text: 'foo123' }]);
  });

  it('falls back to a literal substring when the pattern is not a valid regex', () => {
    writeFileSync(join(dir, 'regex.ts'), 'call a(b) here\nnope\nA(B upper\n');

    const results = searchProject(dir, 'a(b');

    expect(results.engine).toBe('builtin');
    expect(results.matches).toEqual([
      { path: 'regex.ts', line: 1, text: 'call a(b) here' },
      { path: 'regex.ts', line: 3, text: 'A(B upper' },
    ]);
  });

  it('skips node_modules and other pruned directories', () => {
    writeFileSync(join(dir, 'keep.ts'), 'needle\n');
    mkdirSync(join(dir, 'node_modules', 'decoy'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'decoy', 'index.js'), 'needle\n');

    const results = searchProject(dir, 'needle');

    expect(results.matches.map((m) => m.path)).toEqual(['keep.ts']);
    expect(results.fileCount).toBe(1);
  });

  it('caps matches per file at 10 without flagging truncation', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `hit ${String(i)}`).join('\n');
    writeFileSync(join(dir, 'many.ts'), lines);

    const results = searchProject(dir, 'hit');

    expect(results.matches).toHaveLength(10);
    expect(results.matches.every((m) => m.path === 'many.ts')).toBe(true);
    expect(results.truncated).toBe(false);
  });

  it('caps total matches at maxMatches and reports truncated', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `hit ${String(i)}`).join('\n');
    writeFileSync(join(dir, 'many.ts'), lines);

    const results = searchProject(dir, 'hit', { maxMatches: 5 });

    expect(results.matches).toHaveLength(5);
    expect(results.truncated).toBe(true);
  });

  it('skips binary files (NUL in the first 8KB)', () => {
    writeFileSync(join(dir, 'text.ts'), 'needle\n');
    writeFileSync(join(dir, 'bin.dat'), 'needle\u0000binary\n');

    const results = searchProject(dir, 'needle');

    expect(results.matches.map((m) => m.path)).toEqual(['text.ts']);
  });

  it('skips files larger than 512KB', () => {
    writeFileSync(join(dir, 'small.ts'), 'needle\n');
    writeFileSync(join(dir, 'huge.log'), `${'x'.repeat(512 * 1024)}\nneedle\n`);

    const results = searchProject(dir, 'needle');

    expect(results.matches.map((m) => m.path)).toEqual(['small.ts']);
  });

  it('counts distinct files once even with many matches', () => {
    writeFileSync(join(dir, 'a.ts'), 'x\nx\nx\n');
    writeFileSync(join(dir, 'b.ts'), 'x\n');

    const results = searchProject(dir, 'x');

    expect(results.fileCount).toBe(2);
    expect(results.matches).toHaveLength(4);
  });
});

describe('searchProject (ripgrep engine)', () => {
  let dir: string;

  beforeEach(() => {
    mocks.execFileSync.mockReset();
    dir = makeTempDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses rg output into relative-path matches and passes regex + workDir', () => {
    mocks.execFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'rg') return `${dir}/a.ts:3:const x = 1\n${dir}/b.ts:7:let y\n`;
      throw new Error('unexpected call');
    });

    const results = searchProject(dir, 'x');

    expect(results.engine).toBe('ripgrep');
    expect(results.pattern).toBe('x');
    expect(results.fileCount).toBe(2);
    expect(results.matches).toEqual([
      { path: 'a.ts', line: 3, text: 'const x = 1' },
      { path: 'b.ts', line: 7, text: 'let y' },
    ]);

    const [cmd, args] = mocks.execFileSync.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('rg');
    expect(args).toContain('--line-number');
    expect(args).toContain('--no-heading');
    expect(args.at(-2)).toBe('x');
    expect(args.at(-1)).toBe(dir);
  });

  it('returns zero matches without error when rg exits 1 (no matches)', () => {
    mocks.execFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'rg') throw rgError(1);
      throw new Error('unexpected call');
    });

    const results = searchProject(dir, 'nothing');

    expect(results).toEqual({
      pattern: 'nothing',
      matches: [],
      fileCount: 0,
      truncated: false,
      engine: 'ripgrep',
    });
  });

  it('caps parsed rg matches at maxMatches and reports truncated', () => {
    const out = Array.from({ length: 8 }, (_, i) => `${dir}/f.ts:${String(i + 1)}:hit`).join('\n');
    mocks.execFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'rg') return out;
      throw new Error('unexpected call');
    });

    const results = searchProject(dir, 'hit', { maxMatches: 3 });

    expect(results.engine).toBe('ripgrep');
    expect(results.matches).toHaveLength(3);
    expect(results.truncated).toBe(true);
    expect(results.fileCount).toBe(1);
  });

  it('falls back to the built-in literal scanner when rg rejects the regex (exit 2)', () => {
    writeFileSync(join(dir, 'lit.ts'), 'a(b literal\nplain\n');
    mocks.execFileSync.mockImplementation((cmd: string) => {
      if (cmd === 'rg') throw rgError(2);
      throw new Error('git unavailable'); // force the fs walk in listProjectFiles
    });

    const results = searchProject(dir, 'a(b');

    expect(results.engine).toBe('builtin');
    expect(results.matches).toEqual([{ path: 'lit.ts', line: 1, text: 'a(b literal' }]);
  });
});
