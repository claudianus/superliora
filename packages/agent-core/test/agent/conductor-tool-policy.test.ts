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
});
