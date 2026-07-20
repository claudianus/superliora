import {
  RendererDoubleBuffer,
  type RendererCell,
  type RendererCellBuffer,
  type RendererCellStyle,
  type RendererDamageRect,
  type RendererFrameDiff,
  type RendererRunOptimizationInput,
} from './cell-buffer';
import {
  resolveRendererFrameOutputPolicy,
  type RendererFrameOutputDecision,
  type RendererFrameOutputPolicyInput,
} from './frame-output-policy';
import {
  encodeTerminalFrameWithMetrics,
  type RendererCursorState,
  type RendererCursorMotionMetrics,
  type RendererTerminalOutputOptions,
} from './terminal-output';

export interface RendererOutputTarget {
  write(chunk: string): unknown;
}

export interface NativeFrameRendererOptions extends RendererTerminalOutputOptions {
  readonly width: number;
  readonly height: number;
  readonly output: RendererOutputTarget;
  readonly outputPolicy?: RendererFrameOutputPolicyInput;
  readonly runOptimization?: RendererRunOptimizationInput;
  readonly now?: () => number;
}

export interface NativeFramePresentTiming {
  readonly diffDurationMs: number;
  readonly encodeDurationMs: number;
  readonly writeDurationMs: number;
  readonly totalDurationMs: number;
}

export interface NativeFramePresentResult {
  readonly diff: RendererFrameDiff;
  readonly output: string;
  readonly bytes: number;
  readonly backpressure: boolean;
  readonly cursorMotion: RendererCursorMotionMetrics;
  readonly outputPolicy: RendererFrameOutputDecision;
  readonly timing: NativeFramePresentTiming;
}

export class NativeFrameRenderer {
  private buffers: RendererDoubleBuffer;
  private forceNextPresent = true;
  private nextCursor: RendererCursorState | undefined;
  private previousCursor: RendererCursorState | undefined;

  constructor(private options: NativeFrameRendererOptions) {
    this.buffers = new RendererDoubleBuffer(options.width, options.height);
  }

  get width(): number {
    return this.buffers.next.width;
  }

  get height(): number {
    return this.buffers.next.height;
  }

  get frame(): RendererCellBuffer {
    return this.buffers.next;
  }

  setSynchronizedOutput(synchronized: boolean | undefined): void {
    if (this.options.synchronized === synchronized) return;
    this.options = { ...this.options, synchronized };
  }

  beginFrame(options: { readonly clear?: boolean; readonly fill?: RendererCell } = {}): void {
    this.buffers.beginFrame(options);
    this.nextCursor = undefined;
  }

  fillRect(rect: RendererDamageRect, cell?: RendererCell): void {
    this.frame.fillRect(rect, cell);
  }

  writeText(x: number, y: number, text: string, style?: RendererCellStyle): void {
    this.frame.writeText(x, y, text, style);
  }

  setCursor(cursor: RendererCursorState): void {
    this.nextCursor = normalizeCursorState(cursor);
  }

  hideCursor(): void {
    this.nextCursor = { x: 0, y: 0, visible: false };
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.options = { ...this.options, width, height };
    this.buffers = new RendererDoubleBuffer(width, height);
    this.forceNextPresent = true;
    this.previousCursor = undefined;
  }

  present(
    options: {
      readonly force?: boolean;
      readonly forceCursor?: boolean;
      /** Re-emit equal cells (terminal resync). Ambient animation must never set this. */
      readonly rewriteUnchanged?: boolean;
      /**
       * Scroll delta for this frame (positive = content scrolled up, negative
       * = scrolled down). When set, the encoder emits a terminal scroll-region
       * command and only the exposed rows need re-encoding.
       */
      readonly scrollDelta?: number;
    } = {},
  ): NativeFramePresentResult {
    const startedAt = this.now();
    const force = options.force === true || this.forceNextPresent;
    const diffStartedAt = this.now();
    const baseDiff = this.buffers.present({
      force,
      rewriteUnchanged: options.rewriteUnchanged === true,
      runOptimization: this.options.runOptimization ?? true,
    });
    const diff: RendererFrameDiff = options.scrollDelta !== undefined && options.scrollDelta !== 0
      ? { ...baseDiff, scrollDelta: options.scrollDelta }
      : baseDiff;
    const diffEndedAt = this.now();
    this.forceNextPresent = false;
    // When forceCursor is set (e.g. input-driven frames), always re-emit the
    // cursor position even if it hasn't changed. Without this, the terminal
    // keeps its cursor at a stale location and OS IME renders the composition
    // window (e.g. Korean hangul preedit) at the wrong screen position.
    const cursorEqual = cursorStatesEqual(this.previousCursor, this.nextCursor);
    const cursor = cursorEqual && options.forceCursor !== true
      ? undefined
      : this.nextCursor ?? { x: 0, y: 0, visible: false };
    const outputPolicy = resolveRendererFrameOutputPolicy({
      diff,
      cursor,
      outputOptions: {
        ...this.options,
        frameWidth: this.width,
        frameHeight: this.height,
        cursorMotion: this.options.cursorMotion ?? 'auto',
        previousCursor: this.previousCursor,
      },
      policy: this.options.outputPolicy,
    });
    const encodeStartedAt = this.now();
    const encoded = encodeTerminalFrameWithMetrics(diff, { ...outputPolicy.options, cursor });
    const output = encoded.output;
    const bytes = Buffer.byteLength(output);
    const encodeEndedAt = this.now();
    this.previousCursor = this.nextCursor;
    const writeStartedAt = this.now();
    const writeResult = output.length > 0 ? this.options.output.write(output) : undefined;
    const endedAt = this.now();
    return {
      diff,
      output,
      bytes,
      backpressure: writeResult === false,
      cursorMotion: encoded.cursorMotion,
      outputPolicy,
      timing: {
        diffDurationMs: duration(diffStartedAt, diffEndedAt),
        encodeDurationMs: duration(encodeStartedAt, encodeEndedAt),
        writeDurationMs: duration(writeStartedAt, endedAt),
        totalDurationMs: duration(startedAt, endedAt),
      },
    };
  }

  private now(): number {
    return this.options.now?.() ?? performance.now();
  }
}

function duration(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}

function normalizeCursorState(cursor: RendererCursorState): RendererCursorState {
  const metadata: {
    visible?: boolean;
    shape?: RendererCursorState['shape'];
    blinking?: boolean;
  } = {};
  if (cursor.visible !== undefined) metadata.visible = cursor.visible;
  if (cursor.shape !== undefined) metadata.shape = cursor.shape;
  if (cursor.blinking !== undefined) metadata.blinking = cursor.blinking;

  if (cursor.visible === false) {
    return {
      x: 0,
      y: 0,
      ...metadata,
    };
  }
  return {
    x: normalizeCursorCoordinate(cursor.x),
    y: normalizeCursorCoordinate(cursor.y),
    ...metadata,
  };
}

function cursorStatesEqual(
  a: RendererCursorState | undefined,
  b: RendererCursorState | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  const left = normalizeCursorState(a);
  const right = normalizeCursorState(b);
  if (left.visible === false || right.visible === false) {
    return (
      left.visible === false &&
      right.visible === false &&
      left.shape === right.shape &&
      left.blinking === right.blinking
    );
  }
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.visible === right.visible &&
    left.shape === right.shape &&
    left.blinking === right.blinking
  );
}

function normalizeCursorCoordinate(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}
