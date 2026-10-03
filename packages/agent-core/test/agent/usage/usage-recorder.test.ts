import { describe, expect, it } from 'vitest';

import { UsageRecorder } from '#/agent/usage/index';
import type { TokenUsage } from '@superliora/kosong';

const u = (over: Partial<TokenUsage> = {}): TokenUsage => ({
  inputOther: 0,
  output: 0,
  inputCacheRead: 0,
  inputCacheCreation: 0,
  ...over,
});


describe('agent/usage — UsageRecorder', () => {

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

  it('tracks warmHitStreak across consecutive warm turns with enough input tokens', () => {
    const rec = new UsageRecorder();
    const warmTurn = u({ inputOther: 1, inputCacheRead: 199 });
    rec.beginTurn();
    rec.record('m', warmTurn, 'turn');
    rec.endTurn();
    expect(rec.status()?.cacheWarmStreak).toBe(1);

    rec.beginTurn();
    rec.record('m', warmTurn, 'turn');
    rec.endTurn();
    expect(rec.status()?.cacheWarmStreak).toBe(2);
  });

  it('resets warmHitStreak when a qualifying turn misses the 99% target', () => {
    const rec = new UsageRecorder();
    const warmTurn = u({ inputOther: 1, inputCacheRead: 199 });
    rec.beginTurn();
    rec.record('m', warmTurn, 'turn');
    rec.endTurn();

    rec.beginTurn();
    rec.record('m', u({ inputOther: 50, inputCacheRead: 50 }), 'turn');
    rec.endTurn();
    expect(rec.status()?.cacheWarmStreak).toBeUndefined();
  });

  it('ignores turns below the minimum input token threshold for warm streak', () => {
    const rec = new UsageRecorder();
    rec.beginTurn();
    rec.record('m', u({ inputOther: 1, inputCacheRead: 98 }), 'turn');
    rec.endTurn();
    expect(rec.status()?.cacheWarmStreak).toBeUndefined();
  });

  it('increments warm streak at most once per agent turn', () => {
    const rec = new UsageRecorder();
    const warmStep = u({ inputOther: 0, inputCacheRead: 60 });
    rec.beginTurn();
    rec.record('m', warmStep, 'turn');
    rec.record('m', warmStep, 'turn');
    rec.endTurn();
    expect(rec.status()?.cacheWarmStreak).toBe(1);
  });


  it('accumulates cache miss-reason histogram on sub-target step cache hit rate', () => {
    const rec = new UsageRecorder();
    const tools = [{ name: 'Bash', description: 'run a shell command' }];
    const coldStep = u({ inputOther: 50, inputCacheRead: 50 });
    const warmStep = u({ inputOther: 1, inputCacheRead: 199 });

    rec.record('gpt-4o', coldStep, 'turn');
    rec.recordCacheDiagnostics(tools, 10, coldStep, 'gpt-4o');
    expect(rec.status()?.cacheDiagnostics?.missReasons).toEqual({ schema_change: 1 });

    rec.record('gpt-4o', warmStep, 'turn');
    rec.recordCacheDiagnostics(tools, 11, warmStep, 'gpt-4o');
    expect(rec.status()?.cacheDiagnostics?.missReasons).toEqual({ schema_change: 1 });

    rec.record('gpt-4o', coldStep, 'turn');
    rec.recordCacheDiagnostics(tools, 12, coldStep, 'gpt-4o');
    expect(rec.status()?.cacheDiagnostics?.missReasons).toEqual({ schema_change: 2 });
  });

  it('classifies tool-block changes as prefix_drift misses', () => {
    const rec = new UsageRecorder();
    const coldStep = u({ inputOther: 50, inputCacheRead: 50 });
    rec.record('gpt-4o', coldStep, 'turn');
    rec.recordCacheDiagnostics([{ name: 'Bash', description: 'run a shell command' }], 5, coldStep, 'gpt-4o');
    rec.record('gpt-4o', coldStep, 'turn');
    rec.recordCacheDiagnostics(
      [{ name: 'SessionControl', description: 'operate a session' }],
      6,
      coldStep,
      'gpt-4o',
    );
    expect(rec.status()?.cacheDiagnostics?.missReasons).toEqual({
      schema_change: 1,
      prefix_drift: 1,
    });
  });

  it('classifies model switches as model_switch misses', () => {
    const rec = new UsageRecorder();
    const coldStep = u({ inputOther: 50, inputCacheRead: 50 });
    rec.record('gpt-4o', coldStep, 'turn');
    rec.recordCacheDiagnostics([{ name: 'Bash', description: 'run a shell command' }], 5, coldStep, 'gpt-4o');
    rec.record('claude', coldStep, 'turn');
    rec.recordCacheDiagnostics([{ name: 'Bash', description: 'run a shell command' }], 6, coldStep, 'claude');
    expect(rec.status()?.cacheDiagnostics?.missReasons).toEqual({
      schema_change: 1,
      model_switch: 1,
    });
  });

  it('ignores steps below the warm-streak input threshold for miss reasons', () => {
    const rec = new UsageRecorder();
    const tinyStep = u({ inputOther: 5, inputCacheRead: 0 });
    rec.record('gpt-4o', tinyStep, 'turn');
    rec.recordCacheDiagnostics([{ name: 'Bash', description: 'run a shell command' }], 1, tinyStep, 'gpt-4o');
    expect(rec.status()?.cacheDiagnostics?.missReasons).toBeUndefined();
  });
});

