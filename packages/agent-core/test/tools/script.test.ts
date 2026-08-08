import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { Kaos } from '@superliora/kaos';

import type { Agent } from '../../src/agent/index';
import type { ExecutableToolContext } from '../../src/loop/types';
import { ScriptTool } from '../../src/tools/builtin/shell/script';

function makeCtx(): ExecutableToolContext {
  return {
    turnId: 'turn-1',
    toolCallId: 'call-1',
    signal: new AbortController().signal,
  };
}

function makeKaos(files: Record<string, string> = {}): Kaos {
  return {
    readText: vi.fn(async (path: string) => {
      const hit = files[path];
      if (hit === undefined) throw new Error(`ENOENT: ${path}`);
      return hit;
    }),
    writeText: vi.fn(async (path: string, data: string) => {
      files[path] = data;
      return data.length;
    }),
    glob: vi.fn(async function* () {
      yield* Object.keys(files);
    }),
    exec: vi.fn(async () => ({
      stdout: Readable.from(['hello from exec']),
      stderr: Readable.from(['']),
      wait: async () => 0,
      dispose: async () => {},
    })),
  } as unknown as Kaos;
}

function makeAgent(
  options: {
    type?: 'main' | 'sub';
    spawn?: unknown;
    toolNames?: readonly string[];
    store?: Map<string, unknown>;
  } = {},
): Agent {
  const data = options.store ?? new Map<string, unknown>();
  return {
    type: options.type ?? 'main',
    config: { cwd: '/work' },
    tools: {
      loopTools: (options.toolNames ?? ['Write']).map((name) => ({ name })),
      getStore: () => ({
        get: (key: string) => data.get(key) as never,
        set: (key: string, value: unknown) => {
          data.set(key, value);
        },
      }),
    },
    subagentHost:
      options.spawn !== undefined
        ? { spawn: options.spawn }
        : options.type === 'sub'
          ? null
          : { spawn: vi.fn() },
  } as unknown as Agent;
}

async function runScript(tool: ScriptTool, code: string, timeoutMs = 5_000) {
  const execution = tool.resolveExecution({ code, timeout_ms: timeoutMs });
  if (!('execute' in execution)) throw new Error('unexpected error execution');
  return execution.execute(makeCtx());
}

describe('ScriptTool', () => {
  it('returns the script return value and console output', async () => {
    const tool = new ScriptTool(makeAgent(), makeKaos());

    const result = await runScript(
      tool,
      `console.log('processing', 3, 'files'); return { done: true, count: 3 };`,
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('processing 3 files');
    expect(result.output).toContain('"done": true');
  });

  it('persists store across calls within the same agent', async () => {
    const tool = new ScriptTool(makeAgent(), makeKaos());

    await runScript(tool, `store.seen = (store.seen ?? 0) + 1; return store.seen;`);
    const second = await runScript(tool, `store.seen += 1; return store.seen;`);

    expect(second.output).toContain('2');
  });

  it('persists store across ScriptTool instances via ToolStore', async () => {
    const shared = new Map<string, unknown>();
    const first = new ScriptTool(makeAgent({ store: shared }), makeKaos());
    await runScript(first, `store.seen = 7; return store.seen;`);

    const second = new ScriptTool(makeAgent({ store: shared }), makeKaos());
    const result = await runScript(second, `return store.seen;`);

    expect(result.output).toContain('7');
  });

  it('reads and writes files through kaos with cwd-relative paths', async () => {
    const files = { '/work/a.txt': 'alpha', '/work/b.txt': 'beta' };
    const kaos = makeKaos(files);
    const tool = new ScriptTool(makeAgent(), kaos);

    const result = await runScript(
      tool,
      `
      const a = await read('a.txt');
      const b = await read('b.txt');
      await write('out.txt', a + '+' + b);
      return await read('out.txt');
      `,
    );

    expect(result.output).toContain('alpha+beta');
    expect(kaos.writeText).toHaveBeenCalledWith('/work/out.txt', 'alpha+beta');
  });

  it('exec returns stdout, stderr and exit code', async () => {
    const tool = new ScriptTool(makeAgent(), makeKaos());

    const result = await runScript(tool, `const r = await exec('ls'); return r.stdout.trim();`);

    expect(result.output).toContain('hello from exec');
  });

  it('grep parses rg path:line:text hits', async () => {
    const kaos = makeKaos();
    kaos.exec = vi.fn(async () => ({
      stdout: Readable.from(['src/a.ts:10:foo bar\nsrc/b.ts:3:foo baz\n']),
      stderr: Readable.from(['']),
      wait: async () => 0,
      dispose: async () => {},
    }));
    const tool = new ScriptTool(makeAgent(), kaos);

    const result = await runScript(
      tool,
      `const hits = await grep('foo', '*.ts'); return hits.map(h => h.path + ':' + h.line);`,
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('src/a.ts:10');
    expect(result.output).toContain('src/b.ts:3');
  });

  it('omits write when the profile has no Write tool', async () => {
    const tool = new ScriptTool(makeAgent({ toolNames: ['Read', 'Grep', 'Script'] }), makeKaos());

    const result = await runScript(tool, `await write('x.txt', 'nope'); return 'ok';`);

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/write is not defined/);
  });

  it('agent() fans out subagents programmatically and returns their results', async () => {
    const spawn = vi.fn(async (options: { prompt: string }) => ({
      agentId: `agent-${options.prompt.length}`,
      profileName: 'coder',
      resumed: false,
      completion: Promise.resolve({ result: `done: ${options.prompt}` }),
    }));
    const tool = new ScriptTool(makeAgent({ spawn }), makeKaos());

    const result = await runScript(
      tool,
      `
      const results = await Promise.all(['one', 'two'].map(item => agent(item)));
      return results.join(' | ');
      `,
    );

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(result.output).toContain('done: one | done: two');
  });

  it('agent() is not defined for subagents', async () => {
    const tool = new ScriptTool(makeAgent({ type: 'sub' }), makeKaos());

    const result = await runScript(tool, `return await agent('x');`);

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/agent is not defined/);
  });

  it('kills sync infinite loops at the timeout', async () => {
    const tool = new ScriptTool(makeAgent(), makeKaos());

    const result = await runScript(tool, `while (true) {}`, 200);

    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/Script error/);
  });

  it('surfaces thrown errors as tool errors, not exceptions', async () => {
    const tool = new ScriptTool(makeAgent(), makeKaos());

    const result = await runScript(tool, `throw new Error('boom');`);

    expect(result.isError).toBe(true);
    expect(result.output).toContain('boom');
  });
});
