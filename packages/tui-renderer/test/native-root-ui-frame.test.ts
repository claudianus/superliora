import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  NativeRootUI,
  frameInvalidationIncludes,
  type Component,
  type NativeRenderLoopScheduler,
  type NativeRenderTimer,
} from '../src';

describe('NativeRootUI frame invalidation', () => {
  it('coalesces same-turn render requests into one native frame', () => {
    const { component, onFrame, scheduler, ui } = createRoot();

    ui.requestRender();
    ui.requestRender();
    ui.requestRender();

    expect(component.renderCount).toBe(0);
    scheduler.advance(0);

    expect(component.renderCount).toBe(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(ui.frameInvalidationStats).toEqual({
      requestCount: 3,
      coalescedRequestCount: 2,
      flushCount: 1,
      layoutCount: 0,
      renderCount: 1,
      presentCount: 1,
    });
    ui.dispose();
  });

  it('unions layout intent without rendering the component tree twice', () => {
    const { component, scheduler, ui } = createRoot();

    ui.requestRender();
    ui.requestLayout();
    ui.requestRender();
    scheduler.advance(0);

    expect(component.renderCount).toBe(1);
    expect(ui.lastFrameInvalidation?.requiresLayout).toBe(true);
    expect(ui.frameInvalidationStats).toMatchObject({
      requestCount: 3,
      coalescedRequestCount: 2,
      flushCount: 1,
      layoutCount: 1,
      renderCount: 1,
      presentCount: 1,
    });
    ui.dispose();
  });

  it('marks input and resize as interactive invalidations', () => {
    const { component, input, output, scheduler, ui } = createRoot();
    ui.setFocus(component);
    scheduler.advance(0);
    ui.resetFrameInvalidationStats();

    input.emit('data', 'a');
    scheduler.advance(20);

    expect(component.inputs).toEqual(['a']);
    expect(ui.lastFrameInvalidation?.priority).toBe('interactive');
    expect(ui.lastFrameInvalidation?.requiresLayout).toBe(true);
    expect(frameInvalidationIncludes(ui.lastFrameInvalidation!, 'input')).toBe(true);

    ui.resetFrameInvalidationStats();
    output.columns = 100;
    output.emit('resize');
    scheduler.advance(20);

    expect(ui.lastFrameInvalidation?.priority).toBe('interactive');
    expect(ui.lastFrameInvalidation?.requiresLayout).toBe(true);
    expect(frameInvalidationIncludes(ui.lastFrameInvalidation!, 'resize')).toBe(true);
    expect(ui.frameInvalidationStats.layoutCount).toBe(1);
    ui.dispose();
  });

  it('keeps renderer-owned ambient animation at ambient priority', () => {
    const { scheduler, ui } = createRoot();
    ui.renderer.setAmbientSchedule({
      enabled: true,
      resolveIntervalMs: () => 33,
    });

    scheduler.advance(33);

    expect(ui.lastFrameInvalidation?.priority).toBe('ambient');
    expect(ui.lastFrameInvalidation?.requiresLayout).toBe(false);
    expect(frameInvalidationIncludes(ui.lastFrameInvalidation!, 'animation')).toBe(true);
    expect(ui.frameInvalidationStats).toMatchObject({
      requestCount: 1,
      flushCount: 1,
      layoutCount: 0,
      renderCount: 1,
      presentCount: 1,
    });
    ui.dispose();
  });

  it('defers requests made during render into exactly one next native frame', () => {
    const { component, onFrame, scheduler, ui } = createRoot();
    component.onRender = () => {
      if (component.renderCount !== 1) return;
      ui.requestRender();
      ui.requestLayout();
    };

    ui.requestRender();
    scheduler.advance(0);

    expect(component.renderCount).toBe(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(ui.frameInvalidationStats).toMatchObject({
      requestCount: 3,
      coalescedRequestCount: 1,
      flushCount: 1,
      renderCount: 1,
      presentCount: 1,
    });

    scheduler.advance(20);
    expect(component.renderCount).toBe(2);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(ui.frameInvalidationStats).toMatchObject({
      flushCount: 2,
      layoutCount: 1,
      renderCount: 2,
      presentCount: 2,
    });
    ui.dispose();
  });

  it('cancels pending work on dispose and ignores future requests', () => {
    const { component, onFrame, scheduler, ui } = createRoot();

    ui.requestRender();
    expect(scheduler.activeTimers()).toHaveLength(1);
    ui.dispose();
    ui.requestLayout();
    ui.start();
    scheduler.advance(100);

    expect(component.renderCount).toBe(0);
    expect(onFrame).not.toHaveBeenCalled();
    expect(scheduler.activeTimers()).toHaveLength(0);
    expect(ui.frameInvalidationStats).toMatchObject({
      requestCount: 1,
      flushCount: 0,
      renderCount: 0,
      presentCount: 0,
    });
  });

  it('renders renderer-owned start frames synchronously before same-frame present', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const component = new CountingComponent();
    const onFrame = vi.fn();
    const ui = new NativeRootUI({
      input: new FakeInput(),
      output,
      scheduler,
      renderOnStart: true,
      onFrame,
    });
    // Bypass addChild() so the start cause is the only invalidation source.
    ui.children.push(component);

    ui.start();
    scheduler.advance(0);

    expect(component.renderCount).toBe(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(ui.lastFrameInvalidation?.requiresLayout).toBe(true);
    expect(frameInvalidationIncludes(ui.lastFrameInvalidation!, 'layout')).toBe(true);
    expect(ui.frameInvalidationStats).toEqual({
      requestCount: 1,
      coalescedRequestCount: 0,
      flushCount: 1,
      layoutCount: 1,
      renderCount: 1,
      presentCount: 1,
    });
    ui.dispose();
  });
});

function createRoot(): {
  component: CountingComponent;
  input: FakeInput;
  onFrame: ReturnType<typeof vi.fn>;
  output: FakeOutput;
  scheduler: FakeRenderLoopScheduler;
  ui: NativeRootUI<CountingComponent>;
} {
  const scheduler = new FakeRenderLoopScheduler();
  const input = new FakeInput();
  const output = new FakeOutput();
  const component = new CountingComponent();
  const onFrame = vi.fn();
  const ui = new NativeRootUI<CountingComponent>({
    input,
    output,
    scheduler,
    renderOnStart: false,
    onFrame,
  });
  ui.children.push(component);
  ui.start();
  return { component, input, onFrame, output, scheduler, ui };
}

class CountingComponent implements Component {
  focused = false;
  inputs: string[] = [];
  renderCount = 0;
  onRender: (() => void) | undefined;

  invalidate(): void {}

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  render(_width: number): string[] {
    this.renderCount++;
    this.onRender?.();
    return [`frame-${this.renderCount}`];
  }
}

class FakeInput extends EventEmitter {
  isTTY = true;
  isRaw = false;

  setRawMode(raw: boolean): void {
    this.isRaw = raw;
  }

  setEncoding(_encoding: BufferEncoding): void {}

  resume(): void {}

  pause(): void {}
}

class FakeOutput extends EventEmitter {
  columns = 80;
  rows = 24;
  writes: string[] = [];

  write(chunk: string): void {
    this.writes.push(chunk);
  }
}

class FakeRenderLoopTimer implements NativeRenderTimer {
  cleared = false;

  constructor(
    readonly dueAt: number,
    readonly callback: () => void,
  ) {}

  unref(): void {}
}

class FakeRenderLoopScheduler implements NativeRenderLoopScheduler {
  private time = 0;
  private readonly timers: FakeRenderLoopTimer[] = [];

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
