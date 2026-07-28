import { describe, expect, it, vi } from 'vitest';

import {
  FrameInvalidationCoordinator,
  frameInvalidationIncludes,
  type FrameInvalidation,
  type FrameInvalidationCancel,
  type FrameInvalidationSchedule,
} from '../src';

describe('FrameInvalidationCoordinator', () => {
  it('coalesces N requests from the same turn into one flush', () => {
    const scheduler = new DeterministicFrameScheduler();
    const frames: FrameInvalidation[] = [];
    const phases: string[] = [];
    const coordinator = new FrameInvalidationCoordinator({
      schedule: scheduler.schedule,
      layout: () => phases.push('layout'),
      render: (invalidation) => {
        phases.push('render');
        frames.push(invalidation);
      },
      present: () => phases.push('present'),
    });

    coordinator.request({ source: 'input', requiresLayout: false });
    coordinator.request({ source: 'stream', requiresLayout: false });
    coordinator.request({ source: 'animation', requiresLayout: false });
    coordinator.request({ source: 'layout', requiresLayout: false });
    coordinator.request({ source: 'resize', requiresLayout: false });
    coordinator.request({ source: 'state', requiresLayout: false });

    expect(scheduler.pendingCount).toBe(1);
    expect(frames).toEqual([]);
    scheduler.flushNext();

    expect(phases).toEqual(['render', 'present']);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.requestCount).toBe(6);
    for (const source of ['input', 'stream', 'animation', 'layout', 'resize', 'state'] as const) {
      expect(frameInvalidationIncludes(frames[0]!, source)).toBe(true);
    }
    expect(coordinator.stats.snapshot()).toEqual({
      requestCount: 6,
      coalescedRequestCount: 5,
      flushCount: 1,
      layoutCount: 0,
      renderCount: 1,
      presentCount: 1,
    });
  });

  it('unions the layout flag without letting false clear a pending layout', () => {
    const scheduler = new DeterministicFrameScheduler();
    const layouts: FrameInvalidation[] = [];
    const renders: FrameInvalidation[] = [];
    const coordinator = new FrameInvalidationCoordinator({
      schedule: scheduler.schedule,
      layout: (invalidation) => layouts.push(invalidation),
      render: (invalidation) => renders.push(invalidation),
      present: () => {},
    });

    coordinator.request({ source: 'animation', requiresLayout: false });
    coordinator.request({ source: 'layout', requiresLayout: true });
    coordinator.request({ source: 'state', requiresLayout: false });
    scheduler.flushNext();

    expect(layouts).toHaveLength(1);
    expect(renders[0]?.requiresLayout).toBe(true);
    expect(coordinator.stats.snapshot().layoutCount).toBe(1);
  });

  it('keeps interactive input priority when it coalesces with ambient work', () => {
    const scheduler = new DeterministicFrameScheduler();
    const frames: FrameInvalidation[] = [];
    const coordinator = new FrameInvalidationCoordinator({
      schedule: scheduler.schedule,
      layout: () => {},
      render: (invalidation) => frames.push(invalidation),
      present: () => {},
    });

    coordinator.request({ source: 'animation' });
    coordinator.request({ source: 'state' });
    coordinator.request({ source: 'input' });
    scheduler.flushNext();

    expect(frames[0]?.priority).toBe('interactive');
  });

  it('defers requests made during render into exactly one next flush', () => {
    const scheduler = new DeterministicFrameScheduler();
    const renderedFrames: number[] = [];
    let coordinator!: FrameInvalidationCoordinator;
    coordinator = new FrameInvalidationCoordinator({
      schedule: scheduler.schedule,
      layout: () => {},
      render: (invalidation) => {
        renderedFrames.push(invalidation.frame);
        if (invalidation.frame !== 0) return;
        coordinator.request({ source: 'stream', requiresLayout: false });
        coordinator.request({ source: 'state', requiresLayout: false });
      },
      present: () => {},
    });

    coordinator.request({ source: 'input', requiresLayout: false });
    scheduler.flushNext();

    expect(renderedFrames).toEqual([0]);
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.scheduleCount).toBe(2);

    scheduler.flushNext();
    expect(renderedFrames).toEqual([0, 1]);
    expect(scheduler.pendingCount).toBe(0);
    expect(coordinator.stats.snapshot()).toMatchObject({
      requestCount: 3,
      coalescedRequestCount: 1,
      flushCount: 2,
      renderCount: 2,
      presentCount: 2,
    });
  });

  it('cancels a pending flush on dispose and ignores future requests', () => {
    const scheduler = new DeterministicFrameScheduler();
    const render = vi.fn();
    const coordinator = new FrameInvalidationCoordinator({
      schedule: scheduler.schedule,
      layout: () => {},
      render,
      present: () => {},
    });

    coordinator.request({ source: 'state' });
    expect(coordinator.hasPendingFrame).toBe(true);
    coordinator.dispose();

    expect(scheduler.pendingCount).toBe(0);
    expect(coordinator.hasPendingFrame).toBe(false);
    coordinator.request({ source: 'input' });
    scheduler.flushAll();

    expect(render).not.toHaveBeenCalled();
    expect(scheduler.scheduleCount).toBe(1);
    expect(coordinator.stats.snapshot()).toMatchObject({
      requestCount: 1,
      flushCount: 0,
      renderCount: 0,
      presentCount: 0,
    });
  });

  it('uses only the injected scheduler and never reaches real timers', () => {
    const scheduler = new DeterministicFrameScheduler();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const coordinator = new FrameInvalidationCoordinator({
      schedule: scheduler.schedule,
      layout: () => {},
      render: () => {},
      present: () => {},
    });

    coordinator.request({ source: 'animation' });
    scheduler.flushAll();
    coordinator.dispose();

    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
    setIntervalSpy.mockRestore();
  });
});

interface ScheduledFrame {
  readonly callback: () => void;
  cancelled: boolean;
}

class DeterministicFrameScheduler {
  private readonly queue: ScheduledFrame[] = [];
  scheduleCount = 0;

  readonly schedule: FrameInvalidationSchedule = (callback) => {
    const scheduled: ScheduledFrame = { callback, cancelled: false };
    this.scheduleCount++;
    this.queue.push(scheduled);
    const cancel: FrameInvalidationCancel = () => {
      scheduled.cancelled = true;
    };
    return cancel;
  };

  get pendingCount(): number {
    return this.queue.filter((scheduled) => !scheduled.cancelled).length;
  }

  flushNext(): void {
    const scheduled = this.queue.find((candidate) => !candidate.cancelled);
    if (scheduled === undefined) throw new Error('No deterministic frame is pending');
    scheduled.cancelled = true;
    scheduled.callback();
  }

  flushAll(): void {
    while (this.pendingCount > 0) this.flushNext();
  }
}
