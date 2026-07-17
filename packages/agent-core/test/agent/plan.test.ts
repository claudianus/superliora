import type { ToolCall } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import { createFakeKaos } from '../tools/fixtures/fake-kaos';
import { createCommandKaos, testAgent } from './harness/agent';

function createPlanKaos(overrides: Parameters<typeof createFakeKaos>[0] = {}) {
  return createFakeKaos({
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

describe('manual plan entry', () => {
  it('keeps permission gating out of the PlanMode state object', () => {
    const ctx = testAgent();

    expect('beforeToolCall' in ctx.agent.planMode).toBe(false);
  });

  it('enters plan mode without starting a model turn and prepares the plan directory', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const writeAtomic = vi.fn().mockResolvedValue(undefined);
    const ctx = testAgent({
      kaos: createFakeKaos({ mkdir, writeAtomic }),
    });

    await ctx.rpc.enterPlan({});
    await delay(10);

    expect(ctx.agent.planMode.isActive).toBe(true);
    expect(ctx.agent.planMode.planFilePath).toMatch(/\.md$/);
    expect(mkdir).toHaveBeenCalledWith('/workspace/plan', { parents: true, existOk: true });
    expect(writeAtomic).not.toHaveBeenCalled();
    expect(ctx.allEvents.some((event) => event.event === 'turn.started')).toBe(false);
    expect(ctx.llmCalls).toHaveLength(0);
  });

  it('enters UltraPlan with the phase machine and template active', async () => {
    const writeAtomic = vi.fn(async (_path: string, content: string) => { void content; });
    const ctx = testAgent({
      kaos: createPlanKaos({ writeAtomic }),
    });

    await ctx.agent.planMode.enter(
      'ultra-regression',
      false,
      true,
      true,
      'Build a Galaga-style browser game with visible verification.',
    );

    expect(ctx.agent.planMode.isActive).toBe(true);
    expect(ctx.agent.planMode.isUltraMode).toBe(true);
    expect(ctx.agent.planMode.phase).toBe('research');
    expect(ctx.agent.planMode.interviewRoundCount).toBe(0);
    expect(ctx.agent.planMode.ultraEngine.interviewState.initialContext).toBe(
      'Build a Galaga-style browser game with visible verification.',
    );
    expect(ctx.agent.planMode.planFilePath).toBe('/workspace/plan/ultra-regression.md');
    expect(writeAtomic).toHaveBeenCalledWith(
      '/workspace/plan/ultra-regression.md',
      expect.stringContaining('# Ultra Plan'),
    );
    expect(writeAtomic).toHaveBeenCalledWith(
      '/workspace/plan/ultra-regression.md',
      expect.stringContaining('## Seed Spec'),
    );
    expect(writeAtomic).toHaveBeenCalledWith(
      '/workspace/plan/ultra-regression.md',
      expect.stringContaining('## Evaluation Plan'),
    );
    const enterRecord = ctx.allEvents.find(
      (event) => event.type === '[wire]' && event.event === 'plan_mode.enter',
    );
    expect(enterRecord?.args).toMatchObject({ ultra: true });
  });

  it('derives the no-homedir plan path from cwd on enter and restore', async () => {
    const ctx = testAgent({
      kaos: createPlanKaos({
        writeAtomic: vi.fn(async (_path: string, content: string) => { void content; }),
      }),
    });
    await ctx.agent.planMode.enter('stable-plan');

    const livePath = ctx.agent.planMode.planFilePath;
    if (livePath === null) throw new Error('expected active plan path');
    expect(livePath).toBe('/workspace/plan/stable-plan.md');

    const enterRecord = ctx.allEvents.find(
      (event) => event.type === '[wire]' && event.event === 'plan_mode.enter',
    );
    expect(enterRecord?.args).toEqual({
      id: 'stable-plan',
      time: expect.any(Number),
    });

    const resumed = testAgent({ kaos: createFakeKaos() });
    resumed.dispatch({
      type: 'plan_mode.enter',
      id: 'stable-plan',
    });

    expect(resumed.agent.planMode.planFilePath).toBe(livePath);
  });

  it('enters plan mode through the EnterPlanMode tool and reminds the next step', async () => {
    const enterPlanModeCall: ToolCall = {
      type: 'function',
      id: 'call_enter_plan',
      name: 'EnterPlanMode',
      arguments: '{}',
    };
    const ctx = testAgent({
      kaos: createPlanKaos({
        writeAtomic: vi.fn(async (_path: string, content: string) => { void content; }),
      }),
    });
    ctx.configure({ tools: ['EnterPlanMode'] });
    await ctx.rpc.setPermission({ mode: 'yolo' });

    ctx.mockNextResponse({ type: 'text', text: 'I will enter plan mode.' }, enterPlanModeCall);
    ctx.mockNextResponse({ type: 'text', text: 'Plan mode is active now.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Plan first' }] });

    await ctx.untilTurnEnd();
    await delay(10);
    expect(ctx.agent.planMode.isActive).toBe(true);
    expect(ctx.llmCalls).toHaveLength(2);
    expect(toolResultText(ctx.llmCalls[1]!.history)).toContain('Plan mode is now active');
    await ctx.expectResumeMatches();
  });
});

describe('plan clear', () => {
  it('empties the current plan file without leaving plan mode', async () => {
    const files = new Map<string, string>();
    const mkdir = vi.fn().mockResolvedValue(undefined);
    const readText = vi.fn(async (path: string) => files.get(path) ?? '');
    const writeAtomic = vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return undefined;
    });

    const ctx = testAgent({
      kaos: createPlanKaos({ mkdir, readText, writeAtomic }),
    });
    await ctx.agent.planMode.enter('test-plan', false);

    const planPath = ctx.agent.planMode.planFilePath;
    if (planPath === null) throw new Error('expected active plan path');
    files.set(planPath, '# Plan\n\n- Step 1');

    await ctx.rpc.clearPlan({});

    expect(writeAtomic).toHaveBeenCalledWith(planPath, '');
    expect(files.get(planPath)).toBe('');
    expect(ctx.agent.planMode.isActive).toBe(true);
    expect(ctx.agent.planMode.planFilePath).toBe(planPath);
    await expect(ctx.rpc.getPlan({})).resolves.toMatchObject({
      id: 'test-plan',
      content: '',
      path: planPath,
    });
    await ctx.expectResumeMatches();
  });
});

describe('plan exit tool', () => {
  it('reads the current plan file and exits plan mode directly in auto mode', async () => {
    const files = new Map<string, string>();
    const readText = vi.fn(async (path: string) => files.get(path) ?? '');
    const ctx = testAgent({
      kaos: createPlanKaos({ readText }),
    });
    ctx.configure({ tools: ['ExitPlanMode'] });
    await ctx.rpc.setPermission({ mode: 'auto' });
    await ctx.agent.planMode.enter('test-plan', false);

    const planPath = ctx.agent.planMode.planFilePath;
    if (planPath === null) throw new Error('expected active plan path');
    files.set(planPath, '# Plan\n\n- Inspect\n- Change\n- Verify');

    const exitPlanModeCall: ToolCall = {
      type: 'function',
      id: 'call_exit_plan',
      name: 'ExitPlanMode',
      arguments: '{}',
    };
    ctx.mockNextResponse({ type: 'text', text: 'I will present the plan.' }, exitPlanModeCall);
    ctx.mockNextResponse({ type: 'text', text: 'I can execute after approval.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Show the plan' }] });

    await ctx.untilTurnEnd();
    expect(
      ctx.allEvents.some((event) => event.type === '[rpc]' && event.event === 'requestApproval'),
    ).toBe(false);
    expect(readText).toHaveBeenCalledWith(planPath);
    expect(ctx.agent.planMode.isActive).toBe(false);
    const llmInput = ctx.llmCalls[1]!;
    expect(toolResultText(llmInput.history)).toContain('Plan mode deactivated');
    expect(toolResultText(llmInput.history)).toContain('# Plan');
    await ctx.expectResumeMatches();
  });

  it('stops the turn and stays in plan mode when the user rejects the plan', async () => {
    const files = new Map<string, string>();
    const readText = vi.fn(async (path: string) => files.get(path) ?? '');
    const ctx = testAgent({
      kaos: createPlanKaos({ readText }),
    });
    ctx.configure({ tools: ['ExitPlanMode'] });
    await ctx.rpc.setPermission({ mode: 'manual' });
    await ctx.agent.planMode.enter('reject-plan', false);

    const planPath = ctx.agent.planMode.planFilePath;
    if (planPath === null) throw new Error('expected active plan path');
    files.set(planPath, '# Plan\n\n- Inspect\n- Change\n- Verify');

    const exitPlanModeCall: ToolCall = {
      type: 'function',
      id: 'call_exit_reject',
      name: 'ExitPlanMode',
      arguments: '{}',
    };
    ctx.mockNextResponse({ type: 'text', text: 'I will present the plan.' }, exitPlanModeCall);
    ctx.mockNextResponse({ type: 'text', text: 'This response must not be requested.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Show the plan' }] });

    const approval = await ctx.takeApprovalRequest();
    approval.respond({ decision: 'rejected', selectedLabel: 'Reject' });

    await ctx.untilTurnEnd();
    expect(readText).toHaveBeenCalledWith(planPath);
    expect(ctx.agent.planMode.isActive).toBe(true);
    expect(ctx.llmCalls).toHaveLength(1);
    expect(toolResultText(ctx.agent.context.history)).toContain('Plan rejected by user');
    await ctx.expectResumeMatches();
  });

  it('does not execute later tool calls in the same batch after plan rejection', async () => {
    const files = new Map<string, string>();
    const readText = vi.fn(async (path: string) => files.get(path) ?? '');
    const execWithEnv = vi.fn(() => {
      throw new Error('Bash should not execute after plan rejection');
    });
    const ctx = testAgent({
      kaos: createPlanKaos({ readText, execWithEnv }),
    });
    ctx.configure({ tools: ['ExitPlanMode', 'Bash'] });
    await ctx.rpc.setPermission({ mode: 'yolo' });
    await ctx.agent.planMode.enter('reject-and-exit-plan', false);

    const planPath = ctx.agent.planMode.planFilePath;
    if (planPath === null) throw new Error('expected active plan path');
    files.set(planPath, '# Plan\n\n- Inspect\n- Change\n- Verify');

    const exitPlanModeCall: ToolCall = {
      type: 'function',
      id: 'call_exit_reject_and_exit',
      name: 'ExitPlanMode',
      arguments: '{}',
    };
    const bashCall: ToolCall = {
      type: 'function',
      id: 'call_bash_after_reject',
      name: 'Bash',
      arguments: '{"command":"touch should-not-run","timeout":60}',
    };
    ctx.mockNextResponse(
      { type: 'text', text: 'I will present the plan and then run a command.' },
      exitPlanModeCall,
      bashCall,
    );
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Show the plan' }] });

    const approval = await ctx.takeApprovalRequest();
    approval.respond({ decision: 'rejected', selectedLabel: 'Reject' });

    await ctx.untilTurnEnd();
    expect(ctx.agent.planMode.isActive).toBe(true);
    expect(execWithEnv).not.toHaveBeenCalled();
    expect(ctx.llmCalls).toHaveLength(1);
    expect(toolResultText(ctx.agent.context.history)).toContain('Plan rejected by user');
    expect(toolResultText(ctx.agent.context.history)).toContain(
      'Tool skipped because a previous tool call stopped the turn.',
    );
    await ctx.expectResumeMatches();
  });

  it('refuses to exit when the current plan file is empty', async () => {
    const readText = vi.fn(async () => '');
    const ctx = testAgent({
      kaos: createPlanKaos({ readText }),
    });
    ctx.configure({ tools: ['ExitPlanMode'] });
    await ctx.rpc.setPermission({ mode: 'yolo' });
    await ctx.agent.planMode.enter('empty-plan', false);

    const exitPlanModeCall: ToolCall = {
      type: 'function',
      id: 'call_exit_empty_plan',
      name: 'ExitPlanMode',
      arguments: '{}',
    };
    ctx.mockNextResponse(
      { type: 'text', text: 'I will present the empty plan.' },
      exitPlanModeCall,
    );
    ctx.mockNextResponse({ type: 'text', text: 'I need to write the plan first.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Show an empty plan' }] });

    await ctx.untilTurnEnd();
    expect(ctx.agent.planMode.isActive).toBe(true);
    expect(toolResultText(ctx.llmCalls[1]!.history)).toContain('No plan file found');
    await ctx.expectResumeMatches();
  });
});

describe('plan exit tool options', () => {
  it('keeps options for approval when an option omits the optional description', async () => {
    const files = new Map<string, string>();
    const readText = vi.fn(async (path: string) => files.get(path) ?? '');
    const ctx = testAgent({
      kaos: createPlanKaos({ readText }),
    });
    ctx.configure({ tools: ['ExitPlanMode'] });
    await ctx.rpc.setPermission({ mode: 'manual' });
    await ctx.agent.planMode.enter('options-plan', false);

    const planPath = ctx.agent.planMode.planFilePath;
    if (planPath === null) throw new Error('expected active plan path');
    files.set(planPath, '# Plan\n\n- Inspect\n- Change\n- Verify');

    const exitPlanModeCall: ToolCall = {
      type: 'function',
      id: 'call_exit_options',
      name: 'ExitPlanMode',
        // The second option omits `description` — valid input after the
        // schema relaxation. The approval policy must still surface both.
        arguments: JSON.stringify({
          options: [
            { label: 'Approach A', description: 'Smaller refactor.' },
            { label: 'Approach B' },
          ],
        }),
    };
    ctx.mockNextResponse({ type: 'text', text: 'I will present the plan.' }, exitPlanModeCall);
    ctx.mockNextResponse({ type: 'text', text: 'I can execute after approval.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Show the plan' }] });

    const approval = await ctx.takeApprovalRequest();
    const rpcArgs = (
      ctx.allEvents.find(
        (event) => event.type === '[rpc]' && event.event === 'requestApproval',
      ) as { args: { action?: string; display?: { options?: readonly unknown[] } } } | undefined
    )?.args;

    expect(rpcArgs?.action).toBe('Presenting plan and exiting plan mode');
    expect(rpcArgs?.display?.options).toHaveLength(2);

    approval.respond({ decision: 'approved', selectedLabel: 'Approach A' });
    await ctx.untilTurnEnd();
  });
});

describe('plan allows safe tool flow', () => {
  it.each(['Write', 'Edit'] as const)(
    'runs %s on the active plan file without approval in manual mode',
    async (toolName) => {
      const files = new Map<string, string>();
      const readText = vi.fn(async (path: string) => files.get(path) ?? '');
      const writeAtomic = vi.fn(async (path: string, content: string) => {
        files.set(path, content);
        return undefined;
      });
      const ctx = testAgent({
        kaos: createPlanKaos({ readText, writeAtomic }),
      });
      ctx.configure({ tools: [toolName] });
      await ctx.agent.planMode.enter('test-plan', false);

      const planPath = ctx.agent.planMode.planFilePath;
      if (planPath === null) throw new Error('expected active plan path');
      files.set(planPath, '# Plan\n\n- Draft');

      const expectedContent =
        toolName === 'Write' ? '# Plan\n\n- Inspect\n- Verify' : '# Plan\n\n- Draft\n- Verify';
      const args =
        toolName === 'Write'
          ? { path: planPath, content: expectedContent }
          : { path: planPath, old_string: '- Draft', new_string: '- Draft\n- Verify' };
      const writePlanCall: ToolCall = {
        type: 'function',
        id: `call_${toolName.toLowerCase()}_plan`,
        name: toolName,
          arguments: JSON.stringify(args),
      };

      ctx.mockNextResponse({ type: 'text', text: 'I will update the plan file.' }, writePlanCall);
      ctx.mockNextResponse({ type: 'text', text: 'Plan file updated.' });
      await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Update the plan file' }] });

      await ctx.untilTurnEnd();

      expect(files.get(planPath)).toBe(expectedContent);
      expect(writeAtomic).toHaveBeenCalledWith(planPath, expectedContent);
      expect(
        ctx.allEvents.some((event) => event.type === '[rpc]' && event.event === 'requestApproval'),
      ).toBe(false);
      await ctx.expectResumeMatches();
    },
  );

  it('keeps explicit deny rules above active plan file writes', async () => {
    const files = new Map<string, string>();
    const writeAtomic = vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return undefined;
    });
    const ctx = testAgent({
      kaos: createPlanKaos({ writeAtomic }),
    });
    ctx.configure({ tools: ['Write'] });
    ctx.agent.permission.rules.push({
      decision: 'deny',
      scope: 'user',
      pattern: 'Write',
      reason: 'blocked by test',
    });
    await ctx.agent.planMode.enter('test-plan', false);

    const planPath = ctx.agent.planMode.planFilePath;
    if (planPath === null) throw new Error('expected active plan path');
    const content = '# Plan\n\n- Inspect\n- Verify';
    const writePlanCall: ToolCall = {
      type: 'function',
      id: 'call_write_plan_with_deny',
      name: 'Write',
      arguments: JSON.stringify({ path: planPath, content }),
    };

    ctx.mockNextResponse({ type: 'text', text: 'I will update the plan file.' }, writePlanCall);
    ctx.mockNextResponse({ type: 'text', text: 'Plan file updated.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Update the plan file' }] });

    await ctx.untilTurnEnd();

    expect(files.get(planPath)).toBeUndefined();
    expect(writeAtomic.mock.calls.some(([path]) => path === planPath)).toBe(false);
    expect(toolResultText(ctx.agent.context.history)).toContain(
      'Tool "Write" was denied by permission rule. Reason: blocked by test',
    );
    expect(
      ctx.allEvents.some((event) => event.type === '[rpc]' && event.event === 'requestApproval'),
    ).toBe(false);
  });

  it('allows read-only Bash to continue through permission and execution', async () => {
    const bashCall: ToolCall = {
      type: 'function',
      id: 'call_bash',
      name: 'Bash',
      arguments: '{"command":"printf plan-safe","timeout":60}',
    };
    const ctx = testAgent({ kaos: createCommandKaos('plan-safe') });
    ctx.configure({ tools: ['Bash'] });
    await ctx.rpc.setPermission({ mode: 'yolo' });
    await ctx.agent.planMode.enter('test-plan', false);

    ctx.mockNextResponse({ type: 'text', text: 'I will inspect safely.' }, bashCall);
    ctx.mockNextResponse({ type: 'text', text: 'The safe command printed plan-safe.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Inspect without mutating files' }] });
    expect(await ctx.untilTurnEnd()).toMatchInlineSnapshot(`
      [wire] permission.set_mode         { "mode": "yolo", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 0, "maxContextTokens": 1000000, "contextUsage": 0, "planMode": false, "swarmMode": false, "premiumQualityMode": false, "permission": "yolo", "providerRoute": null, "contextOS": null, "microCompaction": null, "autoDream": null }
      [wire] plan_mode.enter             { "id": "test-plan", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 0, "maxContextTokens": 1000000, "contextUsage": 0, "planMode": true, "swarmMode": false, "premiumQualityMode": false, "permission": "yolo", "providerRoute": null, "contextOS": null, "microCompaction": null, "autoDream": null }
      [wire] turn.prompt                 { "input": [ { "type": "text", "text": "Inspect without mutating files" } ], "origin": { "kind": "user" }, "time": "<time>" }
      [emit] turn.started                { "turnId": 0, "origin": { "kind": "user" } }
      [wire] context.append_message      { "message": { "role": "user", "content": [ { "type": "text", "text": "Inspect without mutating files" } ], "toolCalls": [], "origin": { "kind": "user" } }, "time": "<time>" }
      [wire] context.append_message      { "message": { "role": "user", "content": [ { "type": "text", "text": "<current-time-reminder>" } ], "toolCalls": [], "origin": { "kind": "injection", "variant": "current_time" } }, "time": "<time>" }
      [wire] context.append_message      { "message": { "role": "user", "content": [ { "type": "text", "text": "<plan-mode-reminder>" } ], "toolCalls": [], "origin": { "kind": "injection", "variant": "plan_mode" } }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "step.begin", "uuid": "<uuid-1>", "turnId": "0", "step": 1 }, "time": "<time>" }
      [emit] turn.step.started           { "turnId": 0, "step": 1, "stepId": "<uuid-1>" }
      [emit] assistant.delta             { "turnId": 0, "delta": "I will inspect safely." }
      [emit] tool.call.delta             { "turnId": 0, "toolCallId": "call_bash", "name": "Bash", "argumentsPart": "{\\"command\\":\\"printf plan-safe\\",\\"timeout\\":60}" }
      [wire] context.append_loop_event   { "event": { "type": "content.part", "uuid": "<uuid-2>", "turnId": "0", "step": 1, "stepUuid": "<uuid-1>", "part": { "type": "text", "text": "I will inspect safely." } }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "tool.call", "uuid": "call_bash", "turnId": "0", "step": 1, "stepUuid": "<uuid-1>", "toolCallId": "call_bash", "name": "Bash", "args": { "command": "printf plan-safe", "timeout": 60 }, "description": "Running: printf plan-safe", "display": { "kind": "command", "command": "printf plan-safe", "cwd": "<cwd>", "language": "bash" } }, "time": "<time>" }
      [emit] tool.call.started           { "turnId": 0, "toolCallId": "call_bash", "name": "Bash", "args": { "command": "printf plan-safe", "timeout": 60 }, "description": "Running: printf plan-safe", "display": { "kind": "command", "command": "printf plan-safe", "cwd": "<cwd>", "language": "bash" } }
      [wire] context.append_loop_event   { "event": { "type": "tool.intend", "toolCallId": "call_bash", "name": "Bash", "args": { "command": "printf plan-safe", "timeout": 60 } }, "time": "<time>" }
      [emit] tool.progress               { "turnId": 0, "toolCallId": "call_bash", "update": { "kind": "stdout", "text": "plan-safe" } }
      [wire] context.append_loop_event   { "event": { "type": "tool.ack", "parentUuid": "call_bash", "toolCallId": "call_bash" }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "tool.result", "parentUuid": "call_bash", "toolCallId": "call_bash", "result": { "output": "plan-safe" } }, "time": "<time>" }
      [emit] tool.result                 { "turnId": 0, "toolCallId": "call_bash", "output": "plan-safe" }
      [wire] context.append_loop_event   { "event": { "type": "step.end", "uuid": "<uuid-1>", "turnId": "0", "step": 1, "usage": { "inputOther": 424, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "tool_use", "providerRouteSelection": { "modelAlias": "mock-model", "providerModel": "mock-model" } }, "time": "<time>" }
      [emit] turn.step.completed         { "turnId": 0, "step": 1, "stepId": "<uuid-1>", "usage": { "inputOther": 424, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "tool_use", "providerRouteSelection": { "modelAlias": "mock-model", "providerModel": "mock-model" } }
      [wire] usage.record                { "model": "mock-model", "usage": { "inputOther": 424, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 }, "usageScope": "turn", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 447, "maxContextTokens": 1000000, "contextUsage": 0.000447, "planMode": true, "swarmMode": false, "premiumQualityMode": false, "permission": "yolo", "usage": { "byModel": { "mock-model": { "inputOther": 424, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "total": { "inputOther": 424, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 }, "currentTurn": { "inputOther": 424, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "providerRoute": null, "contextOS": null, "microCompaction": null, "autoDream": null }
      [wire] context.append_loop_event   { "event": { "type": "step.begin", "uuid": "<uuid-3>", "turnId": "0", "step": 2 }, "time": "<time>" }
      [emit] turn.step.started           { "turnId": 0, "step": 2, "stepId": "<uuid-3>" }
      [emit] assistant.delta             { "turnId": 0, "delta": "The safe command printed plan-safe." }
      [wire] context.append_loop_event   { "event": { "type": "content.part", "uuid": "<uuid-4>", "turnId": "0", "step": 2, "stepUuid": "<uuid-3>", "part": { "type": "text", "text": "The safe command printed plan-safe." } }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "step.end", "uuid": "<uuid-3>", "turnId": "0", "step": 2, "usage": { "inputOther": 451, "output": 12, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "end_turn", "providerRouteSelection": { "modelAlias": "mock-model", "providerModel": "mock-model" } }, "time": "<time>" }
      [emit] turn.step.completed         { "turnId": 0, "step": 2, "stepId": "<uuid-3>", "usage": { "inputOther": 451, "output": 12, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "end_turn", "providerRouteSelection": { "modelAlias": "mock-model", "providerModel": "mock-model" } }
      [wire] usage.record                { "model": "mock-model", "usage": { "inputOther": 451, "output": 12, "inputCacheRead": 0, "inputCacheCreation": 0 }, "usageScope": "turn", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 463, "maxContextTokens": 1000000, "contextUsage": 0.000463, "planMode": true, "swarmMode": false, "premiumQualityMode": false, "permission": "yolo", "usage": { "byModel": { "mock-model": { "inputOther": 875, "output": 35, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "total": { "inputOther": 875, "output": 35, "inputCacheRead": 0, "inputCacheCreation": 0 }, "currentTurn": { "inputOther": 875, "output": 35, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "providerRoute": null, "contextOS": null, "microCompaction": null, "autoDream": null }
      [emit] turn.ended                  { "turnId": 0, "reason": "completed" }
    `);
    await ctx.expectResumeMatches();
  });
});

describe('plan mode Bash ordinary permission behavior', () => {
  it('allows Bash through ordinary yolo permission behavior', async () => {
    const bashCall: ToolCall = {
      type: 'function',
      id: 'call_bash',
      name: 'Bash',
      arguments: '{"command":"rm forbidden.txt","timeout":60}',
    };
    const ctx = testAgent({ kaos: createCommandKaos('removed') });
    ctx.configure({ tools: ['Bash'] });
    await ctx.rpc.setPermission({ mode: 'yolo' });
    await ctx.agent.planMode.enter('test-plan', false);

    ctx.mockNextResponse({ type: 'text', text: 'I will mutate a file.' }, bashCall);
    ctx.mockNextResponse({ type: 'text', text: 'The command completed.' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'Remove forbidden.txt' }] });

    expect(await ctx.untilTurnEnd()).toMatchInlineSnapshot(`
      [wire] permission.set_mode         { "mode": "yolo", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 0, "maxContextTokens": 1000000, "contextUsage": 0, "planMode": false, "swarmMode": false, "premiumQualityMode": false, "permission": "yolo", "providerRoute": null, "contextOS": null, "microCompaction": null, "autoDream": null }
      [wire] plan_mode.enter             { "id": "test-plan", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 0, "maxContextTokens": 1000000, "contextUsage": 0, "planMode": true, "swarmMode": false, "premiumQualityMode": false, "permission": "yolo", "providerRoute": null, "contextOS": null, "microCompaction": null, "autoDream": null }
      [wire] turn.prompt                 { "input": [ { "type": "text", "text": "Remove forbidden.txt" } ], "origin": { "kind": "user" }, "time": "<time>" }
      [emit] turn.started                { "turnId": 0, "origin": { "kind": "user" } }
      [wire] context.append_message      { "message": { "role": "user", "content": [ { "type": "text", "text": "Remove forbidden.txt" } ], "toolCalls": [], "origin": { "kind": "user" } }, "time": "<time>" }
      [wire] context.append_message      { "message": { "role": "user", "content": [ { "type": "text", "text": "<current-time-reminder>" } ], "toolCalls": [], "origin": { "kind": "injection", "variant": "current_time" } }, "time": "<time>" }
      [wire] context.append_message      { "message": { "role": "user", "content": [ { "type": "text", "text": "<plan-mode-reminder>" } ], "toolCalls": [], "origin": { "kind": "injection", "variant": "plan_mode" } }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "step.begin", "uuid": "<uuid-1>", "turnId": "0", "step": 1 }, "time": "<time>" }
      [emit] turn.step.started           { "turnId": 0, "step": 1, "stepId": "<uuid-1>" }
      [emit] assistant.delta             { "turnId": 0, "delta": "I will mutate a file." }
      [emit] tool.call.delta             { "turnId": 0, "toolCallId": "call_bash", "name": "Bash", "argumentsPart": "{\\"command\\":\\"rm forbidden.txt\\",\\"timeout\\":60}" }
      [wire] context.append_loop_event   { "event": { "type": "content.part", "uuid": "<uuid-2>", "turnId": "0", "step": 1, "stepUuid": "<uuid-1>", "part": { "type": "text", "text": "I will mutate a file." } }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "tool.call", "uuid": "call_bash", "turnId": "0", "step": 1, "stepUuid": "<uuid-1>", "toolCallId": "call_bash", "name": "Bash", "args": { "command": "rm forbidden.txt", "timeout": 60 }, "description": "Running: rm forbidden.txt", "display": { "kind": "command", "command": "rm forbidden.txt", "cwd": "<cwd>", "language": "bash" } }, "time": "<time>" }
      [emit] tool.call.started           { "turnId": 0, "toolCallId": "call_bash", "name": "Bash", "args": { "command": "rm forbidden.txt", "timeout": 60 }, "description": "Running: rm forbidden.txt", "display": { "kind": "command", "command": "rm forbidden.txt", "cwd": "<cwd>", "language": "bash" } }
      [wire] context.append_loop_event   { "event": { "type": "tool.intend", "toolCallId": "call_bash", "name": "Bash", "args": { "command": "rm forbidden.txt", "timeout": 60 } }, "time": "<time>" }
      [emit] tool.progress               { "turnId": 0, "toolCallId": "call_bash", "update": { "kind": "stdout", "text": "removed" } }
      [wire] context.append_loop_event   { "event": { "type": "tool.ack", "parentUuid": "call_bash", "toolCallId": "call_bash" }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "tool.result", "parentUuid": "call_bash", "toolCallId": "call_bash", "result": { "output": "removed" } }, "time": "<time>" }
      [emit] tool.result                 { "turnId": 0, "toolCallId": "call_bash", "output": "removed" }
      [wire] context.append_loop_event   { "event": { "type": "step.end", "uuid": "<uuid-1>", "turnId": "0", "step": 1, "usage": { "inputOther": 421, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "tool_use", "providerRouteSelection": { "modelAlias": "mock-model", "providerModel": "mock-model" } }, "time": "<time>" }
      [emit] turn.step.completed         { "turnId": 0, "step": 1, "stepId": "<uuid-1>", "usage": { "inputOther": 421, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "tool_use", "providerRouteSelection": { "modelAlias": "mock-model", "providerModel": "mock-model" } }
      [wire] usage.record                { "model": "mock-model", "usage": { "inputOther": 421, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 }, "usageScope": "turn", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 444, "maxContextTokens": 1000000, "contextUsage": 0.000444, "planMode": true, "swarmMode": false, "premiumQualityMode": false, "permission": "yolo", "usage": { "byModel": { "mock-model": { "inputOther": 421, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "total": { "inputOther": 421, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 }, "currentTurn": { "inputOther": 421, "output": 23, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "providerRoute": null, "contextOS": null, "microCompaction": null, "autoDream": null }
      [wire] context.append_loop_event   { "event": { "type": "step.begin", "uuid": "<uuid-3>", "turnId": "0", "step": 2 }, "time": "<time>" }
      [emit] turn.step.started           { "turnId": 0, "step": 2, "stepId": "<uuid-3>" }
      [emit] assistant.delta             { "turnId": 0, "delta": "The command completed." }
      [wire] context.append_loop_event   { "event": { "type": "content.part", "uuid": "<uuid-4>", "turnId": "0", "step": 2, "stepUuid": "<uuid-3>", "part": { "type": "text", "text": "The command completed." } }, "time": "<time>" }
      [wire] context.append_loop_event   { "event": { "type": "step.end", "uuid": "<uuid-3>", "turnId": "0", "step": 2, "usage": { "inputOther": 447, "output": 9, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "end_turn", "providerRouteSelection": { "modelAlias": "mock-model", "providerModel": "mock-model" } }, "time": "<time>" }
      [emit] turn.step.completed         { "turnId": 0, "step": 2, "stepId": "<uuid-3>", "usage": { "inputOther": 447, "output": 9, "inputCacheRead": 0, "inputCacheCreation": 0 }, "finishReason": "end_turn", "providerRouteSelection": { "modelAlias": "mock-model", "providerModel": "mock-model" } }
      [wire] usage.record                { "model": "mock-model", "usage": { "inputOther": 447, "output": 9, "inputCacheRead": 0, "inputCacheCreation": 0 }, "usageScope": "turn", "time": "<time>" }
      [emit] agent.status.updated        { "model": "mock-model", "contextTokens": 456, "maxContextTokens": 1000000, "contextUsage": 0.000456, "planMode": true, "swarmMode": false, "premiumQualityMode": false, "permission": "yolo", "usage": { "byModel": { "mock-model": { "inputOther": 868, "output": 32, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "total": { "inputOther": 868, "output": 32, "inputCacheRead": 0, "inputCacheCreation": 0 }, "currentTurn": { "inputOther": 868, "output": 32, "inputCacheRead": 0, "inputCacheCreation": 0 } }, "providerRoute": null, "contextOS": null, "microCompaction": null, "autoDream": null }
      [emit] turn.ended                  { "turnId": 0, "reason": "completed" }
    `);
    expect(toolResultText(ctx.agent.context.history)).toContain('removed');
    await ctx.expectResumeMatches();
  });
});

describe('plan mode injection cadence', () => {
  it('dedupes immediate repeats and emits sparse reminders after assistant turns', async () => {
    const ctx = testAgent();
    ctx.configure();
    await ctx.agent.planMode.enter('test-plan', false);

    await ctx.agent.injection.inject();
    const afterFull = ctx.agent.context.history.length;
    expect(lastUserText(ctx.agent.context.history)).toContain('Plan mode is active');
    expect(lastUserText(ctx.agent.context.history)).toContain('Plan file:');

    await ctx.agent.injection.inject();
    expect(ctx.agent.context.history).toHaveLength(afterFull);

    ctx.appendAssistantTurn(1, 'assistant one');
    ctx.appendAssistantTurn(2, 'assistant two');
    await ctx.agent.injection.inject();

    expect(lastUserText(ctx.agent.context.history)).toContain('Plan mode still active');
    expect(lastUserText(ctx.agent.context.history)).toContain('Plan file:');
    await ctx.expectResumeMatches();
  });

  it('emits a reentry reminder when restored plan mode already has plan content', async () => {
    const ctx = testAgent({
      kaos: createFakeKaos({
        readText: vi.fn(async () => '# Existing Plan\n\n- Keep this context'),
      }),
    });
    ctx.configure();
    ctx.dispatch({
      type: 'plan_mode.enter',
      id: 'restored-plan',
    });

    await ctx.agent.injection.inject();

    expect(lastUserText(ctx.agent.context.history)).toContain('Re-entering Plan Mode');
    expect(lastUserText(ctx.agent.context.history)).toContain('Read the existing plan file');
    await ctx.expectResumeMatches();
  });

  it('emits one exit reminder after leaving plan mode', async () => {
    const ctx = testAgent();
    ctx.configure();
    await ctx.agent.planMode.enter('test-plan', false);
    await ctx.agent.injection.inject();

    ctx.agent.planMode.exit();
    await ctx.agent.injection.inject();
    const afterExit = ctx.agent.context.history.length;
    expect(lastUserText(ctx.agent.context.history)).toContain('Plan mode is no longer active');

    await ctx.agent.injection.inject();
    expect(ctx.agent.context.history).toHaveLength(afterExit);
    await ctx.expectResumeMatches();
  });

  it('keeps the preserved injection index aligned after undo removes earlier messages', async () => {
    const ctx = testAgent();
    ctx.configure();
    await ctx.agent.planMode.enter('test-plan', false);

    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'draft the plan' }]);
    await ctx.agent.injection.inject();
    ctx.appendAssistantTurn(1, 'Plan drafted.');

    ctx.agent.context.undo(1);
    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'new plan request' }]);
    await ctx.agent.injection.inject();

    expect(lastUserText(ctx.agent.context.history)).toContain('Plan mode is active');
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastUserText(history: readonly { role: string; content: readonly unknown[] }[]): string {
  const message = history.findLast((item) => item.role === 'user');
  if (message === undefined) return '';
  return message.content
    .map((part) => {
      if (
        part !== null &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text'
      ) {
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .join('');
}

function toolResultText(history: readonly { role: string; content: readonly unknown[] }[]): string {
  return history
    .filter((message) => message.role === 'tool')
    .flatMap((message) => message.content)
    .map((part) => {
      if (
        part !== null &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text'
      ) {
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .join('\n');
}
