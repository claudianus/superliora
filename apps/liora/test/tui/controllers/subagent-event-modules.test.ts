import { describe, expect, it } from 'vitest';

import type { BackgroundTaskInfo } from '@superliora/sdk';

import {
  buildBackgroundAgentMetadata,
  buildBackgroundAgentTranscriptEntry,
  findAgentTaskId,
} from '#/tui/controllers/subagent-event/background';
import { isSubagentLifecycleEvent } from '#/tui/controllers/subagent-event/helpers';

describe('subagent-event-helpers', () => {
  it('detects subagent lifecycle events', () => {
    expect(isSubagentLifecycleEvent({ type: 'subagent.spawned' } as any)).toBe(true);
    expect(isSubagentLifecycleEvent({ type: 'assistant.delta', delta: 'x' } as any)).toBe(false);
  });
});

describe('subagent-event-background', () => {
  it('finds background agent tasks by agent id first', () => {
    const tasks = new Map<string, BackgroundTaskInfo>([
      ['task-1', { kind: 'agent', taskId: 'task-1', agentId: 'agent-1', description: 'x' } as any],
    ]);
    const taskId = findAgentTaskId(
      'agent-1',
      { agentId: 'agent-1', parentToolCallId: 'tc1', agentName: 'Explore' },
      tasks,
    );
    expect(taskId).toBe('task-1');
  });

  it('falls back to the most recent description match', () => {
    const tasks = new Map<string, BackgroundTaskInfo>([
      ['task-old', { kind: 'agent', taskId: 'task-old', description: 'scan repo' } as any],
      ['task-new', { kind: 'agent', taskId: 'task-new', description: 'scan repo' } as any],
    ]);
    const taskId = findAgentTaskId(
      'unknown',
      { agentId: 'unknown', parentToolCallId: 'tc1', agentName: 'Explore', description: 'scan repo' },
      tasks,
    );
    expect(taskId).toBe('task-new');
  });

  it('builds background metadata from parent tool args', () => {
    const meta = buildBackgroundAgentMetadata(
      {
        type: 'subagent.spawned',
        subagentId: 'agent-1',
        parentToolCallId: 'tc1',
        subagentName: 'Explore',
        runInBackground: true,
        description: 'fallback',
      } as any,
      {
        id: 'tc1',
        name: 'Agent',
        args: { description: 'from parent' },
      } as any,
    );
    expect(meta.description).toBe('from parent');
  });

  it('builds transcript entries for background agent status', () => {
    const entry = buildBackgroundAgentTranscriptEntry(
      'started',
      {
        agentId: 'agent-1',
        parentToolCallId: 'tc1',
        agentName: 'Explore',
        description: 'scan repo',
      },
      'turn-1',
    );
    expect(entry.kind).toBe('status');
    expect(entry.turnId).toBe('turn-1');
    expect(entry.backgroundAgentStatus?.headline).toContain('Explore');
  });


});
