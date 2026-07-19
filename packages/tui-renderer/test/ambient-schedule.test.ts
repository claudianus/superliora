import { describe, expect, it, vi } from 'vitest';
import {
  RendererAmbientSchedule,
  rendererAmbientIntervalMs,
  type NativeRenderLoopScheduler,
  type NativeRenderTimer,
} from '../src';

describe('rendererAmbientIntervalMs', () => {
  it('keeps premium at 16ms when healthy and full quality', () => {
    expect(
      rendererAmbientIntervalMs({
        requested: 'premium',
        quality: 'full',
        health: 'healthy',
        backpressure: false,
      }),
    ).toBe(16);
  });

  it('soft-degrades premium to subtle ms under pressure', () => {
    expect(
      rendererAmbientIntervalMs({
        requested: 'premium',
        quality: 'balanced',
        health: 'healthy',
      }),
    ).toBe(100);
    expect(
      rendererAmbientIntervalMs({
        requested: 'premium',
        quality: 'full',
        health: 'watch',
      }),
    ).toBe(100);
    expect(
      rendererAmbientIntervalMs({
        requested: 'premium',
        quality: 'full',
        health: 'healthy',
        backpressure: true,
      }),
    ).toBe(100);
  });

  it('returns Infinity for off without forcing callers to special-case', () => {
    expect(rendererAmbientIntervalMs({ requested: 'off' })).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps subtle at subtle ms even when healthy', () => {
    expect(
      rendererAmbientIntervalMs({
        requested: 'subtle',
        quality: 'full',
        health: 'healthy',
      }),
    ).toBe(100);
  });
});

describe('RendererAmbientSchedule', () => {
  it('wakes requestRender on the shared scheduler', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const requestRender = vi.fn();
    const schedule = new RendererAmbientSchedule({
      scheduler,
      unrefTimers: true,
      requestRender,
      getContext: () => ({
        quality: 'full',
        health: 'healthy',
        backpressure: false,
      }),
    });

    schedule.set({
      enabled: true,
      resolveIntervalMs: () => 33,
    });
    scheduler.advance(33);
    expect(requestRender).toHaveBeenCalledTimes(1);

    schedule.set(undefined);
    requestRender.mockClear();
    scheduler.advance(100);
    expect(requestRender).not.toHaveBeenCalled();

    schedule.dispose();
  });

  it('passes live context into resolveIntervalMs', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const contexts: Array<{ backpressure: boolean }> = [];
    let backpressure = false;
    const schedule = new RendererAmbientSchedule({
      scheduler,
      requestRender: () => {},
      getContext: () => ({
        quality: 'full',
        health: 'healthy',
        backpressure,
      }),
    });

    schedule.set({
      enabled: true,
      resolveIntervalMs: (ctx) => {
        contexts.push({ backpressure: ctx.backpressure });
        return ctx.backpressure ? 140 : 33;
      },
    });
    scheduler.advance(33);
    expect(contexts.at(-1)).toEqual({ backpressure: false });
    backpressure = true;
    scheduler.advance(33);
    expect(contexts.at(-1)).toEqual({ backpressure: true });
    schedule.dispose();
  });

  it('does not start a ticker when disabled', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const requestRender = vi.fn();
    const schedule = new RendererAmbientSchedule({
      scheduler,
      requestRender,
      getContext: () => ({
        quality: 'full',
        health: 'healthy',
        backpressure: false,
      }),
    });

    schedule.set({
      enabled: false,
      resolveIntervalMs: () => 33,
    });
    scheduler.advance(100);
    expect(requestRender).not.toHaveBeenCalled();
    schedule.dispose();
  });

  it('keeps arming across shouldTick gates so wakes resume without reset', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const requestRender = vi.fn();
    let shouldTick = true;
    const schedule = new RendererAmbientSchedule({
      scheduler,
      requestRender,
      getContext: () => ({
        quality: 'full',
        health: 'healthy',
        backpressure: false,
      }),
    });

    schedule.set({
      enabled: true,
      shouldTick: () => shouldTick,
      resolveIntervalMs: () => 33,
    });

    scheduler.advance(33);
    expect(requestRender).toHaveBeenCalledTimes(1);

    shouldTick = false;
    scheduler.advance(33);
    expect(requestRender).toHaveBeenCalledTimes(1);

    shouldTick = true;
    scheduler.advance(33);
    expect(requestRender).toHaveBeenCalledTimes(2);

    schedule.dispose();
  });
});

class FakeRenderLoopTimer implements NativeRenderTimer {
  cleared = false;
  unrefCalls = 0;

  constructor(
    readonly dueAt: number,
    readonly callback: () => void,
  ) {}

  unref(): void {
    this.unrefCalls++;
  }
}

class FakeRenderLoopScheduler implements NativeRenderLoopScheduler {
  private time = 0;
  private timers: FakeRenderLoopTimer[] = [];

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): FakeRenderLoopTimer {
    const timer = new FakeRenderLoopTimer(this.time + Math.max(0, delayMs), callback);
    this.timers.push(timer);
    return timer;
  }

  clearTimeout(timer: NativeRenderTimer): void {
    (timer as FakeRenderLoopTimer).cleared = true;
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const timer = this.nextDueTimer(target);
      if (timer === undefined) break;
      this.time = timer.dueAt;
      timer.cleared = true;
      timer.callback();
    }
    this.time = target;
  }

  private nextDueTimer(target: number): FakeRenderLoopTimer | undefined {
    return this.timers
      .filter((timer) => !timer.cleared && timer.dueAt <= target)
      .toSorted((a, b) => a.dueAt - b.dueAt)[0];
  }
}
