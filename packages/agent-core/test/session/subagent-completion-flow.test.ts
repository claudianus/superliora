import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import { runGit } from '../../src/session/git-context';
import { runPromptTurn } from '../../src/session/subagent/subagent-completion-flow';
import type { RunSubagentOptions } from '../../src/session/subagent/subagent-host-types';

vi.mock('../../src/session/git-context', () => ({ runGit: vi.fn() }));

describe('worker turn sandbox admission', () => {
  it('joins a pending sandbox refresh before the child runs Git or starts its turn', async () => {
    const sandbox = Promise.withResolvers<void>();
    const order: string[] = [];
    vi.mocked(runGit).mockImplementation(async () => { order.push('git'); return { ok: true, stdout: '' }; });
    const child = {
      kaos: {}, config: { cwd: '/work' },
      waitForSandbox: vi.fn(() => sandbox.promise.then(() => { order.push('sandbox'); })),
      turn: { prompt: vi.fn(() => { order.push('turn'); return null; }) },
    } as unknown as Agent;
    const parent = { emitEvent: vi.fn() } as unknown as Agent;
    const options = { prompt: 'work', signal: new AbortController().signal } as unknown as RunSubagentOptions;
    const run = runPromptTurn(parent, 'child', child, 'agent', options);
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(order).toEqual([]);
    sandbox.resolve();
    await expect(run).rejects.toThrow('could not start a turn');
    expect(order).toEqual(['sandbox', 'git', 'git', 'turn']);
  });

  it('fails before any Git when the sandbox cannot activate', async () => {
    vi.mocked(runGit).mockClear();
    const child = {
      kaos: {}, config: { cwd: '/work' },
      waitForSandbox: vi.fn(async () => { throw Object.assign(new Error('Sandbox activation failed'), { code: 'sandbox.unavailable' }); }),
      turn: { prompt: vi.fn() },
    } as unknown as Agent;
    const parent = { emitEvent: vi.fn() } as unknown as Agent;
    const options = { prompt: 'work', signal: new AbortController().signal } as unknown as RunSubagentOptions;
    await expect(runPromptTurn(parent, 'child', child, 'agent', options)).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    expect(runGit).not.toHaveBeenCalled();
    expect(child.turn.prompt).not.toHaveBeenCalled();
  });
});
