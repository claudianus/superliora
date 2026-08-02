import { describe, expect, it, vi } from 'vitest';

import {
  SessionEventGoalQueue,
  type GoalQueueEventHost,
  type GoalQueueSharedFlags,
} from '../../../src/tui/controllers/session-event/goal-queue';

function makeHost(): GoalQueueEventHost & {
  notices: Array<{ title: string; detail?: string; coalesceKey?: string }>;
  statuses: Array<{ msg: string; color?: string }>;
} {
  const notices: Array<{ title: string; detail?: string; coalesceKey?: string }> = [];
  const statuses: Array<{ msg: string; color?: string }> = [];
  return {
    notices,
    statuses,
    state: {
      appState: {
        notifications: { enabled: false, condition: 'always' },
      },
      terminalState: { notificationKeys: new Set() },
      toolOutputExpanded: false,
      transcriptContainer: { addChild: vi.fn() },
      todoPanel: { getTodos: () => [] },
      renderer: { invalidateFrame: vi.fn() },
    } as any,
    session: undefined,
    aborted: false,
    motionBeats: {} as any,
    requireSession: () => {
      throw new Error('no session');
    },
    setAppState: vi.fn(),
    showError: vi.fn(),
    showStatus: (msg, color) => {
      statuses.push({ msg, color });
    },
    showNotice: (title, detail, options) => {
      notices.push({ title, detail, coalesceKey: options?.coalesceKey });
    },
    track: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    appendTranscriptEntry: vi.fn(),
    sendNormalUserInput: vi.fn(),
    sendQueuedMessage: vi.fn(),
  };
}

function makeFlags(): GoalQueueSharedFlags {
  return {
    getGoalCompletionTurnEnded: () => false,
    setGoalCompletionTurnEnded: vi.fn(),
    getCurrentTurnHasAssistantText: () => true,
    setPendingModelBlockedFallback: vi.fn(),
  };
}

describe('SessionEventGoalQueue blocked notices (Loop38a)', () => {
  it('names budget blocks', () => {
    const host = makeHost();
    const queue = new SessionEventGoalQueue(host, makeFlags());

    queue.handleUpdated({
      type: 'goal.updated',
      change: {
        kind: 'lifecycle',
        status: 'blocked',
        reason: 'A configured budget was reached',
        actor: 'system',
      },
      snapshot: {
        goalId: 'g1',
        objective: 'ship',
        status: 'blocked',
      } as any,
    });

    expect(host.notices.some((n) => n.coalesceKey === 'goal-blocked-budget')).toBe(true);
    expect(host.statuses.some((s) => /budget/i.test(s.msg))).toBe(true);
  });

  it('names UserPromptSubmit hook blocks', () => {
    const host = makeHost();
    const queue = new SessionEventGoalQueue(host, makeFlags());

    queue.handleUpdated({
      type: 'goal.updated',
      change: {
        kind: 'lifecycle',
        status: 'blocked',
        reason: 'Blocked by UserPromptSubmit hook',
        actor: 'system',
      },
      snapshot: {
        goalId: 'g2',
        objective: 'ship',
        status: 'blocked',
      } as any,
    });

    expect(host.notices.some((n) => n.coalesceKey === 'goal-blocked-hook')).toBe(true);
    expect(host.statuses.some((s) => /UserPromptSubmit|hook/i.test(s.msg))).toBe(true);
  });
});
