import { describe, expect, it } from 'vitest';

import type { Event } from '@superliora/sdk';

import {
  MISSION_COMPLETED_LINGER_MS,
  MissionControlRegistry,
} from '#/tui/controllers/mission-control/registry';

function createHarness(startMs = 1_000_000): {
  registry: MissionControlRegistry;
  advance: (ms: number) => void;
  now: () => number;
} {
  let now = startMs;
  return {
    registry: new MissionControlRegistry(() => now),
    advance: (ms) => {
      now += ms;
    },
    now: () => now,
  };
}

function spawned(id: string, over: Partial<Extract<Event, { type: 'subagent.spawned' }>> = {}): Event {
  return {
    type: 'subagent.spawned',
    subagentId: id,
    subagentName: over.subagentName ?? id,
    parentToolCallId: 'ptc-1',
    runInBackground: false,
    ...over,
  } as Event;
}

describe('MissionControlRegistry', () => {
  it('tracks the full subagent lifecycle with heartbeat telemetry', () => {
    const { registry, advance, now } = createHarness();
    registry.apply(spawned('sa-1', { subagentName: 'explore-1', modelAlias: 'gpt-5' }));
    let snap = registry.snapshot(now());
    expect(snap.activeCount).toBe(1);
    expect(snap.workers[0]).toMatchObject({
      id: 'sa-1',
      name: 'explore-1',
      status: 'running',
      modelAlias: 'gpt-5',
    });

    advance(5_000);
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-1',
      lastTool: 'Read',
      lastTarget: 'src/tui/panel.ts',
      toolCount: 12,
      elapsedMs: 5_000,
      tokens: 8_100,
      budgetMs: 60_000,
      budgetRemainingMs: 22_000,
    } as Event);
    snap = registry.snapshot(now());
    const worker = snap.workers[0]!;
    expect(worker).toMatchObject({
      lastTool: 'Read',
      lastTarget: 'src/tui/panel.ts',
      toolCount: 12,
      tokens: 8_100,
      budgetRemainingMs: 22_000,
    });
    // Elapsed derives from the heartbeat plus wall-clock since the beat.
    advance(2_000);
    expect(registry.snapshot(now()).workers[0]!.elapsedMs).toBe(7_000);
    expect(snap.totalTokens).toBe(8_100);
  });

  it('smooths tokenRatePerSec across progress heartbeats', () => {
    const { registry, advance, now } = createHarness();
    registry.apply(spawned('sa-1', { subagentName: 'pace-1' }));
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-1',
      toolCount: 1,
      elapsedMs: 1_000,
      tokens: 1_000,
    } as Event);
    expect(registry.snapshot(now()).workers[0]!.tokenRatePerSec).toBeUndefined();

    advance(1_000);
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-1',
      toolCount: 4,
      elapsedMs: 2_000,
      tokens: 3_000,
    } as Event);
    const rate = registry.snapshot(now()).workers[0]!.tokenRatePerSec;
    expect(rate).toBeDefined();
    // 2000 tokens over 1s → ~2000/s on the first delta.
    expect(rate!).toBeGreaterThan(1500);
    expect(rate!).toBeLessThan(2500);
  });

  it('marks finishing from the heartbeat and stalled from the stall signal', () => {
    const { registry, advance, now } = createHarness();
    registry.apply(spawned('sa-1'));
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-1',
      toolCount: 3,
      elapsedMs: 1_000,
      tokens: 100,
      finishing: true,
    } as Event);
    expect(registry.snapshot(now()).workers[0]!.status).toBe('finishing');

    registry.apply({
      type: 'subagent.stalled',
      subagentId: 'sa-1',
      silentMs: 300_000,
      toolCount: 3,
    } as Event);
    expect(registry.snapshot(now()).workers[0]!).toMatchObject({
      status: 'stalled',
      stalledSilentMs: 300_000,
    });

    // A fresh heartbeat clears the stall.
    advance(1_000);
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-1',
      toolCount: 4,
      elapsedMs: 2_000,
      tokens: 200,
    } as Event);
    const worker = registry.snapshot(now()).workers[0]!;
    expect(worker.status).toBe('running');
    expect(worker.stalledSilentMs).toBeUndefined();
  });

  it('settles ops-feed entries in place when the tool result lands', () => {
    const { registry, now } = createHarness();
    registry.apply(spawned('sa-1', { subagentName: 'builder-1' }));
    registry.apply({
      type: 'subagent.tool_call',
      subagentId: 'sa-1',
      toolCallId: 'tc-1',
      name: 'Edit',
      detail: { kind: 'edit', path: 'src/a.ts', addedLines: 42, removedLines: 10 },
    } as Event);
    let snap = registry.snapshot(now());
    expect(snap.ops).toHaveLength(1);
    expect(snap.ops[0]).toMatchObject({
      workerName: 'builder-1',
      name: 'Edit',
      target: 'src/a.ts',
      status: 'running',
    });
    expect(snap.ops[0]!.chip).toContain('+42');

    registry.apply({
      type: 'subagent.tool_result',
      subagentId: 'sa-1',
      toolCallId: 'tc-1',
      isError: true,
    } as Event);
    snap = registry.snapshot(now());
    expect(snap.ops).toHaveLength(1);
    expect(snap.ops[0]!.status).toBe('error');
    expect(snap.ops[0]!.settledAtMs).toBeDefined();
  });

  it('mirrors child todo ratios onto the worker row', () => {
    const { registry, now } = createHarness();
    registry.apply(spawned('sa-1'));
    registry.apply({
      type: 'subagent.todo.updated',
      subagentId: 'sa-1',
      subagentName: 'sa-1',
      parentToolCallId: 'ptc-1',
      todos: [
        { title: 'a', status: 'done' },
        { title: 'b', status: 'done' },
        { title: 'c', status: 'in_progress' },
        { title: 'd', status: 'pending' },
      ],
    } as unknown as Event);
    expect(registry.snapshot(now()).workers[0]!).toMatchObject({
      todoDone: 2,
      todoTotal: 4,
      focusTodo: 'c',
    });
  });

  it('falls back focusTodo to the first pending item', () => {
    const { registry, now } = createHarness();
    registry.apply(spawned('sa-1'));
    registry.apply({
      type: 'subagent.todo.updated',
      subagentId: 'sa-1',
      subagentName: 'sa-1',
      parentToolCallId: 'ptc-1',
      todos: [
        { title: 'done-one', status: 'done' },
        { title: 'next-up', status: 'pending' },
        { title: 'later', status: 'pending' },
      ],
    } as unknown as Event);
    expect(registry.snapshot(now()).workers[0]!.focusTodo).toBe('next-up');
  });

  it('lingers completed workers briefly, then prunes them; failed persist', () => {
    const { registry, advance, now } = createHarness();
    registry.apply(spawned('sa-ok'));
    registry.apply(spawned('sa-bad'));
    registry.apply({
      type: 'subagent.completed',
      subagentId: 'sa-ok',
      resultSummary: 'done',
      usage: { inputOther: 100, output: 50, inputCacheRead: 10, inputCacheCreation: 0 },
    } as Event);
    registry.apply({
      type: 'subagent.failed',
      subagentId: 'sa-bad',
      error: 'boom',
    } as Event);

    let snap = registry.snapshot(now());
    expect(snap.activeCount).toBe(0);
    expect(snap.workers.map((w) => w.id)).toEqual(['sa-bad', 'sa-ok']);
    expect(snap.workers[0]).toMatchObject({ status: 'failed', error: 'boom' });
    expect(snap.workers[1]!.tokens).toBe(160);

    advance(MISSION_COMPLETED_LINGER_MS + 1);
    snap = registry.snapshot(now());
    expect(snap.workers.map((w) => w.id)).toEqual(['sa-bad']);
  });

  it('dedups background agent tasks onto their subagent worker', () => {
    const { registry, now } = createHarness();
    registry.apply(spawned('sa-1', { runInBackground: true }));
    registry.apply({
      type: 'background.task.started',
      info: {
        kind: 'agent',
        taskId: 'task-1',
        agentId: 'sa-1',
        description: 'explore the codebase',
        status: 'running',
        startedAt: now(),
        endedAt: null,
      },
    } as Event);
    expect(registry.snapshot(now()).workers).toHaveLength(1);

    registry.apply({
      type: 'background.task.terminated',
      info: {
        kind: 'agent',
        taskId: 'task-1',
        agentId: 'sa-1',
        description: 'explore the codebase',
        status: 'completed',
        startedAt: now(),
        endedAt: now(),
      },
    } as Event);
    expect(registry.snapshot(now()).workers[0]!.status).toBe('completed');
  });

  it('tracks background processes as workers and fails them on abnormal exit', () => {
    const { registry, now } = createHarness();
    registry.apply({
      type: 'background.task.started',
      info: {
        kind: 'process',
        taskId: 'task-9',
        description: 'dev server',
        command: 'pnpm dev',
        pid: 1234,
        exitCode: null,
        status: 'running',
        startedAt: now(),
        endedAt: null,
      },
    } as Event);
    let snap = registry.snapshot(now());
    expect(snap.workers[0]).toMatchObject({
      kind: 'process',
      name: 'dev server',
      status: 'running',
    });
    expect(snap.activeCount).toBe(1);

    registry.apply({
      type: 'background.task.terminated',
      info: {
        kind: 'process',
        taskId: 'task-9',
        description: 'dev server',
        command: 'pnpm dev',
        pid: 1234,
        exitCode: 1,
        status: 'failed',
        stopReason: 'exit 1',
        startedAt: now(),
        endedAt: now(),
      },
    } as Event);
    snap = registry.snapshot(now());
    expect(snap.workers[0]).toMatchObject({ status: 'failed', error: 'exit 1' });
  });

  it('ignores question tasks and unrelated events', () => {
    const { registry, now } = createHarness();
    const changed = registry.apply({
      type: 'background.task.started',
      info: {
        kind: 'question',
        taskId: 'q-1',
        description: 'approve?',
        questionCount: 1,
        status: 'running',
        startedAt: now(),
        endedAt: null,
      },
    } as Event);
    expect(changed).toBe(false);
    expect(registry.snapshot(now()).workers).toHaveLength(0);
    expect(registry.apply({ type: 'tool.list.updated' } as unknown as Event)).toBe(false);
  });

  it('bumps the snapshot version on every mutation for render caching', () => {
    const { registry, now } = createHarness();
    const v0 = registry.snapshot(now()).version;
    registry.apply(spawned('sa-1'));
    const v1 = registry.snapshot(now()).version;
    expect(v1).toBeGreaterThan(v0);
    registry.reset();
    expect(registry.snapshot(now()).version).toBeGreaterThan(v1);
    expect(registry.snapshot(now()).workers).toHaveLength(0);
  });
});
