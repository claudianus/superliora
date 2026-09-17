import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { Kaos, KaosProcess } from '@superliora/kaos';

import {
  buildCommandArgs,
  buildResultPayload,
  declaredTestDir,
  pickScript,
  resolveCheckScript,
  RunProjectChecksInputSchema,
  RunProjectChecksTool,
} from '../../src/tools/builtin/ops/run-project-checks';
import { createFakeKaos } from './fixtures/fake-kaos';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function context(args: Record<string, unknown> = {}) {
  return { turnId: '0', toolCallId: 'call_rpc', args, signal };
}

function fakeProcess(exitCode: number, stdout = '', stderr = ''): KaosProcess {
  const stdoutStream = Readable.from([stdout]);
  const stderrStream = Readable.from([stderr]);
  const stdin = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  return {
    stdin,
    stdout: stdoutStream,
    stderr: stderrStream,
    pid: 1234,
    exitCode: null,
    wait: async () => exitCode,
    kill: async () => undefined,
    dispose: () => undefined,
  };
}

describe('RunProjectChecksTool', () => {
  it('exposes schema and prefers the declared script name only', () => {
    expect(RunProjectChecksInputSchema.safeParse({}).success).toBe(true);
    expect(
      RunProjectChecksInputSchema.safeParse({
        checks: ['test', 'lint'],
        packageDir: 'packages/agent-core',
        timeoutMs: 5_000,
      }).success,
    ).toBe(true);
    expect(RunProjectChecksInputSchema.safeParse({ checks: ['unknown'] }).success).toBe(false);
    expect(
      RunProjectChecksInputSchema.safeParse({ scriptOverrides: { typecheck: 'type-check' } }).success,
    ).toBe(true);
    expect(
      RunProjectChecksInputSchema.safeParse({ scriptOverrides: { nope: 'x' } }).success,
    ).toBe(false);

    // H6: the declared name wins outright — no alias table, no string matching.
    expect(pickScript('test', { test: 'vitest run' })).toBe('test');
    expect(pickScript('typecheck', { typecheck: 'tsc -p .' })).toBe('typecheck');
    // H6: a non-canonical name is NOT inferred any more. The old alias list
    // ('type-check', 'tsc', 'build', …) is gone; the project must declare the
    // canonical name or the caller must supply a judgement for it.
    expect(pickScript('typecheck', { 'type-check': 'tsc -p .' })).toBeUndefined();
    expect(pickScript('typecheck', { build: 'tsc --noEmit && vite build' })).toBeUndefined();
    expect(pickScript('typecheck', {})).toBeUndefined();
    expect(pickScript('smoke', { build: 'tsc' })).toBeUndefined();

    // A judgement is honoured only when the manifest actually declares it.
    expect(
      resolveCheckScript('typecheck', { 'type-check': 'tsc' }, { typecheck: 'type-check' }),
    ).toMatchObject({ scriptName: 'type-check', provenance: 'heuristic' });
    expect(
      resolveCheckScript('typecheck', { 'type-check': 'tsc' }, { typecheck: 'tsc' }),
    ).toMatchObject({ provenance: 'undecidable' });
    expect(resolveCheckScript('test', { test: 'vitest' })).toMatchObject({
      scriptName: 'test',
      provenance: 'declared',
    });

    expect(buildCommandArgs(undefined, 'test')).toEqual(['pnpm', 'run', 'test']);
    expect(buildCommandArgs(undefined, 'test', 'node --test tests/*.test.js')).toEqual([
      'node',
      '--test',
      'tests/*.test.js',
    ]);
    // H2 regression: a bare `node --test` script must NOT synthesize a `tests`
    // directory. Projects that keep their tests in `test/` were being run as
    // `node --test tests` and recorded a false tests=failed.
    expect(buildCommandArgs(undefined, 'test', 'node --test')).toEqual(['node', '--test']);
    // H2 follow-up: a *declared* directory that is absent on disk also falls
    // back to Node's own discovery instead of failing on a missing path.
    expect(buildCommandArgs(undefined, 'test', 'node --test tests/*.test.js', false)).toEqual([
      'node',
      '--test',
    ]);
    // H6: a declared spec is emitted verbatim — directory positional args are
    // broken on Node 24 either way, so rewriting them bought nothing and hid
    // the project's own command from the ledger.
    expect(buildCommandArgs(undefined, 'test', 'node --test test/', true)).toEqual([
      'node',
      '--test',
      'test/',
    ]);
    expect(declaredTestDir('node --test')).toBeUndefined();
    expect(declaredTestDir('node --test tests/*.test.js')).toBe('tests');
    expect(declaredTestDir('node --test test/')).toBe('test');
    expect(buildCommandArgs('packages/agent-core', 'test')).toEqual([
      'pnpm',
      '-C',
      'packages/agent-core',
      'run',
      'test',
    ]);
  });

  it('runs discovered scripts via kaos.exec and returns structured JSON', async () => {
    const exec = vi.fn(async (...args: string[]) => {
      if (args[0] === 'pnpm' && args.includes('test')) {
        return fakeProcess(0, 'ok tests\n');
      }
      if (args[0] === 'pnpm' && args.includes('typecheck')) {
        return fakeProcess(0, 'types ok\n');
      }
      if (args[0] === 'pnpm' && args.includes('build')) {
        return fakeProcess(1, '', 'build failed\n');
      }
      throw new Error(`unexpected exec: ${args.join(' ')}`);
    });

    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async (path: string) => {
        expect(path).toBe('/work/package.json');
        return JSON.stringify({
          scripts: {
            test: 'vitest run',
            typecheck: 'tsc -p .',
            build: 'tsc -b',
          },
        });
      },
      exec: exec as Kaos['exec'],
    });

    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(
      tool,
      context({ checks: ['test', 'typecheck', 'build'], timeoutMs: 5_000 }),
    );

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ name: string; exitCode: number; command?: string }>;
      summary: string;
    };
    expect(payload.exitCode).toBe(1);
    expect(payload.checks).toHaveLength(3);
    expect(payload.checks[0]).toMatchObject({ name: 'test', exitCode: 0 });
    expect(payload.checks[1]).toMatchObject({ name: 'typecheck', exitCode: 0 });
    expect(payload.checks[2]).toMatchObject({ name: 'build', exitCode: 1 });
    expect(payload.summary).toContain('failed');
    expect(exec).toHaveBeenCalled();
  });

  it('skips checks with no matching package.json script and names it undecidable', async () => {
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async () => JSON.stringify({ scripts: { test: 'vitest' } }),
      exec: async () => fakeProcess(0, 'ok\n'),
    });

    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(tool, context({ checks: ['test', 'smoke'] }));
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ name: string; skipped?: boolean; reason?: string; provenance?: string }>;
    };
    expect(payload.exitCode).toBe(1);
    expect(payload.checks[0]?.name).toBe('test');
    expect(payload.checks[0]?.provenance).toBe('declared');
    expect(payload.checks[1]).toMatchObject({
      name: 'smoke',
      skipped: true,
      provenance: 'undecidable',
    });
    // H6: no alias table is consulted any more — the recorded reason states
    // the judgement rather than a list of names the harness made up.
    expect(payload.checks[1]?.reason).toContain('undecidable');
    expect(payload.checks[1]?.reason).not.toContain('tried:');
  });

  it('H6: a hallucinated script override is recorded undecidable, never run', async () => {
    // The judgement slot is not a licence to run arbitrary commands: the
    // manifest has to declare the script. Otherwise the harness would be
    // executing names that exist only in the model's imagination.
    const exec = vi.fn(async (...args: string[]) => {
      throw new Error(`unexpected exec: ${args.join(' ')}`);
    });
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async () => JSON.stringify({ scripts: { check: 'node scripts/check.mjs' } }),
      exec: exec as Kaos['exec'],
    });

    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(
      tool,
      context({ checks: ['test'], scriptOverrides: { test: 'test:unit' } }),
    );
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ skipped?: boolean; reason?: string; provenance?: string }>;
    };
    expect(exec).not.toHaveBeenCalled();
    expect(payload.exitCode).toBe(1);
    expect(payload.checks[0]).toMatchObject({ skipped: true, provenance: 'undecidable' });
    expect(payload.checks[0]?.reason).toContain("does not declare that script");
  });

  it('H6: no test script at all cannot produce a silent pass', async () => {
    const exec = vi.fn(async (...args: string[]) => {
      throw new Error(`unexpected exec: ${args.join(' ')}`);
    });
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async () => JSON.stringify({ name: 'docs-only', scripts: {} }),
      exec: exec as Kaos['exec'],
    });

    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(tool, context({ checks: ['test'] }));
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ exitCode: number; skipped?: boolean; reason?: string; provenance?: string }>;
    };
    expect(exec).not.toHaveBeenCalled();
    expect(payload.exitCode).toBe(1);
    expect(payload.checks[0]?.skipped).toBe(true);
    expect(payload.checks[0]?.provenance).toBe('undecidable');
    expect(payload.checks[0]?.reason).toContain("no package.json script named 'test'");
  });

  it('runs node --test directly and does not invoke pnpm for a no-dep package', async () => {
    const exec = vi.fn(async (...args: string[]) => {
      if (args[0] === 'node' && args.includes('--test')) {
        return fakeProcess(0, 'ok\n');
      }
      throw new Error(`unexpected exec: ${args.join(' ')}`);
    });
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async () =>
        JSON.stringify({
          name: 'neon-lock',
          scripts: { test: 'node --test tests/*.test.js' },
        }),
      exec: exec as Kaos['exec'],
      stat: async () => ({ stMode: 0o040755 }) as never,
    });
    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(
      tool,
      context({ checks: ['test', 'typecheck', 'build'], timeoutMs: 5_000 }),
    );
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ name: string; skipped?: boolean; command?: string; provenance?: string }>;
    };
    expect(payload.exitCode).toBe(0);
    expect(payload.checks[0]).toMatchObject({
      name: 'test',
      command: 'node --test tests/*.test.js',
      provenance: 'declared',
    });
    expect(payload.checks[1]?.skipped).toBe(true);
    expect(payload.checks[2]?.skipped).toBe(true);
    expect(exec.mock.calls.some((call) => call[0] === 'pnpm')).toBe(false);
  });

  it('uses pnpm -C when packageDir is provided', async () => {
    const exec = vi.fn(async (...args: string[]) => {
      expect(args).toEqual(['pnpm', '-C', 'packages/agent-core', 'run', 'test']);
      return fakeProcess(0, 'ok\n');
    });
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async (path: string) => {
        expect(path).toBe('/work/packages/agent-core/package.json');
        return JSON.stringify({ scripts: { test: 'vitest run' } });
      },
      exec: exec as Kaos['exec'],
    });

    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(
      tool,
      context({ checks: ['test'], packageDir: 'packages/agent-core' }),
    );
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(String(result.output)) as { exitCode: number };
    expect(payload.exitCode).toBe(0);
  });

  it('verifies a static site when package.json is missing', async () => {
    const kaos = createFakeKaos({
      getcwd: () => '/site',
      readText: async () => {
        throw new Error('ENOENT: no package.json');
      },
      glob: (async function* (_path: string, pattern: string) {
        if (pattern === '**/*.html') yield '/site/index.html';
        if (pattern === '**/*.js') yield '/site/app.js';
      }) as Kaos['glob'],
      exec: (async (...args: string[]) => {
        if (args[0] === 'node' && args[1] === '--check') return fakeProcess(0);
        throw new Error(`unexpected exec: ${args.join(' ')}`);
      }) as Kaos['exec'],
      stat: async () => ({ isFile: () => true }) as never,
    });

    const tool = new RunProjectChecksTool(kaos, '/site');
    const result = await executeTool(tool, context({ checks: ['test', 'typecheck', 'lint'] }));
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ name: string; exitCode: number; command?: string }>;
      summary: string;
    };
    expect(result.isError).toBeFalsy();
    expect(payload.exitCode).toBe(0);
    expect(payload.checks).toHaveLength(1);
    expect(payload.checks[0]?.name).toBe('static');
    expect(payload.summary).toContain('Static site checks');
  });

  it('fails the static check when shipped JS does not parse', async () => {
    const kaos = createFakeKaos({
      getcwd: () => '/site',
      readText: async () => {
        throw new Error('ENOENT: no package.json');
      },
      glob: (async function* (_path: string, pattern: string) {
        if (pattern === '**/*.html') yield '/site/index.html';
        if (pattern === '**/*.js') yield '/site/app.js';
      }) as Kaos['glob'],
      exec: (async (...args: string[]) => {
        if (args[0] === 'node' && args[1] === '--check') {
          return fakeProcess(1, '', 'SyntaxError: Unexpected token');
        }
        throw new Error(`unexpected exec: ${args.join(' ')}`);
      }) as Kaos['exec'],
      stat: async () => ({ isFile: () => true }) as never,
    });

    const tool = new RunProjectChecksTool(kaos, '/site');
    const result = await executeTool(tool, context({ checks: ['test'] }));
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ name: string; exitCode: number; logPreview?: string }>;
    };
    expect(result.isError).toBe(true);
    expect(payload.exitCode).toBe(1);
    expect(payload.checks[0]?.name).toBe('static');
    expect(payload.checks[0]?.logPreview).toContain('SyntaxError');
  });

  it('keeps the package.json error when the directory is not a static site', async () => {
    const kaos = createFakeKaos({
      getcwd: () => '/empty',
      readText: async () => {
        throw new Error('ENOENT: no package.json');
      },
      glob: (async function* () {
        // no static files at all
      }) as Kaos['glob'],
    });

    const tool = new RunProjectChecksTool(kaos, '/empty');
    const result = await executeTool(tool, context({ checks: ['test'] }));
    const payload = JSON.parse(String(result.output)) as { exitCode: number; summary: string };
    expect(result.isError).toBe(true);
    expect(payload.summary).toContain('Failed to read package.json');
  });

  it('H2: a sibling `tests/` directory does not change how `test/` projects are judged', async () => {
    // The H2 defect: the harness invented a `tests` arg for a bare
    // `node --test` script. Node v24 loads a directory positional as an entry
    // module, so the declared script and the harness run disagree. This pins
    // both halves: the emitted command, and that the *declared* script remains
    // the source of truth whichever sibling directories exist.
    const runs: string[][] = [];
    const exec = vi.fn(async (...args: string[]) => {
      runs.push(args);
      // Present only when the command matches the project's own declaration.
      const ok = args.join(' ') === 'node --test';
      return fakeProcess(ok ? 0 : 1, ok ? 'pass 33\n' : 'no test files found\n');
    });
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async () => JSON.stringify({ name: 'particle-atlas', scripts: { test: 'node --test' } }),
      exec: exec as Kaos['exec'],
      // `test/` exists, `tests/` exists too — the sibling must not matter.
      stat: async () => ({ stMode: 0o040755 }) as never,
    });

    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(tool, context({ checks: ['test'] }));
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ name: string; exitCode: number; command?: string }>;
    };

    expect(runs.some((args) => args.includes('tests'))).toBe(false);
    expect(payload.checks[0]?.command).toBe('node --test');
    expect(payload.exitCode).toBe(0);
  });

  it('H6: a declared canonical name is used verbatim even when a sibling dir looks like the runner', async () => {
    // String matching must not decide anything: the manifest declares `test`,
    // a sibling `vitest` script also exists, and the run still follows the
    // declared script byte for byte.
    const runs: string[][] = [];
    const exec = vi.fn(async (...args: string[]) => {
      runs.push(args);
      return fakeProcess(0, 'pass 3\n');
    });
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async () =>
        JSON.stringify({
          name: 'mixed-runner',
          scripts: { test: 'node --test', vitest: 'vitest run', e2e: 'playwright test' },
        }),
      exec: exec as Kaos['exec'],
      stat: async () => ({ stMode: 0o040755 }) as never,
    });

    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(tool, context({ checks: ['test'] }));
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ name: string; command?: string; provenance?: string }>;
    };

    expect(payload.exitCode).toBe(0);
    expect(payload.checks[0]?.command).toBe('node --test');
    expect(payload.checks[0]?.provenance).toBe('declared');
    expect(runs.every((args) => !args.includes('vitest'))).toBe(true);
  });

  it('H2: a declared test dir missing on disk falls back to bare discovery', async () => {
    const runs: string[][] = [];
    const exec = vi.fn(async (...args: string[]) => {
      runs.push(args);
      return fakeProcess(args.includes('tests') ? 1 : 0, 'ok\n');
    });
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async () =>
        JSON.stringify({ name: 'neon-lock', scripts: { test: 'node --test tests/*.test.js' } }),
      exec: exec as Kaos['exec'],
      // `tests/` is declared but absent; `test/` is where the tests actually are.
      stat: async (path: string) => {
        if (path.includes('tests')) throw new Error('ENOENT');
        return { stMode: 0o040755 } as never;
      },
    });

    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(tool, context({ checks: ['test'] }));
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ name: string; command?: string }>;
    };

    expect(runs.some((args) => args.includes('tests'))).toBe(false);
    expect(payload.checks[0]?.command).toBe('node --test');
    expect(payload.exitCode).toBe(0);
  });

  it('H6: a declared glob spec is passed through verbatim (Node 24 base-dir rewrite fails)', async () => {
    // Real Node 24 behaviour measured on this machine:
    //   node --test 'tests/*.test.js'  -> pass 1, exit 0
    //   node --test tests              -> MODULE_NOT_FOUND, exit 1
    // Collapsing the declared spec to its base directory is what made green
    // projects red, so the assertion below pins the untouched spec.
    expect(buildCommandArgs(undefined, 'test', "node --test 'tests/*.test.js'")).toEqual([
      'node',
      '--test',
      "tests/*.test.js",
    ]);
    expect(buildCommandArgs(undefined, 'test', 'node --test tests/*.test.js', true)).toEqual([
      'node',
      '--test',
      'tests/*.test.js',
    ]);
    // Absent on disk → discovery, never a path Node cannot resolve.
    expect(buildCommandArgs(undefined, 'test', 'node --test tests/*.test.js', false)).toEqual([
      'node',
      '--test',
    ]);

    const runs: string[][] = [];
    const exec = vi.fn(async (...args: string[]) => {
      runs.push(args);
      return fakeProcess(0, 'pass 1\n');
    });
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async () =>
        JSON.stringify({ name: 'glob-declared', scripts: { test: 'node --test tests/*.test.js' } }),
      exec: exec as Kaos['exec'],
      stat: async () => ({ stMode: 0o040755 }) as never,
    });
    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(tool, context({ checks: ['test'] }));
    const payload = JSON.parse(String(result.output)) as {
      checks: Array<{ command?: string; provenance?: string }>;
    };
    expect(runs[0]).toEqual(['node', '--test', 'tests/*.test.js']);
    expect(payload.checks[0]).toMatchObject({
      command: 'node --test tests/*.test.js',
      provenance: 'declared',
    });
  });

  it('buildResultPayload aggregates exit codes', () => {
    const allPass = buildResultPayload([
      { name: 'test', exitCode: 0, durationMs: 10 },
      { name: 'lint', exitCode: 0, durationMs: 5 },
    ]);
    expect(allPass.exitCode).toBe(0);
    expect(allPass.summary).toContain('passed');

    const mixed = buildResultPayload([
      { name: 'test', exitCode: 0, durationMs: 10 },
      { name: 'build', exitCode: 1, durationMs: 20 },
    ]);
    expect(mixed.exitCode).toBe(1);
    expect(mixed.summary).toContain('build');
  });
});
