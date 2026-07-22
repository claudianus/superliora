import { describe, expect, it, vi } from 'vitest';

import { QuestGridController } from '#/tui/controllers/quest-grid-controller';
import { AttentionController } from '#/tui/controllers/attention-controller';
import {
  syncQuestGridFromSnapshot,
  mapTaskStatusToQuestState,
  mapStreamingPhaseToQuestState,
  type QuestBridgeSnapshot,
} from '#/tui/controllers/quest-session-bridge';
import type { BackgroundTaskInfo } from '@superliora/sdk';

function makeGrid() {
  return new QuestGridController({
    getViewport: () => ({ x: 0, y: 0, width: 120, height: 40 }),
    requestRender: () => {},
  });
}

function makeAttention() {
  return new AttentionController({
    writeRaw: vi.fn(),
    requestRender: vi.fn(),
  });
}

function makeSnapshot(overrides: Partial<QuestBridgeSnapshot> = {}): QuestBridgeSnapshot {
  return {
    sessionId: 'sess-1',
    sessionTitle: 'Test Session',
    streamingPhase: 'idle',
    isCompacting: false,
    approvalPending: false,
    backgroundTasks: new Map(),
    workDir: '/tmp/test',
    sessionChangeCount: { added: 0, removed: 0 },
    currentActivity: undefined,
    todoProgress: undefined,
    contextUsage: 0,
    approvalSummary: undefined,
    ...overrides,
  };
}

function makeTask(taskId: string, status: BackgroundTaskInfo['status'], kind: 'agent' | 'process' | 'question' = 'agent'): BackgroundTaskInfo {
  const base = {
    taskId,
    description: `Task ${taskId}`,
    status,
    startedAt: Date.now() - 60_000,
    endedAt: status === 'running' ? null : Date.now(),
  };
  if (kind === 'agent') return { ...base, kind: 'agent' as const, subagentType: 'explore' };
  if (kind === 'process') return { ...base, kind: 'process' as const, command: 'npm test', pid: 123, exitCode: status === 'completed' ? 0 : null };
  return { ...base, kind: 'question' as const, questionCount: 2 };
}

describe('quest-session-bridge state mapping', () => {
  it('maps running task to running quest state', () => {
    expect(mapTaskStatusToQuestState('running')).toBe('running');
  });

  it('maps completed task to done quest state', () => {
    expect(mapTaskStatusToQuestState('completed')).toBe('done');
  });

  it('maps failed task to failed quest state', () => {
    expect(mapTaskStatusToQuestState('failed')).toBe('failed');
  });

  it('maps timed_out task to failed quest state', () => {
    expect(mapTaskStatusToQuestState('timed_out')).toBe('failed');
  });

  it('maps killed task to failed quest state', () => {
    expect(mapTaskStatusToQuestState('killed')).toBe('failed');
  });

  it('maps lost task to failed quest state', () => {
    expect(mapTaskStatusToQuestState('lost')).toBe('failed');
  });

  it('maps idle streaming phase to idle quest state', () => {
    expect(mapStreamingPhaseToQuestState('idle', false, false)).toBe('idle');
  });

  it('maps waiting phase to running quest state', () => {
    expect(mapStreamingPhaseToQuestState('waiting', false, false)).toBe('running');
  });

  it('maps thinking phase to running quest state', () => {
    expect(mapStreamingPhaseToQuestState('thinking', false, false)).toBe('running');
  });

  it('maps composing phase to running quest state', () => {
    expect(mapStreamingPhaseToQuestState('composing', false, false)).toBe('running');
  });

  it('maps shell phase to running quest state', () => {
    expect(mapStreamingPhaseToQuestState('shell', false, false)).toBe('running');
  });

  it('maps approval pending to waiting-approval quest state', () => {
    expect(mapStreamingPhaseToQuestState('idle', true, false)).toBe('waiting-approval');
  });

  it('maps compacting to blocked quest state', () => {
    expect(mapStreamingPhaseToQuestState('idle', false, true)).toBe('blocked');
  });

  it('approval takes priority over compacting', () => {
    expect(mapStreamingPhaseToQuestState('idle', true, true)).toBe('waiting-approval');
  });
});

describe('syncQuestGridFromSnapshot', () => {
  it('creates main session quest from snapshot', () => {
    const grid = makeGrid();
    const attention = makeAttention();
    syncQuestGridFromSnapshot(grid, attention, makeSnapshot());

    expect(grid.questCount).toBe(1);
    const quest = grid.getQuest('session:sess-1');
    expect(quest).toBeDefined();
    expect(quest!.name).toBe('Test Session');
    expect(quest!.state).toBe('idle');
  });

  it('creates background task quests', () => {
    const grid = makeGrid();
    const attention = makeAttention();
    const tasks = new Map<string, BackgroundTaskInfo>();
    tasks.set('t1', makeTask('t1', 'running'));
    tasks.set('t2', makeTask('t2', 'completed'));

    syncQuestGridFromSnapshot(grid, attention, makeSnapshot({ backgroundTasks: tasks }));

    expect(grid.questCount).toBe(3); // main + 2 tasks
    expect(grid.getQuest('task:t1')!.state).toBe('running');
    expect(grid.getQuest('task:t2')!.state).toBe('done');
  });

  it('updates existing quest state on change', () => {
    const grid = makeGrid();
    const attention = makeAttention();

    syncQuestGridFromSnapshot(grid, attention, makeSnapshot());
    expect(grid.getQuest('session:sess-1')!.state).toBe('idle');

    syncQuestGridFromSnapshot(grid, attention, makeSnapshot({ streamingPhase: 'thinking' }));
    expect(grid.getQuest('session:sess-1')!.state).toBe('running');
  });

  it('removes stale quests no longer in snapshot', () => {
    const grid = makeGrid();
    const attention = makeAttention();
    const tasks = new Map<string, BackgroundTaskInfo>();
    tasks.set('t1', makeTask('t1', 'running'));

    syncQuestGridFromSnapshot(grid, attention, makeSnapshot({ backgroundTasks: tasks }));
    expect(grid.questCount).toBe(2);

    // Second sync without the task → stale quest removed
    syncQuestGridFromSnapshot(grid, attention, makeSnapshot());
    expect(grid.questCount).toBe(1);
    expect(grid.getQuest('task:t1')).toBeUndefined();
  });

  it('triggers attention for failed background tasks', () => {
    const grid = makeGrid();
    const attention = makeAttention();
    const tasks = new Map<string, BackgroundTaskInfo>();
    tasks.set('t1', makeTask('t1', 'failed'));

    syncQuestGridFromSnapshot(grid, attention, makeSnapshot({ backgroundTasks: tasks }));

    expect(attention.isPulsing('task:t1')).toBe(true);
  });

  it('triggers attention for approval-pending main session', () => {
    const grid = makeGrid();
    const attention = makeAttention();

    syncQuestGridFromSnapshot(grid, attention, makeSnapshot({ approvalPending: true }));

    expect(attention.isPulsing('session:sess-1')).toBe(true);
    expect(grid.getQuest('session:sess-1')!.state).toBe('waiting-approval');
  });

  it('does not duplicate quests on repeated sync', () => {
    const grid = makeGrid();
    const attention = makeAttention();

    syncQuestGridFromSnapshot(grid, attention, makeSnapshot());
    syncQuestGridFromSnapshot(grid, attention, makeSnapshot());
    syncQuestGridFromSnapshot(grid, attention, makeSnapshot());

    expect(grid.questCount).toBe(1);
  });

  it('describes agent task step with subagent type', () => {
    const grid = makeGrid();
    const attention = makeAttention();
    const tasks = new Map<string, BackgroundTaskInfo>();
    tasks.set('t1', makeTask('t1', 'running', 'agent'));

    syncQuestGridFromSnapshot(grid, attention, makeSnapshot({ backgroundTasks: tasks }));

    expect(grid.getQuest('task:t1')!.planStep).toContain('explore');
  });

  it('describes process task step with command', () => {
    const grid = makeGrid();
    const attention = makeAttention();
    const tasks = new Map<string, BackgroundTaskInfo>();
    tasks.set('t1', makeTask('t1', 'running', 'process'));

    syncQuestGridFromSnapshot(grid, attention, makeSnapshot({ backgroundTasks: tasks }));

    expect(grid.getQuest('task:t1')!.planStep).toContain('npm test');
  });
});
