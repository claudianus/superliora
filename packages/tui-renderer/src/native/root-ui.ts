import type { Component } from '../text/component';
import { isFocusable } from '../component-primitives/index';
import type { RendererCell, RendererCellBuffer, RendererCellStyle } from '../cell-buffer/index';
import { projectRendererCursorMarkerLine } from '../cursor-marker';
import {
  NativeTerminalRenderer,
  type NativeTerminalRendererFrame,
  type NativeTerminalRendererOptions,
} from '../native-renderer/index';
import {
  FrameInvalidationCoordinator,
  type FrameInvalidation,
  type FrameInvalidationRequest,
} from '../frame/invalidation';
import type { FrameInvalidationStatsSnapshot } from '../frame/stats';
import type { NativeRenderCause } from '../render-loop';
import type {
  NativeTerminalInput,
  NativeTerminalOutput,
} from '../terminal/session';
import type {
  RendererInputListener,
  RendererRootUI,
  RendererTerminalHost,
} from '../terminal/host';
import type { RendererCursorState } from '../terminal/output';

export interface NativeRootUIOptions
  extends Omit<NativeTerminalRendererOptions, 'render' | 'onInput'> {
  readonly input?: NativeTerminalInput;
  readonly output: NativeTerminalOutput;
  readonly requestRenderOnInput?: boolean;
}

export class NativeRendererTerminalHost implements RendererTerminalHost {
  constructor(
    private readonly output: NativeTerminalOutput,
    private readonly input: NativeTerminalInput | undefined,
  ) {}

  get columns(): number {
    return normalizeTerminalSize(this.output.columns, 80);
  }

  get rows(): number {
    return normalizeTerminalSize(this.output.rows, 24);
  }

  write(chunk: string): void {
    this.output.write(chunk);
  }

  async drainInput(): Promise<void> {
    await Promise.resolve();
  }

  setTitle(title: string): void {
    this.output.write(`\u001B]0;${sanitizeOscPayload(title)}\u0007`);
  }

  setProgress(_active: boolean): void {}

  get nativeInput(): NativeTerminalInput | undefined {
    return this.input;
  }

  get nativeOutput(): NativeTerminalOutput {
    return this.output;
  }
}

export class NativeRootUI<TComponent extends Component = Component>
  implements RendererRootUI<TComponent> {
  readonly children: TComponent[] = [];
  readonly terminal: NativeRendererTerminalHost;
  readonly renderer: NativeTerminalRenderer;

  private readonly inputListeners: RendererInputListener[] = [];
  private readonly frameInvalidation: FrameInvalidationCoordinator;
  private focusedComponent: TComponent | undefined;
  private readonly requestRenderOnInput: boolean;
  private currentNativeFrame: NativeTerminalRendererFrame | undefined;
  private pendingInvalidationFlush: (() => void) | undefined;
  private pendingRequestedCauseMask = 0;
  private lastFrameInvalidationValue: FrameInvalidation | undefined;
  private disposed = false;

  constructor(options: NativeRootUIOptions) {
    this.terminal = new NativeRendererTerminalHost(options.output, options.input);
    this.requestRenderOnInput = options.requestRenderOnInput !== false;
    this.frameInvalidation = new FrameInvalidationCoordinator({
      schedule: (flush) => {
        this.pendingInvalidationFlush = flush;
        return () => {
          if (this.pendingInvalidationFlush === flush) {
            this.pendingInvalidationFlush = undefined;
          }
        };
      },
      // Component.render() combines layout and cell rendering. The logical
      // layout phase is still counted, but the component tree is visited once.
      layout: () => {},
      render: (invalidation) => {
        this.lastFrameInvalidationValue = invalidation;
        this.renderCurrentNativeFrame();
      },
      // NativeTerminalRenderer presents immediately after its render callback.
      present: () => {},
    });
    this.renderer = new NativeTerminalRenderer({
      ...options,
      renderOnStart: options.renderOnStart ?? true,
      onInput: (data) => {
        this.handleRawInput(data);
      },
      render: (frame) => {
        this.renderNativeFrame(frame);
      },
    });
  }

  get frameInvalidationStats(): FrameInvalidationStatsSnapshot {
    return this.frameInvalidation.stats.snapshot();
  }

  get lastFrameInvalidation(): FrameInvalidation | undefined {
    return this.lastFrameInvalidationValue;
  }

  resetFrameInvalidationStats(): void {
    this.frameInvalidation.stats.reset();
  }

  start(): void {
    if (this.disposed) return;
    this.renderer.start();
  }

  stop(): void {
    this.frameInvalidation.cancelPending();
    this.pendingInvalidationFlush = undefined;
    this.pendingRequestedCauseMask = 0;
    this.renderer.stop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.frameInvalidation.dispose();
    this.pendingInvalidationFlush = undefined;
    this.pendingRequestedCauseMask = 0;
    this.renderer.stop();
  }

  requestRender(cause?: boolean | NativeRenderCause): void {
    const normalizedCause = normalizeNativeRootRenderCause(cause);
    this.requestFrame(
      nativeRootInvalidationForCause(normalizedCause, false),
      normalizedCause,
    );
  }

  requestLayout(cause?: boolean | NativeRenderCause): void {
    const normalizedCause = normalizeNativeRootRenderCause(cause);
    this.requestFrame(
      nativeRootInvalidationForCause(normalizedCause, true),
      normalizedCause,
    );
  }

  addChild(component: TComponent): void {
    this.children.push(component);
    this.requestLayout();
  }

  clear(): void {
    this.children.length = 0;
    this.focusedComponent = undefined;
    this.requestLayout(true);
  }

  setFocus(component: TComponent): void {
    if (this.focusedComponent === component) return;
    if (this.focusedComponent !== undefined && isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = component;
    if (isFocusable(component)) component.focused = true;
    this.requestRender();
  }

  addInputListener(listener: RendererInputListener): () => void {
    this.inputListeners.push(listener);
    return () => {
      const index = this.inputListeners.indexOf(listener);
      if (index !== -1) this.inputListeners.splice(index, 1);
    };
  }

  private requestFrame(
    invalidation: FrameInvalidationRequest,
    cause: NativeRenderCause,
  ): void {
    if (this.disposed) return;
    this.frameInvalidation.request(invalidation);
    this.pendingRequestedCauseMask |= NATIVE_RENDER_CAUSE_MASKS[cause];
    this.renderer.requestRender(cause);
  }

  private renderNativeFrame(frame: NativeTerminalRendererFrame): void {
    this.currentNativeFrame = frame;
    try {
      for (const cause of frame.frame.causes) {
        const causeMask = NATIVE_RENDER_CAUSE_MASKS[cause];
        if ((this.pendingRequestedCauseMask & causeMask) !== 0) {
          this.pendingRequestedCauseMask &= ~causeMask;
        } else {
          this.frameInvalidation.request(nativeRootInvalidationForCause(cause));
        }
      }
      if (!this.frameInvalidation.hasPendingFrame) {
        this.frameInvalidation.request({
          source: 'state',
          requiresLayout: true,
          priority: 'normal',
        });
      }

      const flush = this.pendingInvalidationFlush;
      if (flush === undefined) {
        throw new Error('Native root frame rendered without a pending invalidation');
      }
      this.pendingInvalidationFlush = undefined;
      // This is the intentional sync fast path: the cell buffer must be ready
      // before NativeTerminalRenderer presents the same frame.
      flush();
    } finally {
      this.currentNativeFrame = undefined;
    }
  }

  private renderCurrentNativeFrame(): void {
    const frame = this.currentNativeFrame;
    if (frame === undefined) {
      throw new Error('Native root invalidation flushed outside a native frame');
    }
    const cursor = renderNativeRootChildren(
      frame.renderer.frame,
      this.children,
      frame.size.columns,
      frame.size.rows,
    );
    if (cursor === undefined) frame.renderer.hideCursor();
    else frame.renderer.setCursor(cursor);
  }

  private handleRawInput(data: string | Buffer): void {
    let next = Buffer.isBuffer(data) ? data.toString('utf8') : data;
    for (const listener of this.inputListeners) {
      const result = listener(next);
      if (result?.data !== undefined) next = result.data;
      if (result?.consume === true) {
        if (this.requestRenderOnInput) this.requestInputFrame();
        return;
      }
    }

    this.focusedComponent?.handleInput?.(next);
    if (this.requestRenderOnInput) this.requestInputFrame();
  }

  private requestInputFrame(): void {
    // Preserve the existing observable render cause while carrying interactive
    // priority and layout intent through the invalidation coordinator.
    this.requestFrame(
      { source: 'input', requiresLayout: true, priority: 'interactive' },
      'request',
    );
  }
}

const NATIVE_RENDER_CAUSE_MASKS: Readonly<Record<NativeRenderCause, number>> = {
  start: 1,
  request: 1 << 1,
  input: 1 << 2,
  resize: 1 << 3,
  animation: 1 << 4,
  manual: 1 << 5,
  quality: 1 << 6,
  'transcript-scroll': 1 << 7,
};

function normalizeNativeRootRenderCause(
  cause: boolean | NativeRenderCause | undefined,
): NativeRenderCause {
  if (cause === true) return 'manual';
  if (cause === false || cause === undefined) return 'request';
  return cause;
}

function nativeRootInvalidationForCause(
  cause: NativeRenderCause,
  requiresLayout = cause === 'start' || cause === 'resize',
): FrameInvalidationRequest {
  if (cause === 'input') {
    return { source: 'input', requiresLayout, priority: 'interactive' };
  }
  if (cause === 'resize') {
    return { source: 'resize', requiresLayout: true, priority: 'interactive' };
  }
  if (cause === 'animation') {
    return { source: 'animation', requiresLayout, priority: 'ambient' };
  }
  if (requiresLayout) {
    return { source: 'layout', requiresLayout: true, priority: 'normal' };
  }
  return {
    source: 'state',
    requiresLayout: false,
    priority: cause === 'transcript-scroll' ? 'interactive' : 'normal',
  };
}

export function createNativeRootUI<TComponent extends Component = Component>(
  options: NativeRootUIOptions,
): NativeRootUI<TComponent> {
  return new NativeRootUI<TComponent>(options);
}

export function renderNativeRootChildren(
  frame: RendererCellBuffer,
  children: readonly Component[],
  width = frame.width,
  height = frame.height,
): RendererCursorState | undefined {
  let y = 0;
  let cursor: RendererCursorState | undefined;
  const safeWidth = normalizeTerminalSize(width, frame.width);
  const safeHeight = normalizeTerminalSize(height, frame.height);

  for (const child of children) {
    const lines = child.render(safeWidth);
    for (const line of lines) {
      if (y >= safeHeight) return cursor;
      const projection = projectNativeRootLine(line, y, safeWidth, safeHeight);
      writeNativeRootCellLine(frame, y, projection.cells, safeWidth);
      cursor ??= projection.cursor;
      y++;
    }
  }

  return cursor;
}

function projectNativeRootLine(
  line: string,
  y: number,
  width: number,
  height: number,
): {
  readonly cells: readonly RendererCell[];
  readonly cursor?: RendererCursorState;
} {
  return projectRendererCursorMarkerLine({
    line,
    y,
    viewport: { x: 0, y: 0, width, height },
  });
}

function writeNativeRootCellLine(
  frame: RendererCellBuffer,
  y: number,
  cells: readonly RendererCell[],
  width: number,
): void {
  for (let x = 0; x < width && x < cells.length; x++) {
    const cell = cells[x];
    if (cell === undefined) continue;
    if (cell.continuation === true || cell.width === 0) continue;
    if (cell.width === 2) {
      if (x + 1 >= width) break;
      frame.setCell(x, y, cell);
      frame.setCell(x + 1, y, continuationCellFor(cell, cells[x + 1]));
      x++;
      continue;
    }
    frame.setCell(x, y, cell);
  }
}

function continuationCellFor(
  primary: RendererCell,
  existing: RendererCell | undefined,
): RendererCell {
  if (existing?.continuation === true) return existing;
  const out: {
    char: string;
    width: 0;
    continuation: true;
    style?: RendererCellStyle;
    link?: string;
  } = {
    char: '',
    width: 0,
    continuation: true,
  };
  if (primary.style !== undefined) out.style = primary.style;
  if (primary.link !== undefined) out.link = primary.link;
  return out;
}

function sanitizeOscPayload(value: string): string {
  return value.replaceAll(/[\u0000-\u001F\u007F]/g, '').slice(0, 256);
}

function normalizeTerminalSize(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}
