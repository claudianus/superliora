import { describe, expect, it } from 'vitest';

import type { BackgroundTaskInfo } from '@superliora/sdk';

import {
  buildBackgroundAgentMetadata,
  buildBackgroundAgentTranscriptEntry,
  findAgentTaskId,
  shouldSurfaceSubagentModelNotice,
  subagentModelRouteNoticeText,
} from '#/tui/controllers/subagent-event/background';
import {
  isSubagentLifecycleEvent,
  isUserCancelledSubagentError,
  subagentFailureRetryNote,
  ultraSwarmMembersFromTeam,
} from '#/tui/controllers/subagent-event/helpers';

describe('subagent-event-helpers', () => {
  it('detects subagent lifecycle events', () => {
    expect(isSubagentLifecycleEvent({ type: 'subagent.spawned' } as any)).toBe(true);
    expect(isSubagentLifecycleEvent({ type: 'assistant.delta', delta: 'x' } as any)).toBe(false);
  });

  it('recognizes user-cancelled subagent errors', () => {
    expect(isUserCancelledSubagentError('Aborted by the user')).toBe(true);
    expect(isUserCancelledSubagentError('timeout')).toBe(false);
  });

  it('builds retry notes from optional failure extras', () => {
    const note = subagentFailureRetryNote({
      type: 'subagent.failed',
      subagentId: 'a1',
      parentToolCallId: 'tc1',
      error: 'boom',
      retryAttempt: 2,
      retryLimit: 3,
      fellBackToModel: 'cheap-model',
    } as any);
    expect(note).toBe('retrying (2/3) · fell back to cheap-model');
  });

  it('maps ultra swarm team experts to member metadata', () => {
    const members = ultraSwarmMembersFromTeam({
      experts: [
        {
          id: 'e1',
          name: 'Analyst',
          division: 'research',
          emoji: '🔬',
          role: 'research',
          coverageLane: 'docs',
          selectionReason: 'coverage',
          focus: 'read docs',
          dependsOn: [],
          taskIds: ['t1'],
        },
      ],
    } as any);
    expect(members).toEqual([
      {
        expertId: 'e1',
        name: 'Analyst',
        division: 'research',
        emoji: '🔬',
        coverageLane: 'docs',
        selectionReason: 'coverage',
        focus: 'read docs',
        dependsOn: [],
        taskIds: ['t1'],
      },
    ]);
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

  it('surfaces explore-model notices only for divergent explore profiles', () => {
    const models = {
      'kimi-model': { model: 'kimi-k2', provider: 'kimi', maxContextSize: 256_000 },
      'cheap-model': { model: 'cheap-1', provider: 'kimi', maxContextSize: 128_000 },
    } as import('#/tui/types').AppState['availableModels'];
    expect(
      shouldSurfaceSubagentModelNotice({
        modelAlias: 'cheap-model',
        subagentName: 'Explore agent',
        sessionModel: 'kimi-model',
        availableModels: models,
      }),
    ).toBe(true);
    expect(
      shouldSurfaceSubagentModelNotice({
        modelAlias: 'cheap-model',
        subagentName: 'Editor agent',
        sessionModel: 'kimi-model',
        availableModels: models,
      }),
    ).toBe(false);
  });

  it('formats model route notice text with display names', () => {
    const text = subagentModelRouteNoticeText('Explore agent', 'kimi-model', 'cheap-model', {
      'kimi-model': { model: 'kimi-k2', provider: 'kimi', maxContextSize: 256_000, displayName: 'Kimi K2' },
      'cheap-model': { model: 'cheap-1', provider: 'kimi', maxContextSize: 128_000, displayName: 'Cheap' },
    } as import('#/tui/types').AppState['availableModels']);
    expect(text).toBe('Explore agent: Kimi K2 → Cheap');
  });
});
