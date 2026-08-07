import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { testKaos } from '../fixtures/test-kaos';
import {
  APIProviderRateLimitError,
  APIStatusError,
  emptyUsage,
  type Message,
  type ToolCall,
  type TokenUsage,
} from '@superliora/kosong';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent, AgentOptions } from '../../src/agent';
import { FLAG_DEFINITIONS, FlagResolver } from '../../src/flags';
import { AGENT_WIRE_PROTOCOL_VERSION, InMemoryAgentRecordPersistence } from '../../src/agent/records';
import type { ResolvedAgentProfile } from '../../src/profile';
import type { SDKSessionRPC } from '../../src/rpc';
import {
  readSubagentCheckpoint,
  writeSubagentCheckpoint,
} from '../../src/session/subagent/subagent-checkpoint';
import {
  getDefaultSwarmFileLeaseRegistry,
  normalizeLeasePath,
  resetDefaultSwarmFileLeaseRegistry,
} from '#/fleet';
import { Session } from '../../src/session';
import { collectGitContext } from '../../src/session/git-context';
import {
  DEFAULT_SUBAGENT_DEADLINE_MS,
  SUBAGENT_DEADLINE_ENV,
  SessionSubagentHost,
  SubagentDeadlineError,
  SubagentMaxTokensError,
  describeSubagentToolDetail,
  isSubagentDeadlineError,
  isSubagentMaxTokensError,
  resolveSubagentDeadlineMs,
  type QueuedSubagentTask,
  type RunSubagentOptions,
} from '../../src/session/subagent/subagent-host';
import {
  attachToolStreamBridge,
  startProgressReporter,
} from '../../src/session/subagent/subagent-telemetry';
import * as subagentCompletionFlow from '../../src/session/subagent/subagent-completion-flow';
import { abortError, userCancellationReason } from '../../src/utils/abort';
import { testAgent, type AgentTestContext } from '../agent/harness/agent';
import { createScriptedGenerate } from '../agent/harness/scripted-generate';
import { createFakeKaos } from '../tools/fixtures/fake-kaos';
import { executeTool } from '../tools/fixtures/execute-tool';

// Git context collection is exercised in git-context.test.ts; here it is
// mocked so subagent-host tests stay deterministic and assert only the
// wiring (explore subagents get the block prepended, others do not).
vi.mock('../../src/session/git-context', () => ({
  collectGitContext: vi.fn(async () => ''),
  runGit: vi.fn(async () => ({ ok: false, kind: 'spawn-error' })),
}));

const signal = new AbortController().signal;
const tempDirs: string[] = [];
type GenerateFn = NonNullable<AgentOptions['generate']>;

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('SessionSubagentHost', () => {
  it('emits a suspended event for a requeued child', () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();
    const child = testAgent();
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    host.suspended({
      task: queuedTask(1),
      agentId: 'agent-0',
      reason: 'Provider rate limit; subagent requeued for retry.',
    });

    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.suspended',
        args: expect.objectContaining({
          subagentId: 'agent-0',
          reason: 'Provider rate limit; subagent requeued for retry.',
        }),
      }),
    );
  });

  it('runQueued suppresses raw live Aborted failures from queued attempts', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const controller = new AbortController();
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const running = host.runQueued([{ ...queuedTask(1), signal: controller.signal }]);
    void running.catch(() => {});

    await child.untilApprovalRequest();
    controller.abort(abortError());
    await expect(running).rejects.toThrow('Aborted');
    await child.untilTurnEnd();

    expect(parent.allEvents).not.toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.failed',
        args: expect.objectContaining({
          error: 'Aborted',
        }),
      }),
    );
  });

  it('steerRunningChildren forwards a steer into a running child turn', async () => {
    const parent = testAgent();
    parent.configure();

    const controller = new AbortController();
    const childPersistence = new InMemoryAgentRecordPersistence();
    const child = testAgent({ persistence: childPersistence });
    child.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const running = host.runQueued([{ ...queuedTask(1), signal: controller.signal }]);
    void running.catch(() => {});

    // The child is now mid-turn, blocked on the Bash approval request.
    await child.untilApprovalRequest();
    expect(child.agent.turn.hasActiveTurn).toBe(true);

    const forwarded = host.steerRunningChildren([{ type: 'text', text: 'redirect left' }]);
    expect(forwarded).toBe(1);

    // The steer reached the child's turn (buffered for its next step boundary).
    expect(
      childPersistence.records.some(
        (record) => record.type === 'turn.steer' && JSON.stringify(record).includes('redirect left'),
      ),
    ).toBe(true);

    controller.abort(abortError());
    await expect(running).rejects.toThrow('Aborted');
    await child.untilTurnEnd();
  });

  it('steerRunningChildren skips children that are not running a turn', () => {
    const parent = testAgent();
    parent.configure();
    const child = testAgent();
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    // No active children registered, so nothing receives the steer.
    expect(host.steerRunningChildren([{ type: 'text', text: 'redirect left' }])).toBe(0);
  });

  it('fires subagent lifecycle hooks around the child turn', async () => {
    const child = testAgent();
    const calls: Array<{ readonly event: string; readonly childLlmCallCount: number }> = [];
    const trigger = vi.fn(async (event: string, _args?: unknown) => {
      calls.push({ event, childLlmCallCount: child.llmCalls.length });
      return [];
    });
    const fireAndForgetTrigger = vi.fn((event: string) => {
      calls.push({ event, childLlmCallCount: child.llmCalls.length });
      return Promise.resolve([]);
    });
    const parent = testAgent({
      hookEngine: { trigger, fireAndForgetTrigger } as unknown as NonNullable<Agent['hooks']>,
    });
    parent.configure();
    parent.newEvents();

    const summary =
      'Implemented the subagent task completely and returned a detailed enough summary for the parent agent to continue confidently without repeating the child agent work. '.repeat(
        2,
      );
    child.mockNextResponse({ type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Implement the fix',
      description: 'Fix bug',
      runInBackground: false,
      signal,
    });
    await handle.completion;

    const startArgs = trigger.mock.calls[0]?.[1];
    expect(trigger.mock.calls[0]?.[0]).toBe('SubagentStart');
    expect(startArgs).toMatchObject({
      matcherValue: 'coder',
      inputData: {
        agentName: 'coder',
        prompt: 'Implement the fix',
      },
    });
    expect((startArgs as { readonly signal?: unknown } | undefined)?.signal).toBeInstanceOf(
      AbortSignal,
    );
    expect(fireAndForgetTrigger).toHaveBeenCalledWith('SubagentStop', {
      matcherValue: 'coder',
      inputData: {
        agentName: 'coder',
        response: summary.trim(),
      },
    });
    expect(calls).toEqual([
      { event: 'SubagentStart', childLlmCallCount: 0 },
      { event: 'SubagentStop', childLlmCallCount: 1 },
    ]);
  });

  it('ignores blocking results from subagent lifecycle hooks', async () => {
    const trigger = vi.fn(async () => [{ action: 'block', reason: 'observer only' }]);
    const fireAndForgetTrigger = vi.fn(() => Promise.resolve([{ action: 'block' }]));
    const parent = testAgent({
      hookEngine: { trigger, fireAndForgetTrigger } as unknown as NonNullable<Agent['hooks']>,
    });
    parent.configure();
    parent.newEvents();

    const summary =
      'Completed the subagent task with enough implementation detail and verification context for the parent agent to continue without repeating the work. '.repeat(
        2,
      );
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Implement the fix',
      description: 'Fix bug',
      runInBackground: false,
      signal,
    });

    const completion = await handle.completion;
    expect(completion.result).toBe(summary.trim());
    expect(completion.contract).toMatchObject({
      status: 'completed',
      profile: 'coder',
      files_changed: [],
      verification: { tests: 'not_run', typecheck: 'not_run', lint: 'not_run' },
    });
    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.completed',
        args: expect.objectContaining({ subagentId: 'agent-0' }),
      }),
    );
    expect(parent.allEvents).not.toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.failed',
      }),
    );
  });

  it('emits subagent.progress on an interval and subagent.stalled after a silent window', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();
    const child = testAgent();
    fakeSession(parent.agent, child.agent);

    vi.useFakeTimers();
    try {
      const reporter = startProgressReporter(
        parent.agent,
        child.agent,
        'agent-0',
        'coder',
        600_000,
      );

      vi.advanceTimersByTime(5_000);
      expect(parent.allEvents).toContainEqual(
        expect.objectContaining({
          type: '[rpc]',
          event: 'subagent.progress',
          args: expect.objectContaining({
            subagentId: 'agent-0',
            subagentName: 'coder',
            toolCount: 0,
            budgetMs: 600_000,
            budgetRemainingMs: 595_000,
            finishing: false,
          }),
        }),
      );

      vi.advanceTimersByTime(300_000);
      expect(parent.allEvents).toContainEqual(
        expect.objectContaining({
          type: '[rpc]',
          event: 'subagent.stalled',
          args: expect.objectContaining({ subagentId: 'agent-0' }),
        }),
      );
      reporter();
    } finally {
      vi.useRealTimers();
    }
  });

  it('mirrors child tool events as truncated subagent.tool_call / subagent.tool_result', () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();
    const child = testAgent();
    fakeSession(parent.agent, child.agent);
    const options: RunSubagentOptions = {
      parentToolCallId: 'tc-1',
      prompt: 'work',
      description: 'test subagent',
      runInBackground: true,
      signal,
    };
    const dispose = attachToolStreamBridge(
      parent.agent,
      child.agent,
      'agent-0',
      'coder',
      options,
    );

    try {
      child.agent.emitEvent({
        type: 'tool.call.started',
        turnId: 1,
        toolCallId: 'call-1',
        name: 'Edit',
        args: { path: 'src/a.ts', blob: 'x'.repeat(600) },
      });
      const callEvent = parent.allEvents.find(
        (entry) => entry.type === '[rpc]' && entry.event === 'subagent.tool_call',
      );
      expect(callEvent?.args).toEqual(
        expect.objectContaining({
          subagentId: 'agent-0',
          subagentName: 'coder',
          parentToolCallId: 'tc-1',
          toolCallId: 'call-1',
          name: 'Edit',
        }),
      );
      const argsPreview = (callEvent?.args as { argsPreview?: string } | undefined)?.argsPreview;
      expect(argsPreview).toContain('src/a.ts');
      expect(argsPreview?.length).toBeLessThanOrEqual(400);
      // Single-line preview: the JSON args are flattened, not multi-line.
      expect(argsPreview).not.toContain('\n');

      child.agent.emitEvent({
        type: 'tool.result',
        turnId: 1,
        toolCallId: 'call-1',
        output: `failed: ${'y'.repeat(700)}`,
        isError: true,
      });
      const resultEvent = parent.allEvents.find(
        (entry) => entry.type === '[rpc]' && entry.event === 'subagent.tool_result',
      );
      expect(resultEvent?.args).toEqual(
        expect.objectContaining({
          subagentId: 'agent-0',
          toolCallId: 'call-1',
          name: 'Edit',
          isError: true,
        }),
      );
      const resultPreview = (resultEvent?.args as { resultPreview?: string } | undefined)
        ?.resultPreview;
      expect(resultPreview).toContain('failed:');
      expect(resultPreview?.length).toBeLessThanOrEqual(500);
    } finally {
      dispose();
    }

    // Disposed bridge stops mirroring child events onto the parent.
    parent.newEvents();
    child.agent.emitEvent({
      type: 'tool.call.started',
      turnId: 1,
      toolCallId: 'call-2',
      name: 'Read',
      args: {},
    });
    expect(parent.newEvents()).not.toContainEqual(
      expect.objectContaining({ type: '[rpc]', event: 'subagent.tool_call' }),
    );
  });

  it('attaches structured detail to subagent.tool_call from the full child args', () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();
    const child = testAgent();
    fakeSession(parent.agent, child.agent);
    const options: RunSubagentOptions = {
      parentToolCallId: 'tc-1',
      prompt: 'work',
      description: 'test subagent',
      runInBackground: true,
      signal,
    };
    const dispose = attachToolStreamBridge(
      parent.agent,
      child.agent,
      'agent-0',
      'coder',
      options,
    );

    try {
      child.agent.emitEvent({
        type: 'tool.call.started',
        turnId: 1,
        toolCallId: 'call-1',
        name: 'Edit',
        args: { path: 'src/a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' },
      });
      child.agent.emitEvent({
        type: 'tool.call.started',
        turnId: 1,
        toolCallId: 'call-2',
        name: 'FetchURL',
        args: { url: 'https://example.com' },
      });
      const events = parent.allEvents.filter(
        (entry) => entry.type === '[rpc]' && entry.event === 'subagent.tool_call',
      );
      const editArgs = events[0]?.args as { detail?: unknown } | undefined;
      expect(editArgs?.detail).toEqual({
        kind: 'edit',
        path: 'src/a.ts',
        addedLines: 2,
        removedLines: 1,
      });
      // Unknown tools carry no detail (payload stays additive).
      const fetchArgs = events[1]?.args as { detail?: unknown } | undefined;
      expect(fetchArgs?.detail).toBeUndefined();
    } finally {
      dispose();
    }
  });

  describe('describeSubagentToolDetail', () => {
    it('counts edit line diffs from old_string / new_string', () => {
      expect(
        describeSubagentToolDetail('Edit', {
          path: 'src/a.ts',
          old_string: 'a\nb',
          new_string: 'a\nc\nd',
        }),
      ).toEqual({ kind: 'edit', path: 'src/a.ts', addedLines: 2, removedLines: 1 });
      // Pure insertion against an empty old_string.
      expect(
        describeSubagentToolDetail('Edit', { path: 'src/a.ts', new_string: 'x\ny' }),
      ).toEqual({ kind: 'edit', path: 'src/a.ts', addedLines: 2, removedLines: 0 });
    });

    it('counts write lines and bytes', () => {
      expect(
        describeSubagentToolDetail('Write', { path: 'src/w.ts', content: 'a\nb\n' }),
      ).toEqual({ kind: 'write', path: 'src/w.ts', lines: 2, bytes: 4 });
      expect(describeSubagentToolDetail('Write', { path: 'src/w.ts', content: '' })).toEqual({
        kind: 'write',
        path: 'src/w.ts',
        lines: 0,
        bytes: 0,
      });
    });

    it('keeps read paths, flattens and caps bash commands', () => {
      expect(describeSubagentToolDetail('Read', { path: 'src/r.ts' })).toEqual({
        kind: 'read',
        path: 'src/r.ts',
      });
      const command = `pnpm test ${'x'.repeat(200)}`;
      const detail = describeSubagentToolDetail('Bash', { command });
      expect(detail?.kind).toBe('bash');
      if (detail?.kind === 'bash') {
        expect(detail.command).not.toContain('\n');
        expect(detail.command.length).toBeLessThanOrEqual(120);
        expect(detail.command.endsWith('…')).toBe(true);
      }
      expect(
        describeSubagentToolDetail('Bash', { command: 'pnpm\n  test' }),
      ).toEqual({ kind: 'bash', command: 'pnpm test' });
    });

    it('maps Grep and Glob to the search variant', () => {
      expect(describeSubagentToolDetail('Grep', { pattern: 'foo.*' })).toEqual({
        kind: 'search',
        pattern: 'foo.*',
      });
      expect(describeSubagentToolDetail('Glob', { pattern: '**/*.ts' })).toEqual({
        kind: 'search',
        pattern: '**/*.ts',
      });
    });

    it('returns undefined for unknown tools and missing args', () => {
      expect(describeSubagentToolDetail('FetchURL', { url: 'https://example.com' })).toBeUndefined();
      expect(describeSubagentToolDetail('Edit', {})).toBeUndefined();
      expect(describeSubagentToolDetail('Edit', null)).toBeUndefined();
      expect(describeSubagentToolDetail('Bash', { command: '   ' })).toBeUndefined();
    });
  });

  it('enters finishing mode when the budget window is reached', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();
    const child = testAgent();
    fakeSession(parent.agent, child.agent);

    vi.useFakeTimers();
    try {
      const reporter = startProgressReporter(
        parent.agent,
        child.agent,
        'agent-0',
        'coder',
        360_000,
      );

      // 60s elapsed leaves exactly the 5-minute finishing window.
      vi.advanceTimersByTime(60_000);
      expect(parent.allEvents).toContainEqual(
        expect.objectContaining({
          type: '[rpc]',
          event: 'subagent.progress',
          args: expect.objectContaining({ finishing: true, budgetRemainingMs: 300_000 }),
        }),
      );
      expect(JSON.stringify(child.agent.context.history)).toContain('finishing mode');
      reporter();
    } finally {
      vi.useRealTimers();
    }
  });

  it('injects the recovered checkpoint reminder on resume and consumes it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'subagent-resume-'));
    const previousHome = process.env['SUPERLIORA_HOME'];
    process.env['SUPERLIORA_HOME'] = home;
    try {
      writeSubagentCheckpoint('agent-0', {
        toolCount: 12,
        lastTool: 'Edit',
        lastTarget: 'src/a.ts',
        tokens: 5_000,
        elapsedMs: 900_000,
        todos: [
          { title: 'fix bug', status: 'done' },
          { title: 'add test', status: 'pending' },
        ],
        dirtyFiles: ['src/a.ts'],
      });

      const parent = testAgent();
      parent.configure();
      parent.newEvents();
      const child = testAgent();
      child.configure();
      child.mockNextResponse({
        type: 'text',
        text:
          'Resumed from the recovered checkpoint. Verified the state of the earlier work first, ' +
          'ran the scoped verification for the touched package, and finished the remaining implementation ' +
          'without repeating any of the steps recorded in the checkpoint snapshot.',
      });
      const session = fakeSession(parent.agent, child.agent, {
        'agent-0': {
          homedir: '/tmp/kimi-session/agents/agent-0',
          type: 'sub',
          parentAgentId: 'main',
        },
      });
      const host = new SessionSubagentHost(session, 'main');

      const handle = await host.resume('agent-0', {
        parentToolCallId: 'call-1',
        prompt: 'Continue',
        description: 'cont',
        runInBackground: false,
        signal: new AbortController().signal,
      });
      await handle.completion;

      const historyText = JSON.stringify(child.llmCalls[0]?.history ?? []);
      expect(historyText).toContain('checkpoint from the previous run');
      expect(historyText).toContain('[done] fix bug');
      expect(readSubagentCheckpoint('agent-0')).toBeUndefined();
    } finally {
      if (previousHome === undefined) delete process.env['SUPERLIORA_HOME'];
      else process.env['SUPERLIORA_HOME'] = previousHome;
      await rm(home, { recursive: true, force: true });
    }
  });

  const leaseSummary =
    'Completed the owned-file task end to end: implemented the change, ran the scoped verification, ' +
    'and wrote the structured summary so the parent can integrate the result mechanically without ' +
    're-reading the whole run transcript or re-running any of the completed steps.';

  it('claims declared ownership at spawn and releases it on completion', async () => {
    resetDefaultSwarmFileLeaseRegistry();
    try {
      const parent = testAgent();
      parent.configure();
      parent.newEvents();
      const child = testAgent();
      child.configure();
      child.mockNextResponse({ type: 'text', text: leaseSummary });
      const session = fakeSession(parent.agent, child.agent);
      const host = new SessionSubagentHost(session, 'main');

      const handle = await host.spawn({
        profileName: 'coder',
        parentToolCallId: 'call-lease',
        prompt: 'Own a file',
        description: 'lease',
        runInBackground: false,
        signal: new AbortController().signal,
        ownership: ['src/owned.ts'],
      });
      const registry = getDefaultSwarmFileLeaseRegistry();
      expect(registry.holder(normalizeLeasePath('src/owned.ts'))?.ownerId).toBe(handle.agentId);

      await handle.completion;
      expect(registry.holder(normalizeLeasePath('src/owned.ts'))).toBeUndefined();
    } finally {
      resetDefaultSwarmFileLeaseRegistry();
    }
  });

  it('blocks fan-out when declared ownership overlaps another owner', async () => {
    resetDefaultSwarmFileLeaseRegistry();
    try {
      getDefaultSwarmFileLeaseRegistry().claim('src/shared.ts', 'other-owner', 'other-run');

      const parent = testAgent();
      parent.configure();
      parent.newEvents();
      const child = testAgent();
      child.configure();
      const session = fakeSession(parent.agent, child.agent);
      const host = new SessionSubagentHost(session, 'main');

      await expect(
        host.spawn({
          profileName: 'coder',
          parentToolCallId: 'call-conflict',
          prompt: 'Overlap',
          description: 'conflict',
          runInBackground: false,
          signal: new AbortController().signal,
          ownership: ['src/shared.ts'],
        }),
      ).rejects.toThrow(/Ownership conflict/);
    } finally {
      resetDefaultSwarmFileLeaseRegistry();
    }
  });

  it('emits subagent.todo.updated when a child updates its todo store', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const summary =
      'Completed the subagent task with enough implementation detail and verification context for the parent agent to continue without repeating the work. '.repeat(
        2,
      );
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_swarm',
      prompt: 'Implement the fix',
      description: 'Fix bug',
      runInBackground: false,
      signal,
    });

    await vi.waitFor(() => {
      expect(
        parent.allEvents.some(
          (entry) => entry.type === '[rpc]' && entry.event === 'subagent.started',
        ),
      ).toBe(true);
    });
    child.agent.tools.updateStore('todo', [{ title: 'Inspect files', status: 'in_progress' }]);
    await handle.completion;

    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.todo.updated',
        args: expect.objectContaining({
          subagentId: 'agent-0',
          parentToolCallId: 'call_swarm',
          todos: [{ title: 'Inspect files', status: 'in_progress' }],
        }),
      }),
    );
  });

  it('marks a queued child ready when the model emits thinking output', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const child = testAgent();
    const summary =
      'Completed the delegated subagent task with enough concrete detail for the parent agent to continue without repeating the work. '.repeat(
        2,
      );
    child.mockNextResponse({ type: 'think', think: 'I can start.' }, { type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');
    const onReady = vi.fn();

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Implement the fix',
      description: 'Fix bug',
      runInBackground: false,
      signal,
      onReady,
    });

    await vi.waitFor(() => {
      expect(onReady).toHaveBeenCalledTimes(1);
    });
    await expect(handle.completion).resolves.toMatchObject({ result: summary.trim() });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('runs a child agent turn and returns the last assistant text', async () => {
    const telemetryTrack = vi.fn();
    const parent = testAgent({ telemetry: { track: telemetryTrack } });
    parent.configure();
    await parent.rpc.setPermission({ mode: 'yolo' });
    parent.agent.permission.rules.splice(0, parent.agent.permission.rules.length, {
      decision: 'allow',
      scope: 'session-runtime',
      pattern: 'Read',
    });
    parent.newEvents();

    const child = testAgent({
      type: 'sub',
      permission: { parent: parent.agent.permission },
    });
    child.mockNextResponse({ type: 'text', text: 'Investigated the request and completed the child task end to end. The relevant module was located, its behavior traced through every call site, and the requested change applied and verified against the existing test suite.' });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'explore',
      parentToolCallId: 'call_agent',
      prompt: 'Find the cause',
      description: 'Find cause',
      runInBackground: false,
      signal,
    });

    await expect(handle.completion).resolves.toMatchObject({
      result: 'Investigated the request and completed the child task end to end. The relevant module was located, its behavior traced through every call site, and the requested change applied and verified against the existing test suite.',
    });
    expect(handle.agentId).toBe('agent-0');
    expect(handle.profileName).toBe('explore');

    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.spawned',
        args: expect.objectContaining({
          subagentId: 'agent-0',
          subagentName: 'explore',
          parentAgentId: 'main',
          parentToolCallId: 'call_agent',
        }),
      }),
    );
    expect(telemetryTrack).toHaveBeenCalledWith('subagent_created', {
      subagent_name: 'explore',
      run_in_background: false,
    });
    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.completed',
        args: expect.objectContaining({
          subagentId: 'agent-0',
          resultSummary: 'Investigated the request and completed the child task end to end. The relevant module was located, its behavior traced through every call site, and the requested change applied and verified against the existing test suite.',
        }),
      }),
    );
    expect(child.agent.config.data()).toMatchObject({
      cwd: parent.agent.config.cwd,
      provider: parent.agent.config.data().provider,
      profileName: 'explore',
      thinkingLevel: parent.agent.config.thinkingLevel,
    });
    expect(child.agent.config.systemPrompt).toContain('codebase exploration specialist');
    expect(child.agent.permission.mode).toBe('yolo');
    expect(child.agent.permission.rules).toEqual([]);
    expect(child.agent.permission.data().rules).toEqual(parent.agent.permission.rules);
    expect(child.llmCalls[0]?.systemPrompt).toContain('codebase exploration specialist');
    expect(child.llmCalls[0]?.tools.map((tool) => tool.name).toSorted()).toEqual([
      'Bash',
      'GetCurrentTime',
      'Glob',
      'Grep',
      'Read',
      'ReadMediaFile',
      'RepoQuery',
      'SearchTools',
      'TodoList',
    ]);
    expect(userTextMessages(child.llmCalls[0]?.history ?? [])).toEqual(['Find the cause']);
  });

  it('resolves expert catalog ids as named subagent profiles', async () => {
    const telemetryTrack = vi.fn();
    const parent = testAgent({ telemetry: { track: telemetryTrack } });
    parent.configure();
    await parent.rpc.setPermission({ mode: 'yolo' });
    parent.newEvents();

    const child = testAgent({
      type: 'sub',
      permission: { parent: parent.agent.permission },
    });
    const summary =
      'Applied the anthropologist expert perspective to the delegated launch review, identified cultural coherence risks, and returned a detailed handoff for the parent agent to integrate without repeating the analysis. '.repeat(
        2,
      );
    child.mockNextResponse({ type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'academic-anthropologist',
      profileBaseName: 'explore',
      parentToolCallId: 'call_agent',
      prompt: 'Review the launch plan',
      description: 'Review plan',
      runInBackground: false,
      signal,
    });

    await expect(handle.completion).resolves.toMatchObject({ result: summary.trim() });
    expect(handle.profileName).toBe('academic-anthropologist');
    expect(child.agent.config.profileName).toBe('academic-anthropologist');
    expect(child.llmCalls[0]?.systemPrompt).toContain('<persona_spec>');
    expect(child.llmCalls[0]?.systemPrompt).toContain('<role_declaration>');
    expect(child.llmCalls[0]?.systemPrompt).toContain('Anthropologist');
    expect(child.llmCalls[0]?.systemPrompt).toContain('cultural anthropologist');
    expect(child.llmCalls[0]?.systemPrompt).toContain('codebase exploration specialist');
    expect(child.llmCalls[0]?.tools.map((tool) => tool.name).toSorted()).toEqual([
      'Bash',
      'GetCurrentTime',
      'Glob',
      'Grep',
      'Read',
      'ReadMediaFile',
      'RepoQuery',
      'SearchTools',
      'TodoList',
    ]);
    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.spawned',
        args: expect.objectContaining({
          subagentId: 'agent-0',
          subagentName: 'academic-anthropologist',
          parentToolCallId: 'call_agent',
        }),
      }),
    );
    expect(telemetryTrack).toHaveBeenCalledWith('subagent_created', {
      subagent_name: 'academic-anthropologist',
      run_in_background: false,
    });
  });

  it('inherits active parent user tools when spawning a subagent', async () => {
    const parent = testAgent();
    parent.configure();
    await parent.rpc.registerTool(lookupToolRegistration());
    parent.newEvents();

    const summary =
      'Investigated the delegated task thoroughly, used the inherited custom lookup surface where appropriate, and returned a detailed summary that lets the parent agent continue without repeating the work. '.repeat(
        2,
      );
    const child = testAgent();
    child.mockNextResponse({
      type: 'text',
      text: summary,
    });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Use the available lookup tool',
      description: 'Use lookup',
      runInBackground: false,
      signal,
    });

    await expect(handle.completion).resolves.toMatchObject({
      result: summary.trim(),
    });
    expect(child.llmCalls[0]?.tools.map((tool) => tool.name)).toContain('Lookup');
    expect(child.agent.tools.data()).toContainEqual({
      name: 'Lookup',
      description: 'Look up a short test value.',
      active: true,
      source: 'user',
      helpVisibility: 'primary',
    });

    const lookupTool = child.agent.tools.loopTools.find((tool) => tool.name === 'Lookup');
    expect(lookupTool).toBeDefined();

    const execution = executeTool(lookupTool!, {
      turnId: '0',
      toolCallId: 'call_lookup',
      args: { query: 'moon' },
      signal,
    });
    const routedTo = await Promise.race([
      child.untilToolCall({ output: 'moon-result' }).then(() => 'child'),
      parent.untilToolCall({ output: 'moon-result' }).then(() => 'parent'),
      new Promise<'timeout'>((resolve) => setTimeout(() => {
        resolve('timeout');
      }, 50)),
    ]);

    expect(routedTo).toBe('child');
    await expect(execution).resolves.toMatchObject({ output: 'moon-result' });
  });

  it('falls back to bundled subagent profiles when the parent profile is missing', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    // The child stands in for a spawned subagent: build it with type 'sub'
    // so main-only tools (Refine) stay out of its loop tools, matching the
    // production spawn path.
    const child = testAgent({ type: 'sub' });
    child.mockNextResponse({ type: 'text', text: 'Implemented the requested fix in the target module, updated all affected call sites, and confirmed the change compiles cleanly and passes the existing test suite. No unrelated code paths were touched while making this change.' });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Implement the fix',
      description: 'Fix bug',
      runInBackground: false,
      signal,
    });

    await expect(handle.completion).resolves.toMatchObject({
      result:
        'Implemented the requested fix in the target module, updated all affected call sites, and confirmed the change compiles cleanly and passes the existing test suite. No unrelated code paths were touched while making this change.',
    });
    expect(child.agent.config.profileName).toBe('coder');
    expect(child.llmCalls[0]?.systemPrompt).toContain('You are now running as a subagent.');
    expect(child.llmCalls[0]?.tools.map((tool) => tool.name).toSorted()).toEqual([
      'ApplyPatch',
      'Bash',
      'Compact',
      'Edit',
      'Expand',
      'GetCurrentTime',
      'Glob',
      'Grep',
      'Read',
      'ReadMediaFile',
      'RepoQuery',
      'Review',
      'RunProjectChecks',
      'Script',
      'SearchTools',
      'TodoList',
      'VerifySurface',
      'VisualDiff',
      'Write',
    ]);
    expect(
      child.llmCalls[0]?.history.some(
        (message) =>
          message.role === 'user' &&
          message.content.some(
            (part) => part.type === 'text' && part.text.includes('Implement the fix'),
          ),
      ),
    ).toBe(true);
  });

  it('rejects unknown subagent types before creating a child agent', async () => {
    const parent = testAgent();
    parent.configure();
    const createAgent = vi.fn();
    const host = new SessionSubagentHost(
      {
        agents: new Map([['main', parent.agent]]),
        ensureAgentResumed: vi.fn(async () => parent.agent),
        createAgent,
      } as never,
      'main',
    );

    await expect(
      host.spawn({
        profileName: 'missing',
        parentToolCallId: 'call_agent',
        prompt: 'Find the cause',
        description: 'Find cause',
        runInBackground: false,
        signal,
      }),
    ).rejects.toThrow('Subagent profile "missing" was not found');
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('rejects unavailable subagent profiles even when a same-named fork label exists', async () => {
    const parent = testAgent();
    parent.configure();
    const createAgent = vi.fn();
    const host = new SessionSubagentHost(
      {
        agents: new Map([['main', parent.agent]]),
        ensureAgentResumed: vi.fn(async () => parent.agent),
        createAgent,
      } as never,
      'main',
    );

    await expect(
      host.spawn({
        profileName: 'btw',
        parentToolCallId: 'call_agent',
        prompt: 'Answer a side question',
        description: 'Side question',
        runInBackground: false,
        signal,
      }),
    ).rejects.toThrow('Subagent profile "btw" was not found');
    expect(createAgent).not.toHaveBeenCalled();
  });

  it('cancels the child turn when the caller signal aborts', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const controller = new AbortController();
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'explore',
      parentToolCallId: 'call_agent',
      prompt: 'Keep working',
      description: 'Long task',
      runInBackground: false,
      signal: controller.signal,
    });

    await child.untilApprovalRequest();
    controller.abort();

    await expect(handle.completion).rejects.toThrow('Aborted');
    expect(child.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[wire]',
        event: 'turn.cancel',
        args: expect.objectContaining({ turnId: 0 }),
      }),
    );
    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.failed',
        args: expect.objectContaining({
          subagentId: 'agent-0',
          error: 'Aborted',
        }),
      }),
    );
  });

  it('cancelAll aborts foreground children', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'explore',
      parentToolCallId: 'call_agent',
      prompt: 'Keep working',
      description: 'Long task',
      runInBackground: false,
      signal,
    });

    await child.untilApprovalRequest();
    host.cancelAll();

    await expect(handle.completion).rejects.toThrow('Aborted');
    expect(child.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[wire]',
        event: 'turn.cancel',
        args: expect.objectContaining({ turnId: 0 }),
      }),
    );
  });

  it("tells a cancelled subagent's in-flight tools the user interrupted them", async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const controller = new AbortController();
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'explore',
      parentToolCallId: 'call_agent',
      prompt: 'Keep working',
      description: 'Long task',
      runInBackground: false,
      signal: controller.signal,
    });

    await child.untilApprovalRequest();
    // The parent turn signal aborts with a user-cancellation reason; linkAbortSignal
    // forwards it to the child exactly as Turn.cancel does on a real ESC.
    controller.abort(userCancellationReason());
    await expect(handle.completion).rejects.toThrow();
    await child.untilTurnEnd();

    const output = childBashToolResultOutput(child);
    expect(output).toContain('manually interrupted');
    expect(output).toContain('not a system error');
  });

  it('does not mislabel a non-user subagent abort (e.g. a deadline) as a user interruption', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const controller = new AbortController();
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'explore',
      parentToolCallId: 'call_agent',
      prompt: 'Keep working',
      description: 'Long task',
      runInBackground: false,
      signal: controller.signal,
    });

    await child.untilApprovalRequest();
    // A generic (non-user) abort — e.g. a foreground subagent's deadline timeout
    // propagating through waitForCurrentTurn — must NOT be reported to the
    // child's tools as a deliberate user interruption.
    controller.abort(abortError());
    await expect(handle.completion).rejects.toThrow();
    await child.untilTurnEnd();

    const output = childBashToolResultOutput(child);
    expect(output).toBe('Tool "Bash" was aborted');
    expect(output).not.toContain('manually interrupted');
  });

  it('aborts a wedged child with SubagentDeadlineError once the wall-clock deadline elapses', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    process.env[SUBAGENT_DEADLINE_ENV] = '250';
    try {
      const handle = await host.spawn({
        profileName: 'explore',
        parentToolCallId: 'call_agent',
        prompt: 'Keep working',
        description: 'Long task',
        runInBackground: false,
        signal,
      });

      await child.untilApprovalRequest();
      // The child now sits on an unanswered approval request; only the
      // wall-clock deadline can end the run.
      await expect(handle.completion).rejects.toBeInstanceOf(SubagentDeadlineError);
      await expect(handle.completion).rejects.toMatchObject({
        code: 'subagent_deadline',
        deadlineMs: 250,
      });
      await child.untilTurnEnd();
    } finally {
      delete process.env[SUBAGENT_DEADLINE_ENV];
    }
  });

  it('keeps a wedged child alive when SUPERLIORA_SUBAGENT_DEADLINE_MS=0 disables the deadline', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const controller = new AbortController();
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    process.env[SUBAGENT_DEADLINE_ENV] = '0';
    try {
      const handle = await host.spawn({
        profileName: 'explore',
        parentToolCallId: 'call_agent',
        prompt: 'Keep working',
        description: 'Long task',
        runInBackground: false,
        signal: controller.signal,
      });
      void handle.completion.catch(() => {});

      await child.untilApprovalRequest();
      // Longer than the tiny deadline the fail-fast test uses: with the kill
      // switch off, nothing may abort the wedged child on its own.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(child.agent.turn.hasActiveTurn).toBe(true);

      controller.abort(abortError());
      await expect(handle.completion).rejects.toThrow();
      await child.untilTurnEnd();
    } finally {
      delete process.env[SUBAGENT_DEADLINE_ENV];
    }
  });

  it('cancelAll leaves background children running until their task signal aborts', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const backgroundController = new AbortController();
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: 'I will run Bash.' }, bashCall());
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'explore',
      parentToolCallId: 'call_agent',
      prompt: 'Keep working',
      description: 'Long task',
      runInBackground: true,
      signal: backgroundController.signal,
    });

    await child.untilApprovalRequest();
    host.cancelAll();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(child.agent.turn.hasActiveTurn).toBe(true);
    expect(child.allEvents).not.toContainEqual(
      expect.objectContaining({
        type: '[wire]',
        event: 'turn.cancel',
        args: expect.objectContaining({ turnId: 0 }),
      }),
    );

    backgroundController.abort();

    await expect(handle.completion).rejects.toThrow('Aborted');
    expect(child.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[wire]',
        event: 'turn.cancel',
        args: expect.objectContaining({ turnId: 0 }),
      }),
    );
  });

  it('re-prompts the child when the first summary is too short', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const longSummary = 'Detailed findings: '.repeat(20);
    // Densify async pre-rot (~1%) would otherwise reclaim mid-test and steal
    // the second generate mock for compaction handoff.
    const child = testAgent({
      experimentalFlags: new FlagResolver(
        { SUPERLIORA_EXPERIMENTAL_ASYNC_COMPACTION: '0' },
        FLAG_DEFINITIONS,
      ),
    });
    child.mockNextResponse({ type: 'text', text: 'done' });
    child.mockNextResponse({ type: 'text', text: longSummary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Investigate',
      description: 'Investigate',
      runInBackground: false,
      signal,
    });

    await expect(handle.completion).resolves.toMatchObject({ result: longSummary.trim() });
    expect(child.llmCalls).toHaveLength(2);
    expect(userTextMessages(child.llmCalls[1]?.history ?? []).some((text) => text.includes('too brief'))).toBe(
      true,
    );
  });

  it('fails the child instead of re-prompting when the response is truncated', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const child = testAgent();
    child.mockNextProviderResponse({
      parts: [
        { type: 'think', think: 'The child used its output budget before writing a summary.' },
      ],
      finishReason: 'truncated',
      rawFinishReason: 'length',
    });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Investigate',
      description: 'Investigate',
      runInBackground: false,
      signal,
    });

    await expect(handle.completion).rejects.toThrow(
      'Subagent turn failed before completing its final summary: reason=max_tokens',
    );
    expect(child.llmCalls).toHaveLength(1);
    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.failed',
        args: expect.objectContaining({
          subagentId: 'agent-0',
          error: expect.stringContaining(
            'Subagent turn failed before completing its final summary: reason=max_tokens',
          ),
        }),
      }),
    );
    expect(parent.allEvents).not.toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.completed',
      }),
    );
  });

  it('throws a typed SubagentMaxTokensError when the response is truncated', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const child = testAgent();
    child.mockNextProviderResponse({
      parts: [
        { type: 'think', think: 'The child used its output budget before writing a summary.' },
      ],
      finishReason: 'truncated',
      rawFinishReason: 'length',
    });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Investigate',
      description: 'Investigate',
      runInBackground: false,
      signal,
    });

    // Caller must be able to identify max_tokens failures without
    // substring-matching the human message.
    let captured: unknown;
    await handle.completion.catch((error) => {
      captured = error;
    });
    expect(captured).toBeInstanceOf(SubagentMaxTokensError);
    expect(captured).toBeInstanceOf(Error);
    expect(isSubagentMaxTokensError(captured)).toBe(true);
    if (isSubagentMaxTokensError(captured)) {
      expect(captured.code).toBe('subagent_max_tokens');
      expect(captured.name).toBe('SubagentMaxTokensError');
      expect(captured.message).toMatch(/reason=max_tokens/);
    }
  });

  it('does not re-prompt when the first summary is long enough', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const longSummary = 'Comprehensive technical summary. '.repeat(10);
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: longSummary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Investigate',
      description: 'Investigate',
      runInBackground: false,
      signal,
    });

    // The unslop filter rewrites the slop word "comprehensive" to "complete"
    // in the child agent's final summary before it reaches the parent.
    await expect(handle.completion).resolves.toMatchObject({
      result: 'Complete technical summary. '.repeat(10).trim(),
    });
    expect(child.llmCalls).toHaveLength(1);
  });

  it('prepends git context to the prompt for explore subagents', async () => {
    vi.mocked(collectGitContext).mockResolvedValueOnce(
      '<git-context>\nWorking directory: /repo\nBranch: main\n</git-context>',
    );
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const summary =
      'Explored the repository thoroughly and reported the findings in a complete and detailed summary that gives the parent agent everything it needs to continue the work without redoing the investigation all over again.';
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'explore',
      parentToolCallId: 'call_agent',
      prompt: 'Find the cause',
      description: 'Find cause',
      runInBackground: false,
      signal,
    });
    await handle.completion;

    expect(child.llmCalls[0]?.history[0]).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'text',
          text: '<git-context>\nWorking directory: /repo\nBranch: main\n</git-context>\n\nFind the cause',
        },
      ],
    });
  });

  it('does not prepend git context for non-explore subagents', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const summary =
      'Implemented the requested change in full and verified it against the existing test suite, leaving a thorough and complete summary so the parent agent can proceed without repeating any of the finished investigation work.';
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Implement the fix',
      description: 'Fix bug',
      runInBackground: false,
      signal,
    });
    await handle.completion;

    expect(child.llmCalls[0]?.history[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Implement the fix' }],
    });
  });

  it('resumes an idle child agent by id', async () => {
    const parent = testAgent();
    parent.configure();
    parent.agent.permission.setMode('yolo');

    const child = testAgent({
      type: 'sub',
      permission: { parent: parent.agent.permission },
    });
    child.configure({ tools: ['Read'] });
    child.agent.useProfile(
      profile({ name: 'explore', tools: ['Read'], systemPrompt: 'explore prompt' }),
    );
    child.agent.context.appendUserMessage([{ type: 'text', text: 'Earlier context' }]);
    child.mockNextResponse({
      type: 'text',
      text: 'Resumed the subagent from its earlier context and carried the task through to completion, then reported a full and detailed technical summary so the parent agent can continue without repeating prior work.',
    });
    vi.mocked(collectGitContext).mockReset().mockResolvedValue('');

    const session = fakeSession(parent.agent, child.agent, {
      'agent-0': {
        homedir: '/tmp/kimi-session/agents/agent-0',
        type: 'sub',
        parentAgentId: 'main',
      },
    });
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.resume('agent-0', {
      parentToolCallId: 'call_agent',
      prompt: 'Continue from context',
      description: 'Continue work',
      runInBackground: false,
      signal,
    });

    expect(handle).toMatchObject({
      agentId: 'agent-0',
      profileName: 'explore',
      resumed: true,
    });
    await expect(handle.completion).resolves.toMatchObject({
      result:
        'Resumed the subagent from its earlier context and carried the task through to completion, then reported a full and detailed technical summary so the parent agent can continue without repeating prior work.',
    });
    expect(session.createAgent).not.toHaveBeenCalled();
    expect(child.agent.permission.mode).toBe('yolo');
    expect(child.lastLlmInput()).toMatchInlineSnapshot(`
      system: "explore prompt"
      tools: Read
      messages:
        user: text "Earlier context"
        user: text "Continue from context"
        user: text <current-time-reminder>
    `);
    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.spawned',
        args: expect.objectContaining({
          subagentId: 'agent-0',
          subagentName: 'explore',
          parentToolCallId: 'call_agent',
        }),
      }),
    );
  });

  it('runQueued resumes tasks that carry an existing agent id', async () => {
    const parent = testAgent();
    parent.configure();

    const child = testAgent({ type: 'sub' });
    child.configure();
    child.agent.useProfile(
      profile({ name: 'coder', tools: [], systemPrompt: 'coder prompt' }),
    );
    child.agent.context.appendUserMessage([{ type: 'text', text: 'Earlier swarm context' }]);
    const summary =
      'Resumed the queued swarm subagent from its prior context, completed the missing work, and returned a detailed enough handoff for the parent to proceed without starting over. '.repeat(
        2,
      );
    child.mockNextResponse({ type: 'text', text: summary });

    const session = fakeSession(parent.agent, child.agent, {
      'agent-0': {
        homedir: '/tmp/kimi-session/agents/agent-0',
        type: 'sub',
        parentAgentId: 'main',
      },
    });
    const host = new SessionSubagentHost(session, 'main');

    await expect(
      host.runQueued(
        [
          {
            ...queuedTask(1),
            kind: 'resume',
            prompt: 'Continue the previous swarm task',
            resumeAgentId: 'agent-0',
            signal,
          },
        ],
      ),
    ).resolves.toMatchObject([
      {
        agentId: 'agent-0',
        status: 'completed',
        result: expect.stringContaining(summary.trim()),
      },
    ]);

    expect(session.createAgent).not.toHaveBeenCalled();
    expect(userTextMessages(child.llmCalls[0]?.history ?? [])).toEqual([
      'Earlier swarm context',
      'Continue the previous swarm task',
    ]);
  });

  it('runQueued persists swarm item metadata for spawned tasks', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const child = testAgent({ type: 'sub' });
    child.configure();
    const summary =
      'Completed the queued swarm item and returned a detailed technical handoff so the parent can map the result back to the original swarm input. '.repeat(
        2,
      );
    child.mockNextResponse({ type: 'text', text: summary });

    const metadataAgents: Session['metadata']['agents'] = {};
    const session = fakeSession(parent.agent, child.agent, metadataAgents);
    const host = new SessionSubagentHost(session, 'main');

    await expect(
      host.runQueued([{ ...queuedTask(1), swarmItem: 'src/a.ts', signal }]),
    ).resolves.toMatchObject([
      {
        agentId: 'agent-0',
        status: 'completed',
        result: expect.stringContaining(summary.trim()),
      },
    ]);

    expect(session.createAgent).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        parentAgentId: 'main',
        swarmItem: 'src/a.ts',
      }),
    );
    expect(metadataAgents['agent-0']).toMatchObject({
      type: 'sub',
      parentAgentId: 'main',
      swarmItem: 'src/a.ts',
    });
    expect(host.getSwarmItem('agent-0')).toBe('src/a.ts');
    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.spawned',
        args: expect.objectContaining({
          subagentId: 'agent-0',
          parentToolCallId: 'call_swarm',
        }),
      }),
    );
    expect(parent.allEvents).toContainEqual(
      expect.objectContaining({
        type: '[rpc]',
        event: 'subagent.started',
        args: expect.objectContaining({
          subagentId: 'agent-0',
        }),
      }),
    );
  });

  it('retries a rate-limited child turn without appending the original prompt again', async () => {
    const parent = testAgent();
    parent.configure();
    parent.newEvents();

    const summary =
      'Recovered from a provider rate limit by retrying the latest subagent step with the original context intact, then completed the delegated work with a detailed enough summary for the parent to continue confidently. '.repeat(
        2,
      );
    const histories: Message[][] = [];
    let generateCalls = 0;
    const generate: GenerateFn = async (
      _provider,
      _systemPrompt,
      _tools,
      history,
      callbacks,
    ) => {
      histories.push(structuredClone(history));
      generateCalls += 1;
      if (generateCalls === 1) {
        throw new APIStatusError(429, 'Rate limited', 'req-429');
      }
      await callbacks?.onMessagePart?.({ type: 'text', text: summary });
      return textResult(summary);
    };
    const child = testAgent({
      generate,
      experimentalFlags: new FlagResolver(
        { SUPERLIORA_EXPERIMENTAL_ASYNC_COMPACTION: '0' },
        FLAG_DEFINITIONS,
      ),
      initialConfig: {
        providers: {},
        loopControl: {
          maxRetriesPerStep: 1,
          compactionTriggerRatio: 0.85,
          compactionTriggerTokens: 2_000_000,
          reservedContextSize: 0,
        },
      },
    });
    child.configure();

    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Implement the retry-safe change',
      description: 'Fix rate-limit retry',
      runInBackground: false,
      signal,
    });
    // Provider-level retry may recover inside the first completion, or surface the
    // 429 for an explicit host.retry. Accept either path as long as the final
    // result is produced without re-appending the original user prompt.
    let finalHandle = handle;
    try {
      await expect(handle.completion).resolves.toMatchObject({ result: summary.trim() });
    } catch {
      await expect(handle.completion).rejects.toThrow(/Rate limited|429/i);
      finalHandle = await host.retry(handle.agentId, {
        parentToolCallId: 'call_agent',
        prompt: 'Implement the retry-safe change',
        description: 'Fix rate-limit retry',
        runInBackground: false,
        signal,
      });
      await expect(finalHandle.completion).resolves.toMatchObject({ result: summary.trim() });
    }
    expect(generateCalls).toBeGreaterThanOrEqual(2);
    // After provider auto-retry or host.retry, the child history must not grow
    // extra user turns beyond the original prompt (dedupe consecutive identical prompts).
    const secondHistoryUsers = userTextMessages(histories[1] ?? []);
    expect([...new Set(secondHistoryUsers)]).toEqual(['Implement the retry-safe change']);
  });

  it('realigns a resumed subagent to the parent agent current model', async () => {
    const parent = testAgent();
    parent.configure();
    parent.agent.permission.setMode('yolo');

    const child = testAgent({
      initialConfig: {
        providers: {
          'test-provider': { type: 'kimi', apiKey: 'test-key' },
        },
        models: {
          'mock-model': {
            provider: 'test-provider',
            model: 'mock-model',
            maxContextSize: 1_000_000,
          },
          'stale-model-from-initial-spawn': {
            provider: 'test-provider',
            model: 'stale-model-from-initial-spawn',
            maxContextSize: 1_000_000,
          },
        },
      },
    });
    child.configure({ tools: ['Read'] });
    // The child was originally spawned with a model that no longer matches the
    // parent agent's current model (as if the parent ran setModel afterwards).
    child.agent.config.update({ modelAlias: 'stale-model-from-initial-spawn' });
    child.agent.useProfile(
      profile({ name: 'explore', tools: ['Read'], systemPrompt: 'explore prompt' }),
    );
    child.agent.context.appendUserMessage([{ type: 'text', text: 'Earlier context' }]);
    child.mockNextResponse({
      type: 'text',
      text: 'Resumed the subagent from its earlier context and carried the task through to completion, then reported a full and detailed technical summary so the parent agent can continue without repeating prior work.',
    });

    const session = fakeSession(parent.agent, child.agent, {
      'agent-0': {
        homedir: '/tmp/kimi-session/agents/agent-0',
        type: 'sub',
        parentAgentId: 'main',
      },
    });
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.resume('agent-0', {
      parentToolCallId: 'call_agent',
      prompt: 'Continue from context',
      description: 'Continue work',
      runInBackground: false,
      signal,
    });

    await handle.completion;
    // resume must realign the child to the parent agent's current model rather
    // than leave it on the stale model from its initial spawn.
    expect(child.agent.config.modelAlias).toBe(parent.agent.config.modelAlias);
    expect(child.agent.config.modelAlias).not.toBe('stale-model-from-initial-spawn');
  });

  it('routes spawned explore subagents to a cheap model when one is configured', async () => {
    const models = {
      'cheap-haiku': {
        provider: 'test-provider',
        model: 'cheap-haiku',
        maxContextSize: 1_000_000,
      },
    };
    const parent = testAgent({ initialConfig: { providers: {}, models } });
    parent.configure();

    const summary =
      'Explored the repository on the cheap model and reported the findings in a complete and detailed summary that gives the parent agent everything it needs to continue the work without redoing the investigation all over again.';
    const child = testAgent({ initialConfig: { providers: {}, models } });
    child.configure();
    child.mockNextResponse({ type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'explore',
      parentToolCallId: 'call_agent',
      prompt: 'Find the cause',
      description: 'Find cause',
      runInBackground: false,
      signal,
    });
    await handle.completion;

    // Exploration is read-only grunt work: the explore child runs on the
    // cheap configured model while the parent keeps its own model.
    expect(child.agent.config.modelAlias).toBe('cheap-haiku');
    expect(parent.agent.config.modelAlias).toBe('mock-model');
  });

  it('keeps the parent model for explore subagents when no cheap model is configured', async () => {
    const parent = testAgent();
    parent.configure();

    const summary =
      'Explored the repository thoroughly and reported the findings in a complete and detailed summary that gives the parent agent everything it needs to continue the work without redoing the investigation all over again.';
    const child = testAgent();
    child.mockNextResponse({ type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'explore',
      parentToolCallId: 'call_agent',
      prompt: 'Find the cause',
      description: 'Find cause',
      runInBackground: false,
      signal,
    });
    await handle.completion;

    // No cheap alias can be inferred, so the explore child must fall back to
    // the parent model rather than end up without a model alias.
    expect(child.agent.config.modelAlias).toBe(parent.agent.config.modelAlias);
  });

  it('keeps the parent model for coder subagents even when a cheap model exists', async () => {
    const models = {
      'cheap-haiku': {
        provider: 'test-provider',
        model: 'cheap-haiku',
        maxContextSize: 1_000_000,
      },
    };
    const parent = testAgent({ initialConfig: { providers: {}, models } });
    parent.configure();

    const summary =
      'Implemented the requested change in full and verified it against the existing test suite, leaving a thorough and complete summary so the parent agent can proceed without repeating any of the finished investigation work.';
    const child = testAgent({ initialConfig: { providers: {}, models } });
    child.configure();
    child.mockNextResponse({ type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const handle = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Implement the fix',
      description: 'Fix bug',
      runInBackground: false,
      signal,
    });
    await handle.completion;

    expect(child.agent.config.modelAlias).toBe(parent.agent.config.modelAlias);
    expect(child.agent.config.modelAlias).not.toBe('cheap-haiku');
  });

  it('re-evaluates the coding role model at spawn, retry, and resume', async () => {
    const models = {
      'code-pro': {
        provider: 'test-provider',
        model: 'code-pro',
        maxContextSize: 1_000_000,
        capabilities: ['tool_use', 'thinking'],
      },
      'code-next': {
        provider: 'test-provider',
        model: 'code-next',
        maxContextSize: 1_000_000,
        capabilities: ['tool_use', 'thinking'],
      },
      'code-final': {
        provider: 'test-provider',
        model: 'code-final',
        maxContextSize: 1_000_000,
        capabilities: ['tool_use', 'thinking'],
      },
    };
    const parent = testAgent({
      initialConfig: {
        providers: {},
        models,
        loopControl: { codingModel: 'code-pro' },
      },
    });
    parent.configure();
    const child = testAgent({ initialConfig: { providers: {}, models } });
    child.configure();
    const summary =
      'Implemented the coding task and verified the change with the relevant checks, then left a complete technical handoff for the parent worker to continue without repeating the finished work. '.repeat(
        2,
      );
    child.mockNextResponse({ type: 'text', text: summary });
    const session = fakeSession(parent.agent, child.agent);
    const host = new SessionSubagentHost(session, 'main');

    const spawned = await host.spawn({
      profileName: 'coder',
      parentToolCallId: 'call_agent',
      prompt: 'Implement the change',
      description: 'Implement change',
      runInBackground: false,
      signal,
    });
    await spawned.completion;
    expect(child.agent.config.modelAlias).toBe('code-pro');

    parent.configureLoopControl({ codingModel: 'code-next' });
    child.mockNextResponse({ type: 'text', text: summary });
    const retried = await host.retry(spawned.agentId, {
      parentToolCallId: 'call_agent',
      prompt: 'Implement the change',
      description: 'Retry implementation',
      runInBackground: false,
      signal,
    });
    await retried.completion;
    expect(child.agent.config.modelAlias).toBe('code-next');

    parent.configureLoopControl({ codingModel: 'code-final' });
    child.mockNextResponse({ type: 'text', text: summary });
    const resumed = await host.resume(spawned.agentId, {
      parentToolCallId: 'call_agent',
      prompt: 'Continue the implementation',
      description: 'Resume implementation',
      runInBackground: false,
      signal,
    });
    await resumed.completion;
    expect(child.agent.config.modelAlias).toBe('code-final');
  });

  describe('model fallback on retryable provider failure', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const testProviders = {
      'test-provider': { type: 'kimi' as const, apiKey: 'test-key' },
    };
    const fallbackModels = {
      'mock-model': {
        provider: 'test-provider',
        model: 'primary-model',
        maxContextSize: 1_000_000,
        fallbackModels: ['fallback-model'],
      },
      'fallback-model': {
        provider: 'test-provider',
        model: 'backup-model',
        maxContextSize: 1_000_000,
      },
    };

    function failedEvents(parent: AgentTestContext) {
      return parent.allEvents.filter(
        (entry) => entry.type === '[rpc]' && entry.event === 'subagent.failed',
      );
    }

    function flattenedTransientFailure() {
      // Mirrors how runChildTurnToCompletion flattens a failed turn payload:
      // a plain Error carrying the provider HTTP status.
      const failure = new Error('[provider_api_error] 400 status code (no body)');
      (failure as Error & { statusCode?: number }).statusCode = 400;
      return failure;
    }

    function stubRunPromptTurn() {
      return vi.spyOn(subagentCompletionFlow.completionFlowApi, 'runPromptTurn');
    }

    it('fails over the provider route to a fallback model candidate on a body-less 400', async () => {
      const parent = testAgent();
      parent.configure();

      const summary =
        'Completed the delegated subagent task on the fallback route candidate with enough concrete detail for the parent agent to continue without repeating the work. '.repeat(
          2,
        );
      const scripted = createScriptedGenerate();
      const attemptedModels: string[] = [];
      const generate: GenerateFn = async (
        provider,
        systemPrompt,
        tools,
        history,
        callbacks,
        options,
      ) => {
        attemptedModels.push(provider.modelName);
        if (provider.modelName === 'primary-model') {
          options?.signal?.throwIfAborted();
          throw new APIStatusError(400, '400 status code (no body)');
        }
        return scripted.generate(provider, systemPrompt, tools, history, callbacks, options);
      };
      const child = testAgent({
        generate,
        initialConfig: { providers: testProviders, models: fallbackModels },
      });
      scripted.mockNextResponse({ type: 'text', text: summary });
      const session = fakeSession(parent.agent, child.agent);
      const host = new SessionSubagentHost(session, 'main');

      const handle = await host.spawn({
        profileName: 'coder',
        parentToolCallId: 'call_agent',
        prompt: 'Implement the fix',
        description: 'Fix bug',
        runInBackground: false,
        signal,
      });
      await expect(handle.completion).resolves.toMatchObject({ result: summary.trim() });

      // The primary candidate's body-less 400 failed over to the fallback
      // candidate inside the same turn instead of ending it.
      expect(attemptedModels).toEqual(['primary-model', 'backup-model']);
      expect(failedEvents(parent)).toHaveLength(0);
    }, 30_000);

    it('switches the spawned subagent to a fallback model after a retryable turn failure', async () => {
      const parent = testAgent();
      parent.configure();

      const summary = 'Recovered on the fallback model.';
      const child = testAgent({
        initialConfig: { providers: testProviders, models: fallbackModels },
      });
      const session = fakeSession(parent.agent, child.agent);
      const host = new SessionSubagentHost(session, 'main');
      const runPromptTurn = stubRunPromptTurn();
      runPromptTurn
        .mockRejectedValueOnce(flattenedTransientFailure())
        .mockResolvedValueOnce({ result: summary, usage: emptyUsage() });

      const handle = await host.spawn({
        profileName: 'coder',
        parentToolCallId: 'call_agent',
        prompt: 'Implement the fix',
        description: 'Fix bug',
        runInBackground: false,
        signal,
      });
      await expect(handle.completion).resolves.toMatchObject({ result: summary });

      expect(child.agent.config.modelAlias).toBe('fallback-model');
      const failed = failedEvents(parent);
      expect(failed).toHaveLength(1);
      expect(failed[0]).toMatchObject({
        args: expect.objectContaining({
          subagentId: 'agent-0',
          retryAttempt: 1,
          retryLimit: 1,
        }),
      });
    });

    it('reports fellBackToModel when every fallback model also fails', async () => {
      const parent = testAgent();
      parent.configure();

      const models = {
        'mock-model': {
          provider: 'test-provider',
          model: 'primary-model',
          maxContextSize: 1_000_000,
          fallbackModels: ['fallback-model', 'last-resort-model'],
        },
        'fallback-model': {
          provider: 'test-provider',
          model: 'backup-model',
          maxContextSize: 1_000_000,
        },
        'last-resort-model': {
          provider: 'test-provider',
          model: 'tertiary-model',
          maxContextSize: 1_000_000,
        },
      };
      const child = testAgent({
        initialConfig: { providers: testProviders, models },
      });
      const session = fakeSession(parent.agent, child.agent);
      const host = new SessionSubagentHost(session, 'main');
      const runPromptTurn = stubRunPromptTurn();
      runPromptTurn.mockRejectedValue(flattenedTransientFailure());

      const handle = await host.spawn({
        profileName: 'coder',
        parentToolCallId: 'call_agent',
        prompt: 'Implement the fix',
        description: 'Fix bug',
        runInBackground: false,
        signal,
      });
      await expect(handle.completion).rejects.toThrow('400 status code (no body)');

      expect(child.agent.config.modelAlias).toBe('last-resort-model');
      const failed = failedEvents(parent);
      expect(failed).toHaveLength(3);
      expect(failed[0]).toMatchObject({
        args: expect.objectContaining({ retryAttempt: 1, retryLimit: 2 }),
      });
      expect(failed[1]).toMatchObject({
        args: expect.objectContaining({ retryAttempt: 2, retryLimit: 2 }),
      });
      expect(failed[2]).toMatchObject({
        args: expect.objectContaining({ fellBackToModel: 'last-resort-model' }),
      });
      expect(failed[2]?.args).not.toHaveProperty('retryAttempt');
    });

    it('keeps the single-failure behavior for non-retryable errors', async () => {
      const parent = testAgent();
      parent.configure();

      const child = testAgent({
        generate: async (_chat, _systemPrompt, _tools, _history, _callbacks, options) => {
          options?.signal?.throwIfAborted();
          throw new APIStatusError(400, 'Invalid request body: messages is required');
        },
        initialConfig: { providers: testProviders, models: fallbackModels },
      });
      const session = fakeSession(parent.agent, child.agent);
      const host = new SessionSubagentHost(session, 'main');

      const handle = await host.spawn({
        profileName: 'coder',
        parentToolCallId: 'call_agent',
        prompt: 'Implement the fix',
        description: 'Fix bug',
        runInBackground: false,
        signal,
      });
      await expect(handle.completion).rejects.toThrow('Invalid request body');

      // No fallback hop happened: the child stays on the inherited parent alias
      // and exactly one plain failed event was emitted.
      expect(child.agent.config.modelAlias).toBe('mock-model');
      const failed = failedEvents(parent);
      expect(failed).toHaveLength(1);
      expect(failed[0]?.args).not.toHaveProperty('retryAttempt');
      expect(failed[0]?.args).not.toHaveProperty('fellBackToModel');
    });
  });
});

describe('Session resume permission parent chain', () => {
  it('restores subagent live-derived permission when metadata lists the child first', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kimi-permission-chain-'));
    tempDirs.push(dir);
    const sessionDir = join(dir, 'session');
    const workDir = join(dir, 'work');
    const mainDir = join(sessionDir, 'agents', 'main');
    const childDir = join(sessionDir, 'agents', 'agent-0');
    const sessionApprovalRule = 'Bash(printf parent)';
    await mkdir(workDir, { recursive: true });
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, 'state.json'),
      JSON.stringify(
        {
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          title: 'Permission Chain',
          isCustomTitle: false,
          agents: {
            'agent-0': {
              homedir: childDir,
              type: 'sub',
              parentAgentId: 'main',
            },
            main: {
              homedir: mainDir,
              type: 'main',
              parentAgentId: null,
            },
          },
          custom: {},
        },
        null,
        2,
      ),
      'utf-8',
    );
    await writeWire(mainDir, [
      {
        type: 'permission.set_mode',
        mode: 'yolo',
      },
      {
        type: 'permission.record_approval_result',
        turnId: 0,
        toolCallId: 'call_parent_bash',
        toolName: 'Bash',
        action: 'run command',
        sessionApprovalRule,
        result: {
          decision: 'approved',
          scope: 'session',
          selectedLabel: 'Approve for this session',
        },
      },
    ]);
    await writeWire(childDir, []);

    const session = new Session({
      kaos: testKaos.withCwd(workDir),
      homedir: sessionDir,
      rpc: createSessionRpc(),
      initializeMainAgent: false,
      skills: { explicitDirs: [join(workDir, 'missing-skills')] },
    });

    try {
      await session.resume();

      const child = await session.ensureAgentResumed('agent-0');
      expect(child?.permission.mode).toBe('yolo');
      expect(child?.permission.rules).toEqual([]);
      expect(child?.permission.data().rules).toEqual([]);
      expect(child?.permission.sessionApprovalRulePatterns).toContain(sessionApprovalRule);
    } finally {
      await session.close();
    }
  });
});

describe('Session.createAgent', () => {
  it('uses the Kaos current directory when the session cwd is omitted', async () => {
    const workDir = '/remote/project';
    const kaos = createFakeKaos({
      getcwd: () => workDir,
      mkdir: vi.fn(async () => {}),
      writeText: vi.fn().mockResolvedValue(0),
      stat: vi.fn(async (path: string) => {
        if ([workDir, `${workDir}/.git`].includes(path)) {
          return stat('dir');
        }
        if ([`${workDir}/README.md`, `${workDir}/AGENTS.md`].includes(path)) {
          return stat('file');
        }
        throw new Error(`ENOENT ${path}`);
      }),
      iterdir: async function* (path: string) {
        if (path === workDir) {
          yield `${workDir}/README.md`;
          return;
        }
        throw new Error(`ENOENT ${path}`);
      },
      readText: vi.fn(async (path: string) => {
        if (path === `${workDir}/AGENTS.md`) return 'remote instructions';
        throw new Error(`ENOENT ${path}`);
      }),
    });
    const session = new Session({
      id: 'test-subagent-remote-context',
      kaos,
      homedir: '/tmp/kimi-session',
      rpc: createSessionRpc(),
      initializeMainAgent: false,
    });

    const created = await session.createAgent({ type: 'main' }, { profile: contextProfile() });

    expect(created.agent.config.systemPrompt).toContain('cwd=/remote/project');
    expect(created.agent.config.systemPrompt).toContain('listing=└── README.md');
    expect(created.agent.config.systemPrompt).toContain('remote instructions');
  });

  it('renders profiles with the current directory listing and merged AGENTS.md files', async () => {
    const workDir = '/repo/packages/app';
    const kaos = createFakeKaos({
      mkdir: vi.fn(async () => {}),
      writeText: vi.fn().mockResolvedValue(0),
      stat: vi.fn(async (path: string) => {
        if (
          [
            '/repo',
            '/repo/.git',
            '/repo/packages',
            workDir,
            `${workDir}/.agents`,
            `${workDir}/.github`,
            `${workDir}/.github/workflows`,
            `${workDir}/src`,
            `${workDir}/.superliora`,
          ].includes(path)
        ) {
          return stat('dir');
        }
        if (
          [
            '/repo/AGENTS.md',
            `${workDir}/.superliora/AGENTS.md`,
            `${workDir}/AGENTS.md`,
            `${workDir}/package.json`,
            `${workDir}/src/index.ts`,
            `${workDir}/.agents/hidden.md`,
            `${workDir}/.github/workflows/ci.yml`,
          ].includes(path)
        ) {
          return stat('file');
        }
        throw new Error(`ENOENT ${path}`);
      }),
      iterdir: async function* (path: string) {
        if (path === workDir) {
          yield `${workDir}/.agents`;
          yield `${workDir}/.github`;
          yield `${workDir}/src`;
          yield `${workDir}/package.json`;
          return;
        }
        if (path === `${workDir}/.agents`) {
          yield `${workDir}/.agents/hidden.md`;
          return;
        }
        if (path === `${workDir}/.github`) {
          yield `${workDir}/.github/workflows`;
          return;
        }
        if (path === `${workDir}/.github/workflows`) {
          yield `${workDir}/.github/workflows/ci.yml`;
          return;
        }
        if (path === `${workDir}/src`) {
          yield `${workDir}/src/index.ts`;
          return;
        }
        throw new Error(`ENOENT ${path}`);
      },
      readText: vi.fn(async (path: string) => {
        if (path === '/repo/AGENTS.md') return 'root instructions';
        if (path === `${workDir}/.superliora/AGENTS.md`) return 'brand instructions';
        if (path === `${workDir}/AGENTS.md`) return 'leaf instructions';
        throw new Error(`ENOENT ${path}`);
      }),
    });
    const session = new Session({
      id: 'test-subagent-agents-md',
      kaos: kaos.withCwd(workDir),
      homedir: '/tmp/kimi-session',
      rpc: createSessionRpc(),
      initializeMainAgent: false,
    });

    const created = await session.createAgent({ type: 'main' }, { profile: contextProfile() });

    expect(created.agent.config.systemPrompt).toContain('cwd=/repo/packages/app');
    expect(created.agent.config.systemPrompt).toContain('listing=├── .agents/');
    expect(created.agent.config.systemPrompt).toContain('├── .github/');
    expect(created.agent.config.systemPrompt).toContain('├── src/');
    expect(created.agent.config.systemPrompt).toContain('│   └── index.ts');
    expect(created.agent.config.systemPrompt).toContain('└── package.json');
    expect(created.agent.config.systemPrompt).not.toContain('hidden.md');
    expect(created.agent.config.systemPrompt).not.toContain('ci.yml');
    expect(created.agent.config.systemPrompt).toContain('<!-- From: /repo/AGENTS.md -->');
    expect(created.agent.config.systemPrompt).toContain('root instructions');
    expect(created.agent.config.systemPrompt).toContain(
      '<!-- From: /repo/packages/app/.superliora/AGENTS.md -->',
    );
    expect(created.agent.config.systemPrompt).toContain('brand instructions');
    expect(created.agent.config.systemPrompt).toContain(
      '<!-- From: /repo/packages/app/AGENTS.md -->',
    );
    expect(created.agent.config.systemPrompt).toContain('leaf instructions');
  });

  it('uses the kimi home for global branded AGENTS.md files', async () => {
    const realHome = '/real-home';
    const kimiHome = '/kimi-home';
    const workDir = '/repo/packages/app';
    const kaos = createFakeKaos({
      gethome: () => realHome,
      mkdir: vi.fn(async () => {}),
      writeText: vi.fn().mockResolvedValue(0),
      stat: vi.fn(async (path: string) => {
        if (['/repo', '/repo/.git', '/repo/packages', workDir].includes(path)) {
          return stat('dir');
        }
        if ([`${kimiHome}/AGENTS.md`, `${realHome}/.superliora/AGENTS.md`].includes(path)) {
          return stat('file');
        }
        throw new Error(`ENOENT ${path}`);
      }),
      // oxlint-disable-next-line require-yield
      iterdir: async function* () {
        return;
      },
      readText: vi.fn(async (path: string) => {
        if (path === `${kimiHome}/AGENTS.md`) return 'kimi home instructions';
        if (path === `${realHome}/.superliora/AGENTS.md`) return 'stale real-home instructions';
        throw new Error(`ENOENT ${path}`);
      }),
    });
    const session = new Session({
      id: 'test-kimi-home-agents-md',
      kaos: kaos.withCwd(workDir),
      homedir: '/tmp/kimi-session',
      kimiHomeDir: kimiHome,
      rpc: createSessionRpc(),
      initializeMainAgent: false,
    });

    const created = await session.createAgent({ type: 'main' }, { profile: contextProfile() });

    expect(created.agent.config.systemPrompt).toContain('kimi home instructions');
    expect(created.agent.config.systemPrompt).not.toContain('stale real-home instructions');
  });

  it('inherits the parent agent cwd when creating a subagent', async () => {
    const sessionWorkDir = '/session/work';
    const parentWorkDir = '/parent/work';

    const kaos = createFakeKaos({
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeText: vi.fn().mockResolvedValue(0),
      stat: vi.fn(async (path: string) => {
        if ([sessionWorkDir, parentWorkDir].includes(path)) {
          return stat('dir');
        }
        throw new Error(`ENOENT ${path}`);
      }),
      // oxlint-disable-next-line require-yield
      iterdir: async function* () {
        return;
      },
      getcwd: () => sessionWorkDir,
    });

    const session = new Session({
      id: 'test-subagent-parent-cwd',
      kaos,
      homedir: '/tmp/kimi-session',
      rpc: createSessionRpc(),
      initializeMainAgent: false,
    });

    // Create a parent agent — it should start at the session workDir.
    const parent = await session.createAgent({ type: 'main' }, { profile: contextProfile() });
    expect(parent.agent.config.systemPrompt).toContain(`cwd=${sessionWorkDir}`);

    // Move the parent agent to a different cwd (e.g. after a config.update replay).
    parent.agent.config.update({ cwd: parentWorkDir });

    // Create a subagent from the moved parent.
    const child = await session.createAgent(
      { type: 'sub' },
      { profile: contextProfile(), parentAgentId: parent.id },
    );

    // The subagent should inherit the parent's current cwd, not the session default.
    expect(child.agent.config.systemPrompt).toContain(`cwd=${parentWorkDir}`);
    expect(child.agent.config.systemPrompt).not.toContain(`cwd=${sessionWorkDir}`);
  });

  it('passes session additional dirs to main and child agents', async () => {
    const extraDir = '/extra/work';
    const directories = new Set(['/workspace', extraDir]);
    const files = new Map([
      [join(extraDir, 'AGENTS.md'), 'extra agents instructions'],
      [join(extraDir, 'extra-file.ts'), 'export const extra = 1;'],
    ]);
    const session = new Session({
      id: 'test-subagent-additional-dirs',
      kaos: createFakeKaos({
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeText: vi.fn().mockResolvedValue(0),
        stat: vi.fn(async (path: string) => {
          if (directories.has(path)) return stat('dir');
          if (files.has(path)) return stat('file');
          throw new Error(`ENOENT ${path}`);
        }),
        iterdir: async function* (path: string) {
          if (path === extraDir) {
            yield join(extraDir, 'AGENTS.md');
            yield join(extraDir, 'extra-file.ts');
          }
        },
        readText: vi.fn(async (path: string) => {
          const content = files.get(path);
          if (content === undefined) throw new Error(`ENOENT ${path}`);
          return content;
        }),
      }),
      homedir: '/tmp/kimi-session',
      rpc: createSessionRpc(),
      initializeMainAgent: false,
      additionalDirs: [extraDir],
    });

    const main = await session.createMain();
    const child = await session.createAgent(
      { type: 'sub' },
      { profile: contextProfile(), parentAgentId: 'main' },
    );

    expect(main.getAdditionalDirs()).toEqual([extraDir]);
    expect(child.agent.getAdditionalDirs()).toEqual([extraDir]);
    expect(child.agent.config.systemPrompt).toContain(`additional=### ${extraDir}`);
    expect(child.agent.config.systemPrompt).toContain('extra-file.ts');
  });

  it('allocates the next unused generated agent id', async () => {
    const session = new Session({
      id: 'test-subagent-agent-id',
      kaos: createFakeKaos({
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeText: vi.fn().mockResolvedValue(0),
      }),
      homedir: '/tmp/kimi-session',
      rpc: createSessionRpc(),
      initializeMainAgent: false,
    });
    session.metadata.agents['agent-0'] = {
      homedir: '/tmp/kimi-session/agents/agent-0',
      type: 'sub',
      parentAgentId: null,
    };

    const created = await session.createAgent({ type: 'sub' });

    expect(created.id).toBe('agent-1');
    expect(session.agents.get('agent-1')).toBe(created.agent);
    expect(session.metadata.agents['agent-1']).toMatchObject({
      homedir: '/tmp/kimi-session/agents/agent-1',
      type: 'sub',
    });
  });

  it('shares the session McpConnectionManager with sub and main agents', async () => {
    const session = new Session({
      kaos: createFakeKaos({
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeText: vi.fn().mockResolvedValue(0),
      }),
      homedir: '/tmp/kimi-session',
      rpc: createSessionRpc(),
      initializeMainAgent: false,
    });

    const main = await session.createAgent({ type: 'main' });
    expect(main.agent.mcp).toBe(session.mcp);

    const sub = await session.createAgent({ type: 'sub' }, { parentAgentId: main.id });
    expect(sub.agent.mcp).toBe(session.mcp);
  });
});

function fakeSession(
  parent: Agent,
  child: Agent,
  metadataAgents: Session['metadata']['agents'] = {},
) {
  const agents = new Map<string, Agent>([['main', parent]]);
  if (metadataAgents['agent-0'] !== undefined) {
    agents.set('agent-0', child);
  }
  return {
    agents,
    options: { kimiHomeDir: undefined },
    metadata: {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      title: 'Test Session',
      isCustomTitle: false,
      agents: metadataAgents,
      custom: {},
    },
    writeMetadata: vi.fn(async () => {}),
    systemContextKaos: vi.fn((cwd: string) => parent.kaos.withCwd(cwd)),
    getReadyAgent: vi.fn((id: string) => agents.get(id)),
    ensureAgentResumed: vi.fn(async (id: string) => {
      const agent = agents.get(id);
      if (agent === undefined) {
        throw new Error(`Agent "${id}" was not found`);
      }
      return agent;
    }),
    createAgent: vi.fn(
      async (
        config: Parameters<Session['createAgent']>[0],
        options: Parameters<Session['createAgent']>[1] = {},
      ) => {
        agents.set('agent-0', child);
        const parentAgentId = options.parentAgentId ?? null;
        if (options.persistMetadata !== false) {
          metadataAgents['agent-0'] = {
            homedir: '/tmp/kimi-session/agents/agent-0',
            type: config.type ?? 'main',
            parentAgentId,
            swarmItem: options.swarmItem,
          };
        }
        if (options.profile !== undefined) {
          child.useProfile(options.profile);
        }
        return { id: 'agent-0', agent: child };
      },
    ),
  } as unknown as Session;
}

function contextProfile(): ResolvedAgentProfile {
  return {
    name: 'context-profile',
    systemPrompt: (context) =>
      [
        `cwd=${context.cwd}`,
        `listing=${context.cwdListing ?? ''}`,
        `agents=${context.agentsMd ?? ''}`,
        `additional=${context.additionalDirsInfo ?? ''}`,
      ].join('\n'),
    tools: [],
  };
}

function lookupToolRegistration() {
  return {
    name: 'Lookup',
    description: 'Look up a short test value.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  };
}

function profile(input: {
  readonly name: string;
  readonly tools: readonly string[];
  readonly systemPrompt: string;
  readonly description?: string | undefined;
  readonly subagents?: Record<string, ResolvedAgentProfile> | undefined;
}): ResolvedAgentProfile {
  return {
    name: input.name,
    description: input.description,
    systemPrompt: () => input.systemPrompt,
    tools: [...input.tools],
    subagents: input.subagents,
  };
}

function stat(kind: 'dir' | 'file') {
  return {
    stMode: kind === 'dir' ? 0o040000 : 0o100000,
    stIno: 0,
    stDev: 0,
    stNlink: 1,
    stUid: 0,
    stGid: 0,
    stSize: 0,
    stAtime: 0,
    stMtime: 0,
    stCtime: 0,
  };
}

function queuedTask(index: number): QueuedSubagentTask<number> {
  return {
    kind: 'spawn',
    data: index,
    profileName: 'coder',
    parentToolCallId: 'call_swarm',
    prompt: `Review item-${String(index)}`,
    description: `Review #${String(index)}`,
    swarmIndex: index,
    runInBackground: false,
  };
}

function textResult(text: string): Awaited<ReturnType<GenerateFn>> {
  return {
    id: 'mock-text',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      toolCalls: [],
    },
    usage: {
      inputOther: 0,
      output: 0,
      inputCacheRead: 0,
      inputCacheCreation: 0,
    },
    finishReason: 'completed',
    rawFinishReason: 'stop',
  };
}

function userTextMessages(history: readonly Message[]): string[] {
  return history
    .filter((message) => message.role === 'user')
    .map((message) =>
      message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(''),
    )
    .filter((text) => !text.startsWith('<system-reminder>'));
}

async function writeWire(homedir: string, records: readonly Record<string, unknown>[]) {
  await mkdir(homedir, { recursive: true });
  const wireRecords =
    records.length === 0
      ? []
      : [
          {
            type: 'metadata',
            protocol_version: AGENT_WIRE_PROTOCOL_VERSION,
            created_at: 1,
          },
          ...records,
        ];
  const text = wireRecords.map((record) => JSON.stringify(record)).join('\n');
  await writeFile(join(homedir, 'wire.jsonl'), text.length === 0 ? '' : `${text}\n`, 'utf-8');
}

function childBashToolResultOutput(child: AgentTestContext): string | undefined {
  for (const entry of child.allEvents) {
    if (entry.type !== '[wire]' || entry.event !== 'context.append_loop_event') continue;
    const loopEvent = (
      entry.args as {
        event?: { type?: string; toolCallId?: string; result?: { output?: unknown } };
      }
    ).event;
    if (loopEvent?.type === 'tool.result' && loopEvent.toolCallId === 'call_bash') {
      const output = loopEvent.result?.output;
      return typeof output === 'string' ? output : undefined;
    }
  }
  return undefined;
}

function bashCall(): ToolCall {
  return {
    type: 'function',
    id: 'call_bash',
    name: 'Bash',
      arguments: '{"command":"printf should-not-run","timeout":60}',
  };
}

function createSessionRpc(): SDKSessionRPC {
  return new Proxy(
    {},
    {
      get: () => vi.fn(),
    },
  ) as SDKSessionRPC;
}

import { __testing__ as hostTesting } from '../../src/session/subagent/subagent-host';

const { providerRateLimitErrorFromPayload } = hostTesting;

describe('providerRateLimitErrorFromPayload', () => {
  // The batch uses the request-id on the typed error to attribute the
  // rate-limit hit to the right call site when scheduling the quiet
  // window. If requestId extraction drops a non-empty string (e.g. by
  // using `?? 'fallback'` instead of a null guard), the batch cannot
  // deduplicate concurrent rate-limit signals and would re-throttle the
  // same provider hit twice.

  it('extracts requestId from details when present', () => {
    const err = providerRateLimitErrorFromPayload({
      message: 'rate limit exceeded',
      code: 'provider.rate_limit',
      details: { requestId: 'req-abc-123' },
    });
    expect(err).toBeInstanceOf(APIProviderRateLimitError);
    expect(err.message).toBe('rate limit exceeded');
    expect(err.requestId).toBe('req-abc-123');
  });

  it('falls back to null when requestId is missing', () => {
    const err = providerRateLimitErrorFromPayload({
      message: 'rate limit',
      code: 'provider.rate_limit',
    });
    expect(err.requestId).toBeNull();
  });

  it('falls back to null when requestId is the wrong type', () => {
    // Defensive: some providers attach a numeric id, an object, or
    // undefined under the `requestId` key. Only string values survive
    // the type guard so the batch can safely compare them by reference.
    const err = providerRateLimitErrorFromPayload({
      message: 'rate limit',
      code: 'provider.rate_limit',
      details: { requestId: 42 },
    });
    expect(err.requestId).toBeNull();
  });
});

describe('resolveSubagentDeadlineMs', () => {
  afterEach(() => {
    delete process.env[SUBAGENT_DEADLINE_ENV];
  });

  it('lets the environment override win, including 0 (deadline disabled)', () => {
    process.env[SUBAGENT_DEADLINE_ENV] = '0';
    expect(resolveSubagentDeadlineMs()).toBe(0);
    expect(resolveSubagentDeadlineMs(1234)).toBe(0);

    process.env[SUBAGENT_DEADLINE_ENV] = '250';
    expect(resolveSubagentDeadlineMs()).toBe(250);
    expect(resolveSubagentDeadlineMs(9999)).toBe(250);
  });

  it('falls back to the explicit budget, then the default, when the override is unusable', () => {
    delete process.env[SUBAGENT_DEADLINE_ENV];
    expect(resolveSubagentDeadlineMs(1234)).toBe(1234);
    expect(resolveSubagentDeadlineMs()).toBe(DEFAULT_SUBAGENT_DEADLINE_MS);

    // Unparsable or negative values must fall back instead of silently
    // disabling the deadline.
    process.env[SUBAGENT_DEADLINE_ENV] = 'not-a-number';
    expect(resolveSubagentDeadlineMs(1234)).toBe(1234);

    process.env[SUBAGENT_DEADLINE_ENV] = '-5';
    expect(resolveSubagentDeadlineMs(1234)).toBe(1234);
  });
});
