import { describe, expect, it } from 'vitest';

import {
  NativeRenderLoop,
  RendererTicker,
  normalizeRendererTickerFps,
  type NativeRenderFrame,
  type NativeRenderLoopScheduler,
  type NativeRenderTimer,
} from '../src';

describe('NativeRenderLoop', () => {
  it('coalesces multiple render requests into a single frame', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const frames: NativeRenderFrame[] = [];
    const loop = new NativeRenderLoop({
      scheduler,
      render: (frame) => frames.push(frame),
    });

    loop.requestRender();
    loop.requestRender('resize');
    loop.start();

    expect(scheduler.activeTimers()).toHaveLength(1);
    scheduler.advance(0);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({
      timestamp: 0,
      deltaMs: 0,
      frame: 0,
      causes: ['request', 'resize'],
    });
    expect(loop.frameCount).toBe(1);
    expect(loop.hasPendingFrame).toBe(false);
  });

  it('limits frame cadence to the target FPS after the first frame', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const frames: NativeRenderFrame[] = [];
    const loop = new NativeRenderLoop({
      scheduler,
      targetFps: 10,
      render: (frame) => frames.push(frame),
    });

    loop.start();
    loop.requestRender();
    scheduler.advance(0);
    scheduler.advance(10);
    loop.requestRender();

    expect(scheduler.activeTimers()[0]?.dueAt).toBe(100);
    scheduler.advance(89);
    expect(frames).toHaveLength(1);
    scheduler.advance(1);

    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({
      timestamp: 100,
      deltaMs: 100,
      frame: 1,
      causes: ['request'],
    });
  });

  it('schedules input-driven frames immediately without FPS throttling', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const frames: NativeRenderFrame[] = [];
    const loop = new NativeRenderLoop({
      scheduler,
      targetFps: 10,
      render: (frame) => frames.push(frame),
    });

    loop.start();
    loop.requestRender();
    scheduler.advance(0);
    scheduler.advance(10);
    loop.requestRender('input');

    expect(scheduler.activeTimers()[0]?.dueAt).toBe(10);
    scheduler.advance(0);

    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({
      timestamp: 10,
      deltaMs: 10,
      frame: 1,
      causes: ['input'],
    });
  });

  it('runs animation callbacks before render and defers nested callbacks to the next frame', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const events: string[] = [];
    let value = 'before';
    const loop = new NativeRenderLoop({
      scheduler,
      targetFps: 20,
      render: (frame) => {
        events.push(`render:${frame.frame}:${value}:${frame.causes.join(',')}`);
      },
    });

    loop.start();
    loop.requestAnimationFrame((frame) => {
      events.push(`raf:${frame.frame}:${frame.deltaMs}`);
      value = 'after';
      loop.requestAnimationFrame((nextFrame) => {
        events.push(`nested:${nextFrame.frame}:${nextFrame.deltaMs}`);
        value = 'nested';
      });
    });
    scheduler.advance(0);
    scheduler.advance(49);
    expect(events).toEqual(['raf:0:0', 'render:0:after:animation']);
    scheduler.advance(1);

    expect(events).toEqual([
      'raf:0:0',
      'render:0:after:animation',
      'nested:1:50',
      'render:1:nested:animation',
    ]);
  });

  it('cancels an idle animation frame without rendering', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const frames: NativeRenderFrame[] = [];
    const loop = new NativeRenderLoop({
      scheduler,
      render: (frame) => frames.push(frame),
    });

    loop.start();
    const id = loop.requestAnimationFrame(() => {
      throw new Error('cancelled callback should not run');
    });
    loop.cancelAnimationFrame(id);
    scheduler.advance(0);

    expect(frames).toEqual([]);
    expect(scheduler.activeTimers()).toEqual([]);
    expect(loop.hasPendingFrame).toBe(false);
  });

  it('stops by clearing the pending timer and callbacks', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const frames: NativeRenderFrame[] = [];
    const loop = new NativeRenderLoop({
      scheduler,
      render: (frame) => frames.push(frame),
    });

    loop.start();
    loop.requestAnimationFrame(() => {
      throw new Error('stopped callback should not run');
    });
    expect(scheduler.activeTimers()).toHaveLength(1);
    loop.stop();
    scheduler.advance(0);

    expect(frames).toEqual([]);
    expect(loop.isStarted).toBe(false);
    expect(loop.hasPendingFrame).toBe(false);
  });

  it('can unref scheduled timers for CLI shutdown friendliness', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const loop = new NativeRenderLoop({
      scheduler,
      unrefTimers: true,
      render: () => {},
    });

    loop.start();
    loop.requestRender();

    expect(scheduler.activeTimers()[0]?.unrefCalls).toBe(1);
  });
});

describe('RendererTicker', () => {
  it('runs repeated ticks after the configured interval', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const ticks: number[] = [];
    const ticker = new RendererTicker({
      scheduler,
      fps: 10,
      onTick: () => ticks.push(scheduler.now()),
    });

    expect(scheduler.activeTimers()[0]?.dueAt).toBe(100);
    scheduler.advance(99);
    expect(ticks).toEqual([]);
    scheduler.advance(1);
    expect(ticks).toEqual([100]);
    expect(scheduler.activeTimers()[0]?.dueAt).toBe(200);

    ticker.dispose();
    scheduler.advance(100);
    expect(ticks).toEqual([100]);
  });

  it('pauses, resumes, gates ticks, and preserves beforeTick ordering', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const events: string[] = [];
    let shouldTick = false;
    const ticker = new RendererTicker({
      scheduler,
      fps: Number.POSITIVE_INFINITY,
      defaultFps: 12,
      maxFps: 30,
      minIntervalMs: 33,
      shouldTick: () => shouldTick,
      beforeTick: () => events.push(`before:${scheduler.now()}`),
      onTick: () => events.push(`tick:${scheduler.now()}`),
    });

    expect(ticker.intervalMs).toBe(83);
    scheduler.advance(83);
    expect(events).toEqual([]);

    shouldTick = true;
    scheduler.advance(83);
    expect(events).toEqual(['before:166', 'tick:166']);

    ticker.update({ enabled: false });
    scheduler.advance(200);
    expect(events).toEqual(['before:166', 'tick:166']);

    ticker.update({ enabled: true, fps: 60 });
    expect(ticker.intervalMs).toBe(33);
    scheduler.advance(33);
    expect(events).toEqual(['before:166', 'tick:166', 'before:399', 'tick:399']);

    ticker.dispose();
  });

  it('uses caller-resolved intervals for adaptive animation pacing', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const ticks: number[] = [];
    let intervalMs = 40;
    const ticker = new RendererTicker({
      scheduler,
      fps: 30,
      resolveIntervalMs: () => intervalMs,
      onTick: () => {
        ticks.push(scheduler.now());
        intervalMs = 200;
      },
    });

    expect(scheduler.activeTimers()[0]?.dueAt).toBe(40);
    scheduler.advance(40);
    expect(ticks).toEqual([40]);
    expect(scheduler.activeTimers()[0]?.dueAt).toBe(240);

    ticker.dispose();
  });

  it('normalizes ticker fps using caller-owned limits', () => {
    expect(normalizeRendererTickerFps(Number.NaN, { defaultFps: 12, maxFps: 30 })).toBe(12);
    expect(normalizeRendererTickerFps(500, { maxFps: 30 })).toBe(30);
    expect(normalizeRendererTickerFps(0, { minFps: 2 })).toBe(2);
    expect(normalizeRendererTickerFps(12.9)).toBe(12);
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

  activeTimers(): readonly FakeRenderLoopTimer[] {
    return this.timers.filter((timer) => !timer.cleared);
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
    return this.activeTimers()
      .filter((timer) => timer.dueAt <= target)
      .toSorted((a, b) => a.dueAt - b.dueAt)[0];
  }
}
