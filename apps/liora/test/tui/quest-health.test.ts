import { describe, expect, it } from 'vitest';

import { questHealthScore, type Quest } from '#/tui/controllers/quest-types';

function makeQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 'q',
    name: 'Quest',
    sessionRef: 'session-q',
    state: 'running',
    createdAt: 0,
    lastActivityAt: 0,
    changeCount: { added: 0, removed: 0 },
    planStep: 'working',
    worktreePath: '/tmp/wt',
    pinned: false,
    approvalPending: false,
    ...overrides,
  };
}

describe('Gen 47: questHealthScore', () => {
  const NOW = 1_000_000;

  it('scores running highest among live states', () => {
    const running = questHealthScore(makeQuest({ state: 'running', lastActivityAt: NOW }), NOW);
    const idle = questHealthScore(makeQuest({ state: 'idle', lastActivityAt: NOW }), NOW);
    const blocked = questHealthScore(makeQuest({ state: 'blocked', lastActivityAt: NOW }), NOW);
    expect(running).toBeGreaterThan(idle);
    expect(idle).toBeGreaterThan(blocked);
  });

  it('anchors attention states low', () => {
    const waiting = questHealthScore(makeQuest({ state: 'waiting-approval', lastActivityAt: NOW }), NOW);
    const failed = questHealthScore(makeQuest({ state: 'failed', lastActivityAt: NOW }), NOW);
    expect(waiting).toBeLessThanOrEqual(25);
    expect(failed).toBeLessThanOrEqual(10);
  });

  it('erodes health as a live quest sits idle', () => {
    const fresh = questHealthScore(makeQuest({ state: 'running', lastActivityAt: NOW }), NOW);
    const stale = questHealthScore(
      makeQuest({ state: 'running', lastActivityAt: NOW - 15 * 60_000 }),
      NOW,
    );
    expect(stale).toBeLessThan(fresh);
    // 15 minutes of silence costs the full 30-point idle penalty.
    expect(fresh - stale).toBe(30);
  });

  it('does not apply the idle penalty to terminal quests', () => {
    const doneFresh = questHealthScore(makeQuest({ state: 'done', lastActivityAt: NOW }), NOW);
    const doneStale = questHealthScore(
      makeQuest({ state: 'done', lastActivityAt: NOW - 60 * 60_000 }),
      NOW,
    );
    expect(doneStale).toBe(doneFresh);
  });

  it('erodes health with context pressure', () => {
    const low = questHealthScore(makeQuest({ state: 'running', lastActivityAt: NOW, contextUsage: 0.1 }), NOW);
    const high = questHealthScore(makeQuest({ state: 'running', lastActivityAt: NOW, contextUsage: 0.9 }), NOW);
    expect(high).toBeLessThan(low);
  });

  it('clamps the result into 0–100', () => {
    const worst = questHealthScore(
      makeQuest({ state: 'failed', lastActivityAt: NOW - 60 * 60_000, contextUsage: 1 }),
      NOW,
    );
    const best = questHealthScore(makeQuest({ state: 'running', lastActivityAt: NOW }), NOW);
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(best).toBeLessThanOrEqual(100);
  });
});
