import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDeferredTranscriptFormatQueueForTest,
  deferredTranscriptFormatQueueSizeForTest,
  flushDeferredTranscriptFormatQueueForTest,
  scheduleDeferredTranscriptFormat,
  setDeferredFormatHoldPredicateForTest,
  setDeferredFormatSchedulerForTest,
} from '#/tui/utils/transcript/deferred-format-queue';

describe('deferred transcript format queue', () => {
  afterEach(() => {
    clearDeferredTranscriptFormatQueueForTest();
    setDeferredFormatSchedulerForTest(undefined);
    setDeferredFormatHoldPredicateForTest(undefined);
  });

  it('drains jobs through the scheduler with a per-turn cap', () => {
    const ran: number[] = [];
    const scheduled: Array<() => void> = [];
    setDeferredFormatHoldPredicateForTest(() => false);
    setDeferredFormatSchedulerForTest((run) => {
      scheduled.push(run);
    });

    for (let i = 0; i < 5; i++) {
      scheduleDeferredTranscriptFormat(() => {
        ran.push(i);
      });
    }

    // One drain turn was scheduled; it runs at most 2 jobs then re-schedules.
    expect(scheduled.length).toBe(1);
    scheduled[0]!();
    expect(ran).toEqual([0, 1]);
    expect(scheduled.length).toBe(2);
    scheduled[1]!();
    expect(ran).toEqual([0, 1, 2, 3]);
    scheduled[2]!();
    expect(ran).toEqual([0, 1, 2, 3, 4]);
    expect(deferredTranscriptFormatQueueSizeForTest()).toBe(0);
  });

  it('holds drain while scroll activity is recent', () => {
    const ran: number[] = [];
    const scheduled: Array<() => void> = [];
    let hold = true;
    setDeferredFormatHoldPredicateForTest(() => hold);
    setDeferredFormatSchedulerForTest((run) => {
      scheduled.push(run);
    });

    scheduleDeferredTranscriptFormat(() => {
      ran.push(1);
    });
    expect(scheduled.length).toBe(1);
    scheduled[0]!();
    // Hold active: job stays queued, drain re-arms without running work.
    expect(ran).toEqual([]);
    expect(deferredTranscriptFormatQueueSizeForTest()).toBe(1);
    expect(scheduled.length).toBe(2);

    hold = false;
    scheduled[1]!();
    expect(ran).toEqual([1]);
    expect(deferredTranscriptFormatQueueSizeForTest()).toBe(0);
  });

  it('swallows job errors so one bad body cannot stall the queue', () => {
    const ran: string[] = [];
    setDeferredFormatHoldPredicateForTest(() => false);
    setDeferredFormatSchedulerForTest((run) => {
      run();
    });

    scheduleDeferredTranscriptFormat(() => {
      throw new Error('boom');
    });
    scheduleDeferredTranscriptFormat(() => {
      ran.push('ok');
    });
    flushDeferredTranscriptFormatQueueForTest();
    expect(ran).toEqual(['ok']);
  });
});
