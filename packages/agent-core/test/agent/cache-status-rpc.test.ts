import { describe, expect, it } from 'vitest';

import { buildTurnPrefixMaterial } from '#/agent/cache/cache-freeze-guard';
import { createRpcMethods } from '#/agent/rpc-methods';
import { testAgent } from './harness/agent';

describe('agent cache status RPC', () => {
  it('getCacheFrozen reflects CacheFreezeGuard mid-turn state', async () => {
    const ctx = testAgent();
    ctx.configure();
    const rpc = createRpcMethods(ctx.agent);

    expect(rpc.getCacheFrozen({})).toBe(false);

    ctx.agent.cacheFreezeGuard.freeze(buildTurnPrefixMaterial(ctx.agent.tools.enabledTools));
    expect(rpc.getCacheFrozen({})).toBe(true);

    ctx.agent.cacheFreezeGuard.clear();
    expect(rpc.getCacheFrozen({})).toBe(false);
  });

  it('getParallelToolsStatus reflects ToolParallelStatus mid-turn counters', async () => {
    const ctx = testAgent();
    ctx.configure();
    const rpc = createRpcMethods(ctx.agent);

    expect(rpc.getParallelToolsStatus({})).toEqual({ parallelToolsInFlight: 0 });

    ctx.agent.toolParallelStatus.sync(2, 2);
    expect(rpc.getParallelToolsStatus({})).toEqual({
      parallelToolsInFlight: 2,
      maxParallelTools: 2,
    });

    ctx.agent.toolParallelStatus.clearTurn();
    expect(rpc.getParallelToolsStatus({})).toEqual({
      parallelToolsInFlight: 0,
      maxParallelTools: 2,
    });
  });

  it('getUsage exposes cacheHitRate and cacheWarmStreak from UsageRecorder.status()', async () => {
    const ctx = testAgent();
    ctx.configure();
    const rpc = createRpcMethods(ctx.agent);

    expect(rpc.getUsage({})).toEqual({});

    ctx.agent.usage.record(
      'mock-model',
      {
        inputOther: 0,
        output: 10,
        inputCacheRead: 990,
        inputCacheCreation: 0,
      },
      'turn',
    );

    const usage = rpc.getUsage({});
    expect(usage.cacheHitRate).toBeCloseTo(1, 5);
    expect(usage.cacheWarmStreak).toBe(1);
  });

  it('getUsage exposes cacheDiagnostics.missReasons from step miss telemetry', async () => {
    const ctx = testAgent();
    ctx.configure();
    const rpc = createRpcMethods(ctx.agent);
    const coldStep = {
      inputOther: 50,
      output: 0,
      inputCacheRead: 50,
      inputCacheCreation: 0,
    };

    ctx.agent.usage.record('mock-model', coldStep, 'turn');
    ctx.agent.usage.recordCacheDiagnostics(
      ctx.agent.tools.loopTools,
      0,
      ctx.agent.context.history.length,
      coldStep,
      'mock-model',
    );

    expect(rpc.getUsage({}).cacheDiagnostics?.missReasons).toEqual({ schema_change: 1 });
  });
});
