import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  frameInvalidationIncludes,
  type Component,
  type NativeRenderLoopScheduler,
  type NativeRenderTimer,
} from '@harness-kit/tui-renderer';
import { createNativeTerminalRenderer, type TerminalRenderer } from '#/tui/renderer/lifecycle';
import { LioraNativeRootUI } from '#/tui/renderer/native-root-ui';

describe('LioraNativeRootUI frame invalidation', () => {
  it('coalesces same-turn lifecycle content and render requests into one frame', () => {
    const { onFrame, render, renderer, scheduler, ui } = createHarness();

    renderer.requestRender();
    renderer.invalidateFrame('content');
    scheduler.advance(0);

    expect(render).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(ui.frameInvalidationStats).toEqual({
      requestCount: 2,
      coalescedRequestCount: 1,
      flushCount: 1,
      layoutCount: 0,
      renderCount: 1,
      presentCount: 1,
    });
    renderer.stop();
  });

  it('unions lifecycle content and layout intent into one layout frame', () => {
    const { onFrame, render, renderer, scheduler, ui } = createHarness();

    renderer.invalidateFrame('content');
    renderer.invalidateFrame('layout');
    scheduler.advance(0);

    expect(render).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(ui.lastFrameInvalidation?.requiresLayout).toBe(true);
    expect(ui.frameInvalidationStats).toMatchObject({
      requestCount: 2,
      coalescedRequestCount: 1,
      flushCount: 1,
      layoutCount: 1,
      renderCount: 1,
      presentCount: 1,
    });
    renderer.stop();
  });

  it('marks input and renderer-owned resize as interactive', () => {
    const { component, input, output, renderer, scheduler, ui } = createHarness();
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
    renderer.stop();
  });

  it('keeps animation intent at ambient priority', () => {
    const { renderer, scheduler, ui } = createHarness();

    renderer.invalidateFrame('animation');
    scheduler.advance(20);

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
    renderer.stop();
  });

  it('defers requests made during the late render callback into one next frame', () => {
    const { onFrame, render, renderer, scheduler, ui } = createHarness();
    render.mockImplementation(() => {
      if (render.mock.calls.length !== 1) return;
      renderer.requestRender();
      ui.requestLayout();
    });

    renderer.requestRender();
    scheduler.advance(0);

    expect(render).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(ui.frameInvalidationStats).toMatchObject({
      requestCount: 3,
      coalescedRequestCount: 1,
      flushCount: 1,
      renderCount: 1,
      presentCount: 1,
    });

    scheduler.advance(20);
    expect(render).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(ui.frameInvalidationStats).toMatchObject({
      flushCount: 2,
      layoutCount: 1,
      renderCount: 2,
      presentCount: 2,
    });
    renderer.stop();
  });

  it('cancels pending work on stop and remains restartable', () => {
    const { onFrame, render, renderer, scheduler, ui } = createHarness();

    renderer.requestRender();
    expect(scheduler.activeTimers()).toHaveLength(1);
    renderer.stop();
    scheduler.advance(100);

    expect(render).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
    expect(scheduler.activeTimers()).toHaveLength(0);

    renderer.start();
    renderer.requestRender(true);
    scheduler.advance(0);

    expect(render).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(ui.frameInvalidationStats).toMatchObject({
      requestCount: 2,
      coalescedRequestCount: 0,
      flushCount: 1,
      renderCount: 1,
      presentCount: 1,
    });
    renderer.stop();
  });

  it('absorbs direct nativeRuntime requests as fallback invalidations', () => {
    const { nativeRuntime, onFrame, render, renderer, scheduler, ui } = createHarness();

    nativeRuntime.requestRender('quality');
    scheduler.advance(0);

    expect(render).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(ui.lastFrameInvalidation?.priority).toBe('normal');
    expect(frameInvalidationIncludes(ui.lastFrameInvalidation!, 'state')).toBe(true);
    expect(ui.frameInvalidationStats).toMatchObject({
      requestCount: 1,
      flushCount: 1,
      renderCount: 1,
      presentCount: 1,
    });
    renderer.stop();
  });

  it('preserves lifecycle auto-frame-hold release behavior', () => {
    let hold = true;
    const { nativeRuntime, onFrame, render, renderer, scheduler, ui } = createHarness();

    renderer.setAutoFrameHold(() => hold);
    renderer.requestRender();
    scheduler.advance(100);

    expect(nativeRuntime.areAutoFramesHeld).toBe(true);
    expect(renderer.autoFramesHeld).toBe(true);
    expect(render).not.toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();

    hold = false;
    renderer.setAutoFrameHold(undefined);
    renderer.requestRender(true);
    scheduler.advance(0);

    expect(nativeRuntime.areAutoFramesHeld).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(ui.frameInvalidationStats).toMatchObject({
      requestCount: 2,
      coalescedRequestCount: 1,
      flushCount: 1,
      renderCount: 1,
      presentCount: 1,
    });
    renderer.stop();
  });
});

function createHarness(): {
  component: InputComponent;
  input: FakeInput;
  nativeRuntime: LioraNativeRootUI['renderer'];
  onFrame: ReturnType<typeof vi.fn>;
  output: FakeOutput;
  render: ReturnType<typeof vi.fn>;
  renderer: TerminalRenderer;
  scheduler: FakeRenderLoopScheduler;
  ui: LioraNativeRootUI<InputComponent>;
} {
  const scheduler = new FakeRenderLoopScheduler();
  const input = new FakeInput();
  const output = new FakeOutput();
  const component = new InputComponent();
  const render = vi.fn();
  const onFrame = vi.fn();
  const ui = new LioraNativeRootUI<InputComponent>({
    input,
    output,
    scheduler,
    renderOnStart: false,
    onFrame,
  });
  ui.children.push(component);
  ui.setRenderCallback(render);
  const renderer = createNativeTerminalRenderer({ ui });
  renderer.start();
  return {
    component,
    input,
    nativeRuntime: ui.renderer,
    onFrame,
    output,
    render,
    renderer,
    scheduler,
    ui,
  };
}

class InputComponent implements Component {
  focused = false;
  inputs: string[] = [];

  invalidate(): void {}

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  render(_width: number): string[] {
    return [];
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
