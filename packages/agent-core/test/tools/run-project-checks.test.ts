import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { Kaos, KaosProcess } from '@superliora/kaos';

import {
  buildCommandArgs,
  buildResultPayload,
  pickScript,
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
  it('exposes schema and prefers package scripts only', () => {
    expect(RunProjectChecksInputSchema.safeParse({}).success).toBe(true);
    expect(
      RunProjectChecksInputSchema.safeParse({
        checks: ['test', 'lint'],
        packageDir: 'packages/agent-core',
        timeoutMs: 5_000,
      }).success,
    ).toBe(true);
    expect(RunProjectChecksInputSchema.safeParse({ checks: ['unknown'] }).success).toBe(false);

    expect(pickScript('test', { test: 'vitest run' })).toBe('test');
    expect(pickScript('typecheck', { 'type-check': 'tsc -p .' })).toBe('type-check');
    expect(pickScript('smoke', { build: 'tsc' })).toBeUndefined();
    expect(buildCommandArgs(undefined, 'test')).toEqual(['pnpm', 'run', 'test']);
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

  it('skips checks with no matching package.json script', async () => {
    const kaos = createFakeKaos({
      getcwd: () => '/work',
      readText: async () => JSON.stringify({ scripts: { test: 'vitest' } }),
      exec: async () => fakeProcess(0, 'ok\n'),
    });

    const tool = new RunProjectChecksTool(kaos, '/work');
    const result = await executeTool(tool, context({ checks: ['test', 'smoke'] }));
    const payload = JSON.parse(String(result.output)) as {
      exitCode: number;
      checks: Array<{ name: string; skipped?: boolean; reason?: string }>;
    };
    expect(payload.exitCode).toBe(1);
    expect(payload.checks[0]?.name).toBe('test');
    expect(payload.checks[1]).toMatchObject({
      name: 'smoke',
      skipped: true,
    });
    expect(payload.checks[1]?.reason).toContain('No package.json script');
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
