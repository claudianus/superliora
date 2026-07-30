import { ANSI_CLEAR_SCREEN, type NativeTerminalScreenMode, type NativeTerminalSize } from '../terminal-session';
import { encodeTerminalClearBelowRow } from '../terminal-output';
import type { NativeFrameRenderer } from '../native-frame';
import type { RendererCompositionCache } from '../compositor';

export interface NativeRendererResizeContext {
  readonly screenMode: NativeTerminalScreenMode | undefined;
  readonly originX: number | undefined;
  readonly originY: number | undefined;
  readonly frameRenderer: NativeFrameRenderer;
  readonly compositionCache: RendererCompositionCache | undefined;
}

export function resolveNativeRendererFrameHeight(
  size: NativeTerminalSize,
  measure: ((size: NativeTerminalSize) => number) | undefined,
): number {
  const measured = measure?.(size);
  if (measured === undefined || !Number.isFinite(measured) || measured <= 0) return size.rows;
  return Math.min(size.rows, Math.floor(measured));
}

export function clearStaleNativeRendererFrameRows(
  context: NativeRendererResizeContext,
  height: number,
  previousHeight: number,
): void {
  if (context.screenMode === 'alternate' || height >= previousHeight) return;
  context.frameRenderer.queueTerminalPrefix(
    encodeTerminalClearBelowRow(height, context.originX ?? 0, context.originY ?? 0),
  );
}

export function handleNativeRendererTerminalResize(
  context: NativeRendererResizeContext,
  size: NativeTerminalSize,
  callbacks: {
    readonly now: () => number;
    readonly recordResize: (size: NativeTerminalSize) => void;
    readonly onResize?: (size: NativeTerminalSize) => void;
    readonly requestRender: () => void;
  },
): void {
  const previousRows = context.frameRenderer.height;
  const previousCols = context.frameRenderer.width;
  if (size.columns !== previousCols || size.rows !== previousRows) {
    // The frame buffer is recreated on resize; rows composed into the old
    // buffer must not be reused (skipped) when composing the new one.
    context.compositionCache?.reset();
  }
  context.frameRenderer.resize(size.columns, size.rows);
  clearStaleNativeRendererFrameRows(context, size.rows, previousRows);
  // Alternate-screen grow leaves the previous frame's pixels at top-left.
  // Soft buffers reset empty, so equal-cell skips never overwrite that ghost.
  // Queue the clear inside the next present transaction so terminals with
  // synchronized output never reveal the empty surface between writes.
  if (
    context.screenMode === 'alternate' &&
    (size.columns !== previousCols || size.rows !== previousRows)
  ) {
    context.frameRenderer.queueTerminalPrefix(ANSI_CLEAR_SCREEN);
  }
  callbacks.recordResize(size);
  callbacks.onResize?.(size);
  callbacks.requestRender();
}
