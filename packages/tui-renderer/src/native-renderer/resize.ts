import type { NativeTerminalScreenMode, NativeTerminalSize } from '../terminal/session';
import { encodeTerminalClearBelowRow } from '../terminal/output';
import type { NativeFrameRenderer } from '../native/frame';
import type { RendererCompositionCache } from '../render/compositor';

export interface NativeRendererResizeContext {
  readonly screenMode: NativeTerminalScreenMode | undefined;
  readonly originX: number | undefined;
  readonly originY: number | undefined;
  readonly fill?: { readonly style?: { readonly bg?: string } };
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
  if (height === previousHeight) return;
  const fromRow = Math.min(height, previousHeight);
  const extraRows = Math.max(1, Math.abs(height - previousHeight));
  const prefix = encodeTerminalClearBelowRow(
    fromRow,
    context.originX ?? 0,
    context.originY ?? 0,
    context.fill,
    context.frameRenderer.width,
    extraRows,
  );
  if (prefix) context.frameRenderer.queueTerminalPrefix(prefix);
}
