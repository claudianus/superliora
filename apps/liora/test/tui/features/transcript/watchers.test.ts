import { describe, expect, it } from 'vitest';
import type { BackgroundTaskInfo } from '@superliora/sdk';

import {
  countWatchers,
  formatStillRunning,
  hasLiveWatchers,
  stillRunningLabel,
  watcherTotal,
} from '#/tui/features/transcript/watchers';

function processTask(taskId: string, status: BackgroundTaskInfo['status'] = 'running'): BackgroundTaskInfo {
  return {
    kind: 'process',
    taskId,
    description: 'sleep',
    status,
    startedAt: 1,
    endedAt: status === 'running' ? null : 2,
    command: 'sleep 30',
    pid: 1,
    exitCode: null,
  };
}

function agentTask(taskId: string, status: BackgroundTaskInfo['status'] = 'running'): BackgroundTaskInfo {
  return {
    kind: 'agent',
    taskId,
    description: 'explore',
    status,
    startedAt: 1,
    endedAt: status === 'running' ? null : 2,
    agentId: `agent-${taskId}`,
  };
}

function questionTask(taskId: string): BackgroundTaskInfo {
  return {
    kind: 'question',
    taskId,
    description: 'ask',
    status: 'running',
    startedAt: 1,
    endedAt: null,
    questionCount: 1,
  };
}

describe('countWatchers', () => {
  it('splits live process, question, and agent tasks and ignores terminals', () => {
    expect(
      countWatchers([
        processTask('p1'),
        processTask('p2', 'completed'),
        questionTask('q1'),
        agentTask('a1'),
        agentTask('a2', 'killed'),
      ]),
    ).toEqual({ commands: 1, questions: 1, subagents: 1 });
  });

  it('treats an empty map as no live watchers', () => {
    expect(hasLiveWatchers(undefined)).toBe(false);
    expect(hasLiveWatchers(new Map())).toBe(false);
    const live = new Map<string, BackgroundTaskInfo>([['p1', processTask('p1')]]);
    expect(hasLiveWatchers(live)).toBe(true);
    expect(watcherTotal(countWatchers(live.values()))).toBe(1);
  });
});

describe('formatStillRunning', () => {
  it('lists only non-zero kinds with plain-s plurals', () => {
    expect(formatStillRunning([[1, 'command'], [0, 'question'], [2, 'subagent']])).toBe(
      '1 command · 2 subagents still running',
    );
    expect(formatStillRunning([[2, 'command']])).toBe('2 commands still running');
    expect(formatStillRunning([[0, 'command']])).toBeUndefined();
  });
});

describe('stillRunningLabel', () => {
  it('leads with counts so leftover work is obvious at a glance', () => {
    expect(stillRunningLabel({ commands: 1, questions: 0, subagents: 0 })).toBe(
      '1 command still running',
    );
    expect(stillRunningLabel({ commands: 1, questions: 2, subagents: 3 })).toBe(
      '1 command · 2 questions · 3 subagents still running',
    );
    expect(stillRunningLabel({ commands: 0, questions: 0, subagents: 0 })).toBeUndefined();
  });
});
