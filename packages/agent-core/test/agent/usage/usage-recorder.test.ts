import { describe, expect, it, vi } from 'vitest';

import { UsageRecorder } from '#/agent/usage/index';
import type { Agent } from '#/agent';
import type { TokenUsage } from '@superliora/kosong';

const u = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  inputOther: 0,
  output: 0,
  inputCacheRead: 0,
  inputCacheCreation: 0,
  ...over,
});

const makeAgentMock = () => {
  const records: Array<Record<string, unknown>> = [];
  const emit = vi.fn();
  const agent = {
    records: {
      logRecord: vi.fn((entry: Record<string, unknown>) => {
        records.push(entry);
      }),
    },
    emitStatusUpdated: emit,
  } as unknown as Agent;
  return { agent, records, emit };
};

describe('agent/usage — UsageRecorder', () => {
  it('begins and ends a turn without holding a per-turn record', () => {
    const rec = new UsageRecorder();
    rec.beginTurn();
    rec.endTurn();
    const status = rec.status();
    expect(status).toBeUndefined();
  });

  it('aggregates session-scope usage by model and exposes totals', () => {
    const rec = new UsageRecorder();
    rec.record('gpt-4o', u({ inputOther: 10, output: 20 }));
    rec.record('gpt-4o', u({ inputOther: 5, output: 5 }));
    rec.record('claude', u({ inputOther: 7, output: 3 }));
    const status = rec.status();
    expect(status).toBeDefined();
    expect(status?.byModel).toEqual({
      'gpt-4o': u({ inputOther: 15, output: 25 }),
      claude: u({ inputOther: 7, output: 3 }),
    });
    expect(status?.total).toEqual(u({ inputOther: 22, output: 28 }));
  });

  it('keeps the per-turn total only for "turn"-scope records and resets across turns', () => {
    const rec = new UsageRecorder();
    rec.record('m', u({ inputOther: 10 }), 'turn');
    rec.record('m', u({ inputOther: 5 }), 'turn');
    expect(rec.data().currentTurn).toEqual(u({ inputOther: 15 }));
    rec.endTurn();
    expect(rec.data().currentTurn).toBeUndefined();
    rec.beginTurn();
    rec.record('m', u({ inputOther: 1 }), 'turn');
    expect(rec.data().currentTurn).toEqual(u({ inputOther: 1 }));
  });

  it('does not affect the per-turn total when scope is "session"', () => {
    const rec = new UsageRecorder();
    rec.beginTurn();
    rec.record('m', u({ inputOther: 4 }), 'session');
    expect(rec.data().currentTurn).toBeUndefined();
  });

  it('returns undefined status when nothing has been recorded', () => {
    const rec = new UsageRecorder();
    expect(rec.status()).toBeUndefined();
  });

  it('logs to agent.records and emits a status update on every record call', () => {
    const { agent, records, emit } = makeAgentMock();
    const rec = new UsageRecorder(agent);
    rec.record('gpt-4o', u({ inputOther: 1 }), 'turn');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: 'usage.record',
      model: 'gpt-4o',
      usage: { inputOther: 1 },
      usageScope: 'turn',
    });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('does not crash when no agent is supplied', () => {
    const rec = new UsageRecorder();
    expect(() => rec.record('m', u({ inputOther: 1 }))).not.toThrow();
    expect(rec.status()?.total).toEqual(u({ inputOther: 1 }));
  });

  it('returns a defensive copy for both byModel entries and currentTurn', () => {
    const rec = new UsageRecorder();
    rec.record('m', u({ inputOther: 3 }), 'turn');
    const first = rec.data();
    const second = rec.data();
    expect(first).not.toBe(second);
    expect(first.byModel).not.toBe(second.byModel);
    expect(first.currentTurn).not.toBe(second.currentTurn);
    expect(first.currentTurn).toEqual(u({ inputOther: 3 }));
  });

  it('exposes the session cacheHitRate when total is present', () => {
    const rec = new UsageRecorder();
    rec.record('m', u({ inputOther: 20, inputCacheRead: 60, inputCacheCreation: 20 }));
    const status = rec.status();
    expect(status).toBeDefined();
    // inputTotal = 20 + 60 + 20 = 100; cacheRead = 60; rate = 0.6
    expect(status?.cacheHitRate).toBeCloseTo(0.6, 5);
  });

  it('returns cacheHitRate=0 when total has no cache reads (inputOther only)', () => {
    const rec = new UsageRecorder();
    rec.record('m', u({ inputOther: 1 }));
    const status = rec.status();
    expect(status).toBeDefined();
    expect(status?.cacheHitRate).toBe(0);
  });

  it('returns undefined status when no session-scope record has been made', () => {
    const rec = new UsageRecorder();
    // turn-scope records still aggregate into byModel; record nothing.
    expect(rec.status()).toBeUndefined();
  });
});
