import { describe, expect, it, vi } from 'vitest';
import { buildBuiltinTools } from '../../src/agent/tool/builtin-tools';
import { createBackgroundManager } from './background/helpers';
import { executeTool } from '../tools/fixtures/execute-tool';

describe('standalone conductor tool capability policy', () => {
  it('forces even a foreground-flag Bash call through detached accepted-before-readiness admission', async () => {
    const { agent } = createBackgroundManager();
    Object.defineProperty(agent, 'role', { value: 'interactive-conductor' });
    const readiness = Promise.withResolvers<void>();
    void readiness.promise.catch(() => undefined);
    const ready = vi.spyOn(agent, 'ensureSandboxReady').mockImplementation(() => readiness.promise);
    const bash = buildBuiltinTools({ agent }).get('Bash')!;
    const caller = new AbortController();
    const accepted = await executeTool(bash, { args: { command: 'echo task', run_in_background: false }, signal: caller.signal, turnId: 'turn', toolCallId: 'command' });
    expect(accepted.isError).toBe(false);
    expect(accepted.output).toContain('execution_phase: accepted');
    expect(ready).not.toHaveBeenCalled();
    const repeated = await executeTool(bash, { args: { command: 'echo task', run_in_background: false }, signal: caller.signal, turnId: 'turn', toolCallId: 'command' });
    expect(repeated).toEqual(accepted);
    expect(agent.background.list(false)).toHaveLength(1);
    const conflict = await executeTool(bash, { args: { command: 'echo changed', run_in_background: false }, signal: caller.signal, turnId: 'turn', toolCallId: 'command' });
    expect(conflict.isError).toBe(true);
    const task = agent.background.list(false)[0]!;
    expect(task.detached).toBe(true);
    caller.abort();
    readiness.reject(new Error('Denied by sandbox'));
    await agent.background.waitForActiveTasks(() => true, { timeoutMs: 1000 });
    expect(agent.background.getTask(task.taskId)?.status).toBe('failed');
  });

  it('keeps accepting distinct conductor command ids past the replay dedupe window', async () => {
    const { agent } = createBackgroundManager();
    Object.defineProperty(agent, 'role', { value: 'interactive-conductor' });
    vi.spyOn(agent, 'ensureSandboxReady').mockRejectedValue(new Error('Denied by sandbox'));
    const bash = buildBuiltinTools({ agent }).get('Bash')!;
    const signal = new AbortController().signal;
    for (let index = 0; index < 130; index++) {
      const result = await executeTool(bash, { args: { command: `echo ${String(index)}`, description: `task ${String(index)}` }, signal, turnId: 'turn', toolCallId: `call-${String(index)}` });
      expect(result.isError, result.output as string).toBe(false);
    }
    const replayed = await executeTool(bash, { args: { command: 'echo 129', description: 'task 129' }, signal, turnId: 'turn', toolCallId: 'call-129' });
    expect(replayed.isError).toBe(false);
    await agent.background.waitForActiveTasks(() => true, { timeoutMs: 5000 });
    expect(agent.background.list(false)).toHaveLength(130);
  });
});
