import { describe, expect, it } from 'vitest';

import type { Event } from '@superliora/sdk';

import {
  MISSION_COMPLETED_LINGER_MS,
  MISSION_RATE_EMA_INSTANT,
  MISSION_RATE_EMA_PREV,
  MISSION_RATE_MIN_SAMPLE_MS,
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

  it('keeps a rateSamples ring for densemode sparklines', () => {
    const { registry, advance, now } = createHarness();
    registry.apply(spawned('sa-1', { subagentName: 'spark' }));
    let tokens = 0;
    for (let i = 0; i < 10; i += 1) {
      advance(1_000);
      tokens += 1_500 + i * 100;
      registry.apply({
        type: 'subagent.progress',
        subagentId: 'sa-1',
        toolCount: i + 1,
        elapsedMs: (i + 1) * 1_000,
        tokens,
      } as Event);
    }
    const samples = registry.snapshot(now()).workers[0]!.rateSamples;
    expect(samples).toBeDefined();
    expect(samples!.length).toBeLessThanOrEqual(8);
    expect(samples!.length).toBeGreaterThan(0);
    // Ring is oldest → newest; last sample should be the latest EMA.
    expect(samples![samples!.length - 1]).toBe(
      registry.snapshot(now()).workers[0]!.tokenRatePerSec,
    );
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

  it('lingers completed and failed workers briefly, then prunes both', () => {
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

    // Still within linger — both terminal workers remain.
    advance(MISSION_COMPLETED_LINGER_MS - 1);
    snap = registry.snapshot(now());
    expect(snap.workers.map((w) => w.id).sort()).toEqual(['sa-bad', 'sa-ok']);

    advance(2);
    snap = registry.snapshot(now());
    expect(snap.workers).toHaveLength(0);
  });

  it('updates tok/s on progress samples ≥ min gap and EMA tracks bursts', () => {
    const { registry, advance, now } = createHarness();
    registry.apply(spawned('sa-1', { subagentName: 'pace' }));
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-1',
      toolCount: 1,
      elapsedMs: 100,
      tokens: 1_000,
    } as Event);
    expect(registry.snapshot(now()).workers[0]!.tokenRatePerSec).toBeUndefined();

    // Below the min sample gap — still no rate; baseline clock is held.
    advance(MISSION_RATE_MIN_SAMPLE_MS - 20);
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-1',
      toolCount: 2,
      elapsedMs: 180,
      tokens: 1_200,
    } as Event);
    expect(registry.snapshot(now()).workers[0]!.tokenRatePerSec).toBeUndefined();

    // Eligible beat pairs against the held baseline (includes the short-gap tokens).
    // 400 tokens over (min-20 + min) ms ≈ 400 / 0.18s when min=100.
    advance(MISSION_RATE_MIN_SAMPLE_MS);
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-1',
      toolCount: 3,
      elapsedMs: 280,
      tokens: 1_400,
    } as Event);
    const first = registry.snapshot(now()).workers[0]!.tokenRatePerSec;
    expect(first).toBeDefined();
    const heldWindowSec = (MISSION_RATE_MIN_SAMPLE_MS - 20 + MISSION_RATE_MIN_SAMPLE_MS) / 1000;
    expect(first!).toBeCloseTo(400 / heldWindowSec, 5);

    // Clean step after an eligible sample — EMA chases the new instant.
    advance(MISSION_RATE_MIN_SAMPLE_MS);
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-1',
      toolCount: 4,
      elapsedMs: 380,
      tokens: 1_900,
    } as Event);
    const second = registry.snapshot(now()).workers[0]!.tokenRatePerSec!;
    const instant = 5_000; // 500 tokens / 0.1s
    const expected = first! * MISSION_RATE_EMA_PREV + instant * MISSION_RATE_EMA_INSTANT;
    expect(second).toBeCloseTo(expected, 5);
    // Snappier than legacy 0.55/0.45 would have been on the same step.
    const legacy = first! * 0.55 + instant * 0.45;
    expect(Math.abs(second - instant)).toBeLessThan(Math.abs(legacy - instant));
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

  it('tracks child thinking/answer deltas as a live stream tail', () => {
    const { registry, advance, now } = createHarness();
    registry.apply(spawned('sa-1', { subagentName: 'plan' }));
    expect(
      registry.apply({
        type: 'thinking.delta',
        agentId: 'sa-1',
        sessionId: 's1',
        delta: 'First thought\n',
      } as Event),
    ).toBe(true);
    expect(registry.snapshot(now()).workers[0]).toMatchObject({
      liveKind: 'thinking',
      liveText: 'First thought',
    });

    advance(10);
    registry.apply({
      type: 'thinking.delta',
      agentId: 'sa-1',
      sessionId: 's1',
      delta: 'Second line about Phaser',
    } as Event);
    expect(registry.snapshot(now()).workers[0]!.liveText).toBe('Second line about Phaser');

    advance(10);
    registry.apply({
      type: 'assistant.delta',
      agentId: 'sa-1',
      sessionId: 's1',
      delta: 'Metal Slug uses run-and-gun loops',
    } as Event);
    expect(registry.snapshot(now()).workers[0]).toMatchObject({
      liveKind: 'answer',
      liveText: 'Metal Slug uses run-and-gun loops',
    });

    // Unknown agent ids are ignored.
    expect(
      registry.apply({
        type: 'assistant.delta',
        agentId: 'ghost',
        sessionId: 's1',
        delta: 'nope',
      } as Event),
    ).toBe(false);
  });

  it('clears the live stream when a tool call starts and humanizes JSON args', () => {
    const { registry, now } = createHarness();
    registry.apply(spawned('sa-1', { subagentName: 'scout' }));
    registry.apply({
      type: 'thinking.delta',
      agentId: 'sa-1',
      sessionId: 's1',
      delta: 'stale thought',
    } as Event);
    expect(registry.snapshot(now()).workers[0]!.liveText).toBe('stale thought');

    registry.apply({
      type: 'subagent.tool_call',
      subagentId: 'sa-1',
      toolCallId: 'tc-web',
      name: 'WebSearch',
      argsPreview: '{"query":"Phaser 3 platformer","limit":5}',
    } as Event);
    const snap = registry.snapshot(now());
    expect(snap.workers[0]!.liveText).toBeUndefined();
    expect(snap.workers[0]!.liveKind).toBeUndefined();
    expect(snap.workers[0]).toMatchObject({
      lastTool: 'WebSearch',
      lastTarget: 'Phaser 3 platformer',
    });
    expect(snap.ops[0]).toMatchObject({
      name: 'WebSearch',
      target: 'Phaser 3 platformer',
      status: 'running',
    });
  });

  it('attaches a compact result chip on settled ops without an existing chip', () => {
    const { registry, now } = createHarness();
    registry.apply(spawned('sa-1'));
    registry.apply({
      type: 'subagent.tool_call',
      subagentId: 'sa-1',
      toolCallId: 'tc-1',
      name: 'WebSearch',
      argsPreview: '{"query":"metal slug"}',
    } as Event);
    registry.apply({
      type: 'subagent.tool_result',
      subagentId: 'sa-1',
      toolCallId: 'tc-1',
      resultPreview: '5 results about Metal Slug wiki pages',
    } as Event);
    expect(registry.snapshot(now()).ops[0]).toMatchObject({
      status: 'ok',
      chip: '5 results about Metal Slug…',
    });
  });

  it('keeps active workers in spawn order when later heartbeats race', () => {
    const { registry, advance, now } = createHarness();
    registry.apply(spawned('sa-early', { subagentName: 'early' }));
    advance(100);
    registry.apply(spawned('sa-late', { subagentName: 'late' }));
    expect(registry.snapshot(now()).workers.map((w) => w.id)).toEqual(['sa-early', 'sa-late']);

    advance(500);
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-late',
      toolCount: 3,
      elapsedMs: 500,
      tokens: 4_000,
    } as Event);
    advance(500);
    registry.apply({
      type: 'subagent.progress',
      subagentId: 'sa-early',
      toolCount: 1,
      elapsedMs: 1_100,
      tokens: 900,
    } as Event);
    const snap = registry.snapshot(now());
    expect(snap.workers.map((w) => w.id)).toEqual(['sa-early', 'sa-late']);
    expect(snap.workers[0]!.spawnedAtMs).toBeLessThan(snap.workers[1]!.spawnedAtMs);
  });
});
