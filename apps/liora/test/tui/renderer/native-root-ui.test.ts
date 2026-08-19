import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  NativeRenderLoopScheduler,
  NativeRenderTimer,
} from '@harness-kit/tui-renderer';
import { LioraNativeRootUI } from '#/tui/renderer';

describe('LioraNativeRootUI input routing', () => {
  function createUI(): LioraNativeRootUI {
    const output = { write: vi.fn(), columns: 80, rows: 24 };
    return new LioraNativeRootUI({ output, input: undefined });
  }

  it('does not forward raw input to the focused component when an input router is set', () => {
    const ui = createUI();
    const focused = { handleInput: vi.fn() };
    ui.setFocus(focused as unknown as Parameters<LioraNativeRootUI['setFocus']>[0]);
    const router = { dispatch: vi.fn() };
    ui.setInputRouter(router);

    (ui as unknown as { handleRawInput(data: string): void }).handleRawInput('x');

    expect(focused.handleInput).not.toHaveBeenCalled();
    expect(router.dispatch).not.toHaveBeenCalled();
  });

  it('forwards raw input to the focused component when no input router is set', () => {
    const ui = createUI();
    const focused = { handleInput: vi.fn() };
    ui.setFocus(focused as unknown as Parameters<LioraNativeRootUI['setFocus']>[0]);

    (ui as unknown as { handleRawInput(data: string): void }).handleRawInput('x');

    expect(focused.handleInput).toHaveBeenCalledWith('x');
  });

  it('still runs raw input listeners before the router gate', () => {
    const ui = createUI();
    const focused = { handleInput: vi.fn() };
    const listener = vi.fn(() => ({ consume: true }));
    ui.addInputListener(listener);
    ui.setFocus(focused as unknown as Parameters<LioraNativeRootUI['setFocus']>[0]);
    const router = { dispatch: vi.fn() };
    ui.setInputRouter(router);

    (ui as unknown as { handleRawInput(data: string): void }).handleRawInput('x');

    expect(listener).toHaveBeenCalledWith('x');
    expect(focused.handleInput).not.toHaveBeenCalled();
    expect(router.dispatch).not.toHaveBeenCalled();
  });
});

describe('LioraNativeRootUI layout frame ownership', () => {
  const TRANSPORT_STABILITY_ENV = 'TUI_RENDERER_TRANSPORT_STABILITY';
  let previousTransportStability: string | undefined;

  beforeEach(() => {
    previousTransportStability = process.env[TRANSPORT_STABILITY_ENV];
    // Pin the transport so the driven frames are not delayed by the win32
    // unstable-transport frame floor.
    process.env[TRANSPORT_STABILITY_ENV] = 'synchronized';
  });

  afterEach(() => {
    if (previousTransportStability === undefined) {
      delete process.env[TRANSPORT_STABILITY_ENV];
    } else {
      process.env[TRANSPORT_STABILITY_ENV] = previousTransportStability;
    }
  });

  // Regression: the root UI left `autoBeginFrame` on, so the frame pipeline ran
  // its own beginFrame() before the render callback. With no fill that wipes the
  // back buffer to EMPTY, and the next damage-only frame reuses every cached row
  // — composing nothing over a blank buffer. The surface then presented as a
  // flat canvas fill and the UI strobed between itself and a bare rectangle.
  it('keeps the painted surface on a repeat damage-only frame', () => {
    const scheduler = new FakeScheduler();
    const output = new CollectingOutput();
    const ui = new LioraNativeRootUI({
      input: undefined,
      output,
      scheduler,
      renderOnStart: true,
      compositionCache: true,
      adaptiveQuality: false,
    });
    const frames: string[][] = [];
    ui.setRenderCallback(({ frame, runtime, size }) => {
      frames.push([...frame.causes]);
      return runtime.renderLayoutFrame(
        [
          {
            id: 'header',
            rect: { x: 0, y: 0, width: size.columns, height: 1 },
            content: ['SuperLiora'],
          },
        ],
        { fill: { char: ' ', style: { bg: '#0D1422' } }, clear: false },
      );
    });

    ui.start();
    scheduler.advance(0);
    expect(frames).toEqual([['start']]);
    expect(output.text()).toContain('SuperLiora');

    output.writes.length = 0;
    ui.requestRender('animation');
    scheduler.advance(64);

    // The second frame must actually run, and it must reuse the cached rows.
    expect(frames.at(-1)).toEqual(['animation']);
    // Nothing changed, so a damage-only frame emits nothing at all. Before the
    // fix this wrote a full-surface canvas fill that erased the header.
    expect(output.text()).toBe('');
    expect(rowText(ui.renderer.frameRenderer, 0)).toContain('SuperLiora');
    ui.stop();
  });
});

function rowText(
  frameRenderer: LioraNativeRootUI['renderer']['frameRenderer'],
  y: number,
): string {
  let text = '';
  for (let x = 0; x < frameRenderer.width; x++) {
    text += frameRenderer.frame.getCell(x, y).char;
  }
  return text;
}

class CollectingOutput {
  columns = 80;
  rows = 24;
  writes: string[] = [];

  write(chunk: string): void {
    this.writes.push(chunk);
  }

  text(): string {
    return this.writes.join('');
  }

  on(): this {
    return this;
  }

  off(): this {
    return this;
  }
}

class FakeTimer implements NativeRenderTimer {
  cleared = false;

  constructor(
    readonly dueAt: number,
    readonly callback: () => void,
  ) {}

  unref(): void {}
}

class FakeScheduler implements NativeRenderLoopScheduler {
  private time = 0;
  private readonly timers: FakeTimer[] = [];

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): FakeTimer {
    const timer = new FakeTimer(this.time + Math.max(0, delayMs), callback);
    this.timers.push(timer);
    return timer;
  }

  clearTimeout(timer: NativeRenderTimer): void {
    (timer as FakeTimer).cleared = true;
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const timer = this.timers
        .filter((candidate) => !candidate.cleared && candidate.dueAt <= target)
        .toSorted((a, b) => a.dueAt - b.dueAt)[0];
      if (timer === undefined) break;
      this.time = timer.dueAt;
      timer.cleared = true;
      timer.callback();
    }
    this.time = target;
  }
}
