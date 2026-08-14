import type { NativeTerminalScreenMode, NativeTerminalSize } from '../terminal/session';
import { encodeTerminalClearBelowRow } from '../terminal/output';
import type { NativeFrameRenderer } from '../native/frame';
import type { RendererCompositionCache } from '../render/compositor';

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
  const sizeChanged = size.columns !== previousCols || size.rows !== previousRows;
  if (sizeChanged) {
    // The frame buffer is recreated on resize; rows composed into the old
    // buffer must not be reused (skipped) when composing the new one.
    context.compositionCache?.reset();
  }
  context.frameRenderer.resize(size.columns, size.rows);
  clearStaleNativeRendererFrameRows(context, size.rows, previousRows);
  // Mid-session CSI 2J on the alternate screen flashes the whole surface
  // black. Start still clears once via clearOnStart; later resizes recreate
  // the soft buffer and paint the new frame without a full wipe.
  callbacks.recordResize(size);
  callbacks.onResize?.(size);
  callbacks.requestRender();
}
