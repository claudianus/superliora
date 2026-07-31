import { describe, expect, it } from 'vitest';

import { ToolParallelStatus } from '../../src/loop/tool-parallel-status';

describe('ToolParallelStatus', () => {
  it('syncs in-flight and peak counters from ToolScheduler', () => {
    const status = new ToolParallelStatus();
    status.sync(2, 2);
    expect(status.snapshot()).toEqual({
      parallelToolsInFlight: 2,
      maxParallelTools: 2,
    });
    status.sync(1, 2);
    expect(status.snapshot()).toEqual({
      parallelToolsInFlight: 1,
      maxParallelTools: 2,
    });
  });

  it('clearTurn zeroes in-flight but keeps turn peak', () => {
    const status = new ToolParallelStatus();
    status.sync(3, 3);
    status.clearTurn();
    expect(status.snapshot()).toEqual({
      parallelToolsInFlight: 0,
      maxParallelTools: 3,
    });
  });
});
