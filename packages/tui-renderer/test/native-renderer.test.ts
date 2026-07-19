import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  ANSI_BEGIN_SYNCHRONIZED_UPDATE,
  ANSI_CLEAR_SCREEN,
  ANSI_END_SYNCHRONIZED_UPDATE,
  ANSI_ENTER_ALTERNATE_SCREEN,
  ANSI_DISABLE_AUTO_WRAP,
  ANSI_ENABLE_AUTO_WRAP,
  ANSI_EXIT_ALTERNATE_SCREEN,
  ANSI_HIDE_CURSOR,
  ANSI_DISABLE_MOUSE_TRACKING,
  ANSI_DISABLE_SGR_MOUSE_MODE,
  ANSI_ENABLE_BRACKETED_PASTE,
  ANSI_ENABLE_FOCUS_EVENTS,
  ANSI_ENABLE_MOUSE_TRACKING,
  ANSI_ENABLE_SGR_MOUSE_MODE,
  ANSI_POP_KITTY_KEYBOARD_PROTOCOL,
  ANSI_PUSH_KITTY_KEYBOARD_PROTOCOL,
  ANSI_SHOW_CURSOR,
  CURSOR_MARKER,
  NativeInputRouter,
  NativeRootUI,
  NativeTerminalRenderer,
  createRendererRegionVfx,
  encodeTerminalClearBelowRow,
  renderNativeLayoutFrame,
  type NativeRenderLoopScheduler,
  type NativeRenderTimer,
} from '../src';

describe('NativeTerminalRenderer', () => {
  it('starts a terminal session and renders through the native frame backend', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const input = new FakeInput();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      input,
      output,
      scheduler,
      renderOnStart: true,
      screenMode: 'alternate',
      keyboardProtocol: 'kitty',
      rawMode: true,
      clearOnStart: true,
      hideCursor: true,
      render: ({ renderer: frameRenderer, size }) => {
        frameRenderer.writeText(0, 0, `${size.columns}x${size.rows}`);
      },
    });

    renderer.start();
    scheduler.advance(0);

    expect(input.rawModeCalls).toEqual([true]);
    expect(output.writes.slice(0, 4)).toEqual([
      ANSI_ENTER_ALTERNATE_SCREEN,
      ANSI_CLEAR_SCREEN,
      ANSI_HIDE_CURSOR,
      ANSI_PUSH_KITTY_KEYBOARD_PROTOCOL,
    ]);
    expect(output.writes.at(-1)).toMatch(/^\u001B\[1;1H80x24/);
    expect(renderer.lastFrame?.frame.causes).toEqual(['start']);
    expect(renderer.lastFrame?.present?.diff.totalCells).toBe(80 * 24);
    expect(renderer.frameRenderer.width).toBe(80);
    expect(renderer.frameRenderer.height).toBe(24);

    renderer.stop();

    expect(output.writes.slice(-3)).toEqual([
      ANSI_POP_KITTY_KEYBOARD_PROTOCOL,
      ANSI_SHOW_CURSOR,
      ANSI_EXIT_ALTERNATE_SCREEN,
    ]);
    expect(input.rawModeCalls).toEqual([true, false]);
  });

  it('coalesces resize events and renders at the latest terminal size', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const sizes: string[] = [];
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      onResize: (size) => sizes.push(`${size.columns}x${size.rows}`),
      render: ({ renderer: frameRenderer, size }) => {
        frameRenderer.writeText(0, 0, `${size.columns}x${size.rows}`);
      },
    });

    renderer.start();
    output.columns = 100;
    output.rows = 30;
    output.emit('resize');
    output.columns = 120;
    output.rows = 40;
    output.emit('resize');
    scheduler.advance(0);

    expect(sizes).toEqual(['100x30', '120x40']);
    expect(renderer.lastFrame?.frame.causes).toEqual(['resize']);
    expect(renderer.lastFrame?.size).toEqual({ columns: 120, rows: 40 });
    expect(renderer.frameRenderer.width).toBe(120);
    expect(renderer.frameRenderer.height).toBe(40);
    expect(output.writes.at(-1)).toMatch(/^\u001B\[1;1H120x40/);
    expect(renderer.lastFrame?.present?.diff.totalCells).toBe(120 * 40);
  });

  it('clears stale terminal rows below the viewport when shrinking on the main screen', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      screenMode: 'main',
      render: ({ renderer: frameRenderer, size }) => {
        frameRenderer.writeText(0, size.rows - 1, 'tail');
      },
    });

    renderer.start();
    scheduler.advance(0);
    const writesBeforeShrink = output.writes.length;

    output.rows = 20;
    output.emit('resize');
    scheduler.advance(0);

    expect(output.writes.slice(writesBeforeShrink, writesBeforeShrink + 1)).toEqual([
      encodeTerminalClearBelowRow(20),
    ]);
    expect(renderer.frameRenderer.height).toBe(20);
    expect(renderer.lastFrame?.size).toEqual({ columns: 80, rows: 20 });
  });

  it('does not clear below the viewport when shrinking on the alternate screen', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      screenMode: 'alternate',
      clearOnStart: true,
      render: () => {},
    });

    renderer.start();
    scheduler.advance(0);
    const writesBeforeShrink = output.writes.length;

    output.rows = 20;
    output.emit('resize');
    scheduler.advance(0);

    const shrinkWrites = output.writes.slice(writesBeforeShrink);
    expect(shrinkWrites).not.toContain(encodeTerminalClearBelowRow(20));
  });

  it('routes input and animation requests through the runtime facade', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const input = new FakeInput();
    const output = new FakeOutput();
    const inputs: Array<string | Buffer> = [];
    const inputEvents: string[] = [];
    const routedInputEvents: string[] = [];
    const events: string[] = [];
    const inputRouter = new NativeInputRouter();
    inputRouter.registerTarget({
      id: 'editor',
      onInput: (event) => {
        routedInputEvents.push(event.type === 'key' ? event.key : event.type);
        return true;
      },
    });
    inputRouter.focus('editor');
    const renderer = new NativeTerminalRenderer({
      input,
      output,
      scheduler,
      targetFps: 20,
      inputRouter,
      onInput: (data) => inputs.push(data),
      onInputEvent: (event) => inputEvents.push(event.type === 'key' ? event.key : event.type),
      render: ({ frame, renderer: frameRenderer }) => {
        events.push(`render:${frame.frame}:${frame.causes.join(',')}`);
        frameRenderer.writeText(0, 0, String(frame.frame));
      },
    });

    renderer.start();
    input.emit('data', 'x');
    input.emit('data', '\u001B[5~');
    renderer.requestAnimationFrame((frame) => {
      events.push(`raf:${frame.frame}`);
      renderer.requestRender('manual');
    });
    scheduler.advance(0);
    scheduler.advance(49);
    scheduler.advance(1);

    expect(inputs).toEqual(['x', '\u001B[5~']);
    expect(inputEvents).toEqual(['character', 'pageup']);
    expect(routedInputEvents).toEqual(['character', 'pageup']);
    expect(events).toEqual(['raf:0', 'render:0:animation', 'render:1:manual']);
  });

  it('schedules region VFX animation frames through the runtime facade', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const events: string[] = [];
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      targetFps: 20,
      synchronized: true,
      render: ({ frame, renderer: frameRenderer }) => {
        events.push(`render:${frame.frame}:${frame.causes.join(',')}`);
        frameRenderer.writeText(0, 0, String(frame.frame));
      },
    });
    const vfx = createRendererRegionVfx({
      preset: 'loading-shimmer',
      requested: 'premium',
      nowMs: 450,
    });

    renderer.start();

    expect(renderer.requestAnimationFrameForRegions([{ vfx: undefined }])).toBe(false);
    expect(renderer.requestAnimationFrameForRegions([{ vfx }])).toBe(true);
    expect(renderer.requestAnimationFrameForRegions([{ vfx }])).toBe(false);

    scheduler.advance(0);

    expect(events).toEqual(['render:0:animation']);
    expect(renderer.requestAnimationFrameForRegions([
      { vfx: { effect: { kind: 'pulse', progress: 0.5, nowMs: 450 } } },
    ])).toBe(false);
    expect(renderer.requestAnimationFrameForRegions([{ vfx }])).toBe(true);
    renderer.cancelRegionAnimationFrame();
    scheduler.advance(50);

    expect(events).toEqual(['render:0:animation']);
  });

  it('holds automatic render and animation frames until the host releases scrollback inspection', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const events: string[] = [];
    let holdAutoFrames = true;
    let label = 'start';
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      targetFps: 20,
      renderOnStart: true,
      trace: true,
      autoFrameHold: () => holdAutoFrames,
      render: ({ frame, renderer: frameRenderer }) => {
        events.push(`render:${frame.frame}:${frame.causes.join(',')}`);
        frameRenderer.writeText(0, 0, label);
      },
    });

    renderer.start();
    scheduler.advance(0);

    renderer.requestRender('request');
    const animationId = renderer.requestAnimationFrame((frame) => {
      events.push(`raf:${frame.frame}`);
    });
    scheduler.advance(100);

    expect(animationId).toBeLessThan(0);
    expect(renderer.areAutoFramesHeld).toBe(true);
    expect(events).toEqual(['render:0:start']);
    expect(rowText(renderer.frameRenderer.frame, 0).startsWith('start')).toBe(true);

    label = 'manual';
    renderer.requestRender('manual');
    scheduler.advance(0);

    expect(events).toEqual(['render:0:start', 'render:1:manual']);
    expect(rowText(renderer.frameRenderer.frame, 0).startsWith('manual')).toBe(true);

    label = 'released';
    holdAutoFrames = false;
    renderer.requestRender('manual');
    scheduler.advance(50);

    expect(renderer.areAutoFramesHeld).toBe(false);
    expect(events).toEqual([
      'render:0:start',
      'render:1:manual',
      'raf:2',
      'render:2:animation,request,manual',
    ]);
    expect(rowText(renderer.frameRenderer.frame, 0).startsWith('released')).toBe(true);
    expect(renderer.traceSnapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'marker', name: 'renderer.auto_frame_hold' }),
      expect.objectContaining({ kind: 'marker', name: 'renderer.auto_frame_release' }),
    ]));
    renderer.stop();
  });

  it('repaints input-driven frames while automatic frame hold is active', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const events: string[] = [];
    let label = 'start';
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      targetFps: 20,
      renderOnStart: true,
      autoFrameHold: () => true,
      render: ({ frame, renderer: frameRenderer }) => {
        events.push(`render:${frame.frame}:${frame.causes.join(',')}`);
        frameRenderer.writeText(0, 0, label);
      },
    });

    renderer.start();
    scheduler.advance(0);

    renderer.requestRender('request');
    scheduler.advance(100);
    expect(events).toEqual(['render:0:start']);

    label = 'typed';
    renderer.requestRender('input');
    scheduler.advance(0);

    expect(events).toEqual(['render:0:start', 'render:1:input']);
    expect(rowText(renderer.frameRenderer.frame, 0).startsWith('typed')).toBe(true);
    renderer.stop();
  });

  it('can explicitly release held automatic frames while the hold predicate remains active', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const events: string[] = [];
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      autoFrameHold: () => true,
      render: ({ frame, renderer: frameRenderer }) => {
        events.push(`render:${frame.frame}:${frame.causes.join(',')}`);
        frameRenderer.writeText(0, 0, 'released');
      },
    });

    renderer.start();
    renderer.requestRender('request');
    const animationId = renderer.requestAnimationFrame((frame) => {
      events.push(`raf:${frame.frame}`);
    });

    expect(animationId).toBeLessThan(0);
    expect(events).toEqual([]);

    renderer.releaseHeldAutoFrames();
    scheduler.advance(0);

    expect(renderer.areAutoFramesHeld).toBe(true);
    expect(events).toEqual(['raf:0', 'render:0:animation,request']);
    expect(rowText(renderer.frameRenderer.frame, 0).startsWith('released')).toBe(true);
    renderer.stop();
  });

  it('degrades cosmetic region VFX frames when inline synchronized output is unavailable', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const events: string[] = [];
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      targetFps: 20,
      render: ({ frame, renderer: frameRenderer }) => {
        events.push(`render:${frame.frame}:${frame.causes.join(',')}`);
        frameRenderer.writeText(0, 0, String(frame.frame));
      },
    });
    const vfx = createRendererRegionVfx({
      preset: 'loading-shimmer',
      requested: 'premium',
      nowMs: 450,
    });

    renderer.start();

    expect(renderer.requestAnimationFrameForRegions([{ vfx }])).toBe(false);
    scheduler.advance(0);

    expect(events).toEqual([]);

    renderer.requestAnimationFrame((frame) => {
      events.push(`raf:${frame.frame}`);
    });
    scheduler.advance(0);

    expect(events).toEqual(['raf:0', 'render:0:animation']);
  });

  it('allows hosts to force or disable region VFX animation frame policy', () => {
    const vfx = createRendererRegionVfx({
      preset: 'loading-shimmer',
      requested: 'premium',
      nowMs: 450,
    });
    const forced = new NativeTerminalRenderer({
      output: new FakeOutput(),
      scheduler: new FakeRenderLoopScheduler(),
      regionVfxFrames: 'always',
      render: () => {},
    });
    const disabled = new NativeTerminalRenderer({
      output: new FakeOutput(),
      scheduler: new FakeRenderLoopScheduler(),
      synchronized: true,
      regionVfxFrames: 'never',
      render: () => {},
    });

    forced.start();
    disabled.start();

    expect(forced.requestAnimationFrameForRegions([{ vfx }])).toBe(true);
    expect(disabled.requestAnimationFrameForRegions([{ vfx }])).toBe(false);
  });

  it('schedules region VFX in auto mode when synchronized output is enabled', () => {
    const vfx = createRendererRegionVfx({
      preset: 'loading-shimmer',
      requested: 'premium',
      nowMs: 450,
    });
    const renderer = new NativeTerminalRenderer({
      output: new FakeOutput(),
      scheduler: new FakeRenderLoopScheduler(),
      synchronized: true,
      regionVfxFrames: 'auto',
      render: () => {},
    });

    renderer.start();

    expect(renderer.requestAnimationFrameForRegions([{ vfx }])).toBe(true);
  });

  it('renders layout frames and schedules region VFX through the runtime facade', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const events: string[] = [];
    let callbackRuntime: NativeTerminalRenderer | undefined;
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      targetFps: 20,
      synchronized: true,
      renderOnStart: true,
      autoBeginFrame: false,
      render: ({ frame, runtime }) => {
        callbackRuntime = runtime;
        events.push(`render:${frame.frame}:${frame.causes.join(',')}`);
        return runtime.renderLayoutFrame([
          {
            id: 'body',
            rect: { x: 0, y: 0, width: 10, height: 1 },
            content: ['hello'],
            vfx: createRendererRegionVfx({
              preset: 'loading-shimmer',
              requested: 'premium',
              nowMs: frame.timestamp,
            }),
          },
        ]);
      },
    });

    renderer.start();
    scheduler.advance(0);

    expect(events).toEqual(['render:0:start']);
    expect(callbackRuntime).toBe(renderer);
    expect(rowText(renderer.frameRenderer.frame, 0).trim()).toBe('hello');

    scheduler.advance(50);

    expect(events).toEqual(['render:0:start', 'render:1:animation']);
  });

  it('opts into SGR mouse tracking and restores terminal state on stop', () => {
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      output,
      mouseTracking: 'sgr',
      render: ({ renderer: frameRenderer }) => {
        frameRenderer.writeText(0, 0, 'mouse');
      },
    });

    renderer.start();
    renderer.stop();

    expect(output.writes).toEqual([
      ANSI_ENABLE_MOUSE_TRACKING,
      ANSI_ENABLE_SGR_MOUSE_MODE,
      ANSI_DISABLE_SGR_MOUSE_MODE,
      ANSI_DISABLE_MOUSE_TRACKING,
    ]);
  });

  it('applies feature profiles to the terminal session and frame output', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      features: 'fullscreen-app',
      keyboardProtocol: undefined,
      renderOnStart: true,
      render: ({ renderer: frameRenderer }) => {
        frameRenderer.writeText(0, 0, 'profile');
      },
    });

    renderer.start();
    scheduler.advance(0);

    expect(output.writes.slice(0, 9)).toEqual([
      ANSI_ENTER_ALTERNATE_SCREEN,
      ANSI_CLEAR_SCREEN,
      ANSI_DISABLE_AUTO_WRAP,
      ANSI_HIDE_CURSOR,
      ANSI_ENABLE_BRACKETED_PASTE,
      ANSI_ENABLE_FOCUS_EVENTS,
      ANSI_ENABLE_MOUSE_TRACKING,
      ANSI_ENABLE_SGR_MOUSE_MODE,
      ANSI_PUSH_KITTY_KEYBOARD_PROTOCOL,
    ]);
    const frameOutput = output.writes.at(-1);
    expect(frameOutput?.startsWith(ANSI_BEGIN_SYNCHRONIZED_UPDATE)).toBe(true);
    expect(frameOutput).toContain('profile');
    expect(frameOutput?.endsWith(ANSI_END_SYNCHRONIZED_UPDATE)).toBe(true);

    renderer.stop();
  });

  it('passes feature color mode to frame output encoding', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      features: { colorMode: 'ansi256' },
      renderOnStart: true,
      render: ({ renderer: frameRenderer }) => {
        frameRenderer.writeText(0, 0, 'red', { fg: '#ff0000' });
      },
    });

    renderer.start();
    scheduler.advance(0);

    expect(output.writes.at(-1)).toContain('\u001B[0;38;5;196mred');
  });

  it('retains detected image protocol in merged runtime features', () => {
    const renderer = new NativeTerminalRenderer({
      output: new FakeOutput(),
      features: { imageProtocol: 'kitty' },
      render: () => {},
    });

    expect(renderer.session.features.imageProtocol).toBe('kitty');
  });

  it('records frame metrics for output size and frame-budget overruns', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      targetFps: 100,
      renderOnStart: true,
      render: ({ renderer: frameRenderer }) => {
        frameRenderer.writeText(0, 0, 'metrics');
        scheduler.advance(12);
      },
    });

    renderer.start();
    scheduler.advance(0);

    expect(renderer.lastFrame?.metrics).toMatchObject({
      startedAt: 0,
      endedAt: 12,
      durationMs: 12,
      targetFrameMs: 10,
      overBudget: true,
      changedCells: 80 * 24,
      outputCells: 80 * 24,
      outputRuns: 24,
      outputBridgedCells: 0,
      outputBridgedCellRatio: 0,
      scannedCells: 80 * 24,
      scannedRows: 24,
      dirtyRows: 0,
      totalCells: 80 * 24,
      compositionRowsVisited: 0,
      compositionRowsComposed: 0,
      compositionRowsReused: 0,
      lineCacheHits: 0,
      lineCacheMisses: 0,
    });
    expect(renderer.lastFrame?.metrics.outputBytes).toBeGreaterThan(0);
  });

  it('records sanitized renderer trace events and exports Chrome trace JSON', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const input = new FakeInput();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      input,
      output,
      scheduler,
      renderOnStart: true,
      trace: { maxEvents: 8 },
      render: ({ frame, renderer: frameRenderer }) => {
        frameRenderer.writeText(0, 0, `trace-${String(frame.frame)}`);
        scheduler.advance(4);
      },
    });

    renderer.start();
    input.emit('data', 'x');
    output.columns = 100;
    output.rows = 30;
    output.emit('resize');
    scheduler.advance(0);

    const snapshot = renderer.traceSnapshot;
    expect(snapshot).toMatchObject({
      enabled: true,
      maxEvents: 8,
      eventCount: 3,
      totalEvents: 3,
      droppedEvents: 0,
    });
    expect(snapshot.events.map((event) => event.kind)).toEqual(['input', 'resize', 'frame']);
    expect(snapshot.events[0]).toMatchObject({
      kind: 'input',
      input: {
        type: 'key',
        key: 'character',
        ctrl: false,
        alt: false,
        shift: false,
      },
    });
    expect(JSON.stringify(snapshot.events)).not.toContain('"text"');
    expect(JSON.stringify(snapshot.events)).not.toContain('"raw"');
    expect(snapshot.events[2]).toMatchObject({
      kind: 'frame',
      metrics: {
        outputMode: 'full',
        outputSynchronized: false,
        outputPolicyReason: 'disabled',
        outputEraseLine: false,
      },
    });

    const chromeTrace = renderer.exportTrace({ processName: 'test-renderer' });
    expect(chromeTrace.metadata).toEqual({
      source: 'tui-renderer',
      eventCount: 3,
      droppedEvents: 0,
    });
    expect(chromeTrace.traceEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ ph: 'M', name: 'process_name', args: { name: 'test-renderer' } }),
      expect.objectContaining({ ph: 'I', name: 'input:character' }),
      expect.objectContaining({ ph: 'I', name: 'resize' }),
      expect.objectContaining({
        ph: 'X',
        name: 'frame',
        args: expect.objectContaining({
          outputMode: 'full',
          outputSynchronized: false,
          outputPolicyReason: 'disabled',
          outputEraseLine: false,
        }),
      }),
      expect.objectContaining({ ph: 'X', name: 'render' }),
      expect.objectContaining({ ph: 'C', name: 'output bytes' }),
    ]));
  });

  it('defers render and animation frames while terminal output is backpressured', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeBackpressureOutput();
    const frames: Array<readonly string[]> = [];
    let label = 'first';
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      renderOnStart: true,
      trace: true,
      render: ({ frame, renderer: frameRenderer }) => {
        frames.push(frame.causes);
        frameRenderer.writeText(0, 0, label);
      },
    });

    renderer.start();
    scheduler.advance(0);

    expect(frames).toEqual([['start']]);
    expect(renderer.isOutputBackpressured).toBe(true);
    expect(renderer.quality).toMatchObject({
      level: 'balanced',
      lastChangeReason: 'output-backpressure',
    });
    expect(renderer.lastFrame?.metrics.outputBackpressure).toBe(true);

    label = 'second';
    renderer.requestRender('manual');
    let animatedFrame = 0;
    const animationId = renderer.requestAnimationFrame((frame) => {
      animatedFrame = frame.frame;
    });
    scheduler.advance(50);

    expect(animationId).toBeLessThan(0);
    expect(frames).toEqual([['start']]);
    expect(animatedFrame).toBe(0);

    output.backpressured = false;
    output.emit('drain');
    scheduler.advance(17);

    expect(renderer.isOutputBackpressured).toBe(false);
    expect(frames.at(-1)).toEqual(['animation', 'quality', 'manual']);
    expect(animatedFrame).toBeGreaterThan(0);
    expect(rowText(renderer.frameRenderer.frame, 0).startsWith('second')).toBe(true);
    expect(renderer.traceSnapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'marker', name: 'terminal.output_backpressure' }),
      expect.objectContaining({ kind: 'marker', name: 'terminal.output_drain' }),
    ]));
    renderer.stop();
  });

  it('keeps renderer trace history bounded and resettable', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      renderOnStart: true,
      trace: { maxEvents: 2 },
      render: ({ frame, renderer: frameRenderer }) => {
        frameRenderer.writeText(0, 0, `f${String(frame.frame)}`);
      },
    });

    renderer.start();
    scheduler.advance(0);
    renderer.requestRender('manual');
    scheduler.advance(17);
    renderer.requestRender('manual');
    scheduler.advance(17);

    expect(renderer.traceSnapshot).toMatchObject({
      eventCount: 2,
      totalEvents: 3,
      droppedEvents: 1,
    });
    expect(
      renderer.traceSnapshot.events.map((event) =>
        event.kind === 'frame' ? event.frameIndex : -1,
      ),
    ).toEqual([1, 2]);

    renderer.resetTrace();

    expect(renderer.traceSnapshot).toMatchObject({
      eventCount: 0,
      totalEvents: 0,
      droppedEvents: 0,
    });
  });

  it('aggregates rolling frame stats and emits per-frame callbacks', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const durations = [12, 3, 5];
    const frameCallbacks: string[] = [];
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      targetFps: 100,
      renderOnStart: true,
      statsWindowSize: 2,
      onFrame: (result, stats) => {
        frameCallbacks.push(
          `${String(result.frame.frame)}:${String(stats.frames)}:${String(stats.windowFrames)}`,
        );
      },
      render: ({ frame, renderer: frameRenderer }) => {
        frameRenderer.writeText(0, 0, `f${String(frame.frame)}`);
        scheduler.advance(durations[frame.frame] ?? 0);
      },
    });

    renderer.start();
    scheduler.advance(0);
    renderer.requestRender('manual');
    scheduler.advance(10);
    renderer.requestRender('manual');
    scheduler.advance(12);

    expect(frameCallbacks).toEqual(['0:1:1', '1:2:2', '2:3:2']);
    expect(renderer.stats).toMatchObject({
      frames: 3,
      windowFrames: 2,
      windowSize: 2,
      health: 'healthy',
      overBudgetFrames: 1,
      overBudgetRatio: 1 / 3,
      avgDurationMs: 4,
      maxDurationMs: 5,
      avgRenderCallbackDurationMs: 4,
      maxRenderCallbackDurationMs: 5,
      avgPresentDurationMs: 0,
      avgWriteDurationMs: 0,
      avgQualityDurationMs: 0,
      avgFrameBudgetRatio: 0.4,
      maxFrameBudgetRatio: 0.5,
    });
    expect(renderer.stats.totalOutputBytes).toBeGreaterThan(0);
    expect(renderer.stats.totalChangedCells).toBeGreaterThan(0);
    expect(renderer.stats.totalScannedRows).toBeGreaterThan(0);
    expect(renderer.stats.totalDirtyRows).toBeGreaterThan(0);
    expect(renderer.stats.last?.durationMs).toBe(5);

    renderer.resetStats();
    expect(renderer.stats).toMatchObject({
      frames: 0,
      windowFrames: 0,
      health: 'idle',
      avgDurationMs: 0,
      p95DurationMs: 0,
      p99DurationMs: 0,
      avgRenderCallbackDurationMs: 0,
      avgPresentDurationMs: 0,
    });
    expect(renderer.stats.last).toBeUndefined();
  });

  it('records layout composition and cache metrics in native frame stats', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      renderOnStart: true,
      autoBeginFrame: false,
      lineCache: true,
      compositionCache: true,
      render: ({ renderer: frameRenderer, lineCache, compositionCache }) =>
        renderNativeLayoutFrame(
          frameRenderer,
          [
            {
              rect: { x: 0, y: 0, width: 4, height: 1 },
              clear: true,
              content: ['ok'],
            },
          ],
          { composition: { lineCache, cache: compositionCache } },
        ),
    });

    renderer.start();
    scheduler.advance(0);
    renderer.requestRender('manual');
    scheduler.advance(17);

    expect(renderer.lastFrame?.metrics).toMatchObject({
      compositionRowsVisited: 1,
      compositionRowsComposed: 0,
      compositionRowsReused: 1,
      compositionReuseRatio: 1,
      lineCacheHits: 0,
      lineCacheMisses: 0,
      lineCacheHitRatio: 0,
    });
    expect(renderer.stats).toMatchObject({
      totalCompositionRowsComposed: 1,
      totalCompositionRowsReused: 1,
      totalLineCacheHits: 0,
      totalLineCacheMisses: 1,
      avgCompositionReuseRatio: 0.5,
    });
  });

  it('adapts render quality after repeated frame-budget misses', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const qualitiesSeenByRender: string[] = [];
    const qualitiesAfterFrame: string[] = [];
    const durations = [12, 12, 0];
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      targetFps: 100,
      renderOnStart: true,
      adaptiveQuality: { degradeAfterFrames: 2 },
      onFrame: (result) => {
        qualitiesAfterFrame.push(result.quality.level);
      },
      render: ({ frame, renderer: frameRenderer, quality }) => {
        qualitiesSeenByRender.push(quality.level);
        frameRenderer.writeText(0, 0, `q${quality.level}`);
        scheduler.advance(durations[frame.frame] ?? 0);
      },
    });

    renderer.start();
    scheduler.advance(0);
    renderer.requestRender('manual');
    scheduler.advance(10);
    renderer.requestRender('manual');
    scheduler.advance(12);

    expect(qualitiesSeenByRender).toEqual(['full', 'full', 'balanced']);
    expect(qualitiesAfterFrame).toEqual(['full', 'balanced', 'balanced']);
    expect(renderer.quality.level).toBe('balanced');
    expect(renderer.diagnostics).toMatchObject({
      severity: 'degraded',
      health: 'degraded',
      quality: { level: 'balanced' },
    });
    expect(renderer.diagnostics.issues.map((issue) => issue.code)).toContain('frame-budget');
    expect(renderer.diagnostics.issues.map((issue) => issue.code)).toContain('quality');
  });

  it('adapts render quality after sustained output volume pressure', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const qualitiesSeenByRender: string[] = [];
    const qualitiesAfterFrame: string[] = [];
    const qualityChanges: string[] = [];
    const frameCauses: Array<readonly string[]> = [];
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      targetFps: 100,
      renderOnStart: true,
      trace: true,
      adaptiveQuality: {
        degradeAfterOutputPressureFrames: 2,
        outputPressureBytes: 1,
      },
      onQualityChange: (change) => {
        qualityChanges.push(
          `${change.reason}:${change.previous.level}->${change.current.level}:${String(change.frame.frame)}`,
        );
      },
      onFrame: (result) => {
        qualitiesAfterFrame.push(result.quality.level);
      },
      render: ({ frame, renderer: frameRenderer, quality }) => {
        frameCauses.push(frame.causes);
        qualitiesSeenByRender.push(quality.level);
        frameRenderer.writeText(0, 0, `v${String(frame.frame)}`);
      },
    });

    renderer.start();
    scheduler.advance(0);
    renderer.requestRender('manual');
    scheduler.advance(10);
    scheduler.advance(10);

    expect(frameCauses).toEqual([['start'], ['manual'], ['quality']]);
    expect(qualitiesSeenByRender).toEqual(['full', 'full', 'balanced']);
    expect(qualitiesAfterFrame).toEqual(['full', 'balanced', 'balanced']);
    expect(renderer.quality).toMatchObject({
      level: 'balanced',
      lastChangeReason: 'output-pressure',
    });
    expect(qualityChanges).toEqual(['output-pressure:full->balanced:1']);
    expect(renderer.traceSnapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'marker',
        name: 'renderer.quality_change',
        args: expect.objectContaining({
          previous: 'full',
          current: 'balanced',
          reason: 'output-pressure',
        }),
      }),
    ]));
    renderer.stop();
  });

  it('accepts bounded line-cache options for native layout rendering', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      renderOnStart: true,
      autoBeginFrame: false,
      lineCache: { maxCells: 2 },
      render: ({ renderer: frameRenderer, lineCache }) =>
        renderNativeLayoutFrame(
          frameRenderer,
          [{ rect: { x: 0, y: 0, width: 3, height: 1 }, content: ['abc'] }],
          { composition: { lineCache } },
        ),
    });

    renderer.start();
    scheduler.advance(0);

    expect(renderer.lineCache?.snapshot()).toMatchObject({
      entries: 0,
      cells: 0,
      misses: 1,
    });
  });

  it('stops the render loop before restoring the terminal session', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const output = new FakeOutput();
    const renderer = new NativeTerminalRenderer({
      output,
      scheduler,
      screenMode: 'alternate',
      render: ({ renderer: frameRenderer }) => {
        frameRenderer.writeText(0, 0, 'late');
      },
    });

    renderer.start();
    renderer.requestRender();
    renderer.stop();
    scheduler.advance(0);

    expect(renderer.isStarted).toBe(false);
    expect(renderer.loop.frameCount).toBe(0);
    expect(output.writes).toEqual([ANSI_ENTER_ALTERNATE_SCREEN, ANSI_EXIT_ALTERNATE_SCREEN]);
  });

  it('runs a reusable native root UI with focused input and cursor projection', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const input = new FakeInput();
    const output = new FakeOutput();
    const component = new FakeFocusableComponent();
    const listenerCalls: string[] = [];
    const ui = new NativeRootUI({
      input,
      output,
      scheduler,
      targetFps: 100,
      hideCursor: true,
      renderOnStart: true,
    });

    ui.addChild(component);
    ui.setFocus(component);
    const disposeFirstListener = ui.addInputListener((data) => {
      listenerCalls.push(`first:${data}`);
      return { data: data.toUpperCase() };
    });
    ui.addInputListener((data) => {
      listenerCalls.push(`second:${data}`);
      return undefined;
    });

    ui.start();
    scheduler.advance(0);

    expect(component.focused).toBe(true);
    expect(ui.renderer.lastFrame?.present?.output).toContain('root');
    expect(ui.renderer.lastFrame?.present?.output).toContain(ANSI_SHOW_CURSOR);
    expect(ui.renderer.lastFrame?.present?.output).toContain('\u001B[1;3H');

    input.emit('data', 'a');
    scheduler.advance(10);

    expect(listenerCalls).toEqual(['first:a', 'second:A']);
    expect(component.inputs).toEqual(['A']);
    expect(ui.renderer.lastFrame?.frame.causes).toEqual(['request']);

    disposeFirstListener();
    ui.addInputListener((data) => {
      listenerCalls.push(`consume:${data}`);
      return { consume: true };
    });
    input.emit('data', 'b');
    scheduler.advance(10);

    expect(component.inputs).toEqual(['A']);
    expect(listenerCalls.slice(-2)).toEqual(['second:b', 'consume:b']);

    ui.terminal.setTitle('Root\u001BTitle');
    expect(output.writes.at(-1)).toBe('\u001B]0;RootTitle\u0007');

    ui.stop();
  });

  it('wakes ambient animation renders on the shared scheduler', () => {
    const scheduler = new FakeRenderLoopScheduler();
    const causes: string[][] = [];
    const renderer = new NativeTerminalRenderer({
      input: new FakeInput(),
      output: new FakeOutput(),
      scheduler,
      unrefTimers: true,
      renderOnStart: false,
      render: ({ frame }) => {
        causes.push([...frame.causes]);
      },
    });
    renderer.start();
    renderer.setAmbientSchedule({
      enabled: true,
      resolveIntervalMs: () => 33,
    });
    scheduler.advance(33);
    expect(causes.some((c) => c.includes('animation'))).toBe(true);
    renderer.setAmbientSchedule(undefined);
    const before = causes.length;
    scheduler.advance(100);
    expect(causes.length).toBe(before);
    renderer.stop();
  });
});

class FakeFocusableComponent {
  focused = false;
  inputs: string[] = [];

  invalidate(): void {}

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  render(_width: number): string[] {
    return [`${this.focused ? '>' : '-'} ${CURSOR_MARKER}\u001B[31mroot\u001B[0m`];
  }
}

function rowText(
  buffer: { readonly width: number; getCell(x: number, y: number): { readonly char: string } },
  y: number,
): string {
  return Array.from({ length: buffer.width }, (_, x) => buffer.getCell(x, y).char).join('');
}

class FakeInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  rawModeCalls: boolean[] = [];

  setRawMode(raw: boolean): void {
    this.rawModeCalls.push(raw);
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

class FakeBackpressureOutput extends FakeOutput {
  backpressured = true;

  override write(chunk: string): boolean {
    this.writes.push(chunk);
    return !this.backpressured;
  }
}

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
