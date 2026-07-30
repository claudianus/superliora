import type { RendererCellStyle } from './cell-buffer';
import type { RendererRegionLine } from './compositor';
import type { RendererCursorShape, RendererCursorState } from './terminal-output';

/**
 * Public option/result types for `RendererTextInput`. Kept separate from the
 * class so sibling pure-function modules can share them without importing the
 * mutable editor implementation.
 */

export interface RendererTextInputOptions {
  readonly text?: string;
  readonly multiline?: boolean;
  readonly focused?: boolean;
  readonly cursorShape?: RendererCursorShape;
  readonly cursorBlinking?: boolean;
  readonly maxLength?: number;
  readonly placeholder?: string;
  readonly style?: RendererCellStyle;
  readonly placeholderStyle?: RendererCellStyle;
  readonly atomicRanges?: readonly RendererTextInputAtomicRange[];
  readonly layoutWidth?: number;
  readonly selection?: RendererTextInputSelection;
  readonly selectionStyle?: RendererCellStyle;
  readonly historyLimit?: number;
  readonly layoutHeight?: number;
}

export interface RendererTextInputCursor {
  readonly line: number;
  readonly column: number;
}

export interface RendererTextInputAtomicRange {
  readonly start: number;
  readonly end: number;
  readonly id?: string;
}

export interface RendererTextInputSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface RendererTextInputSelectionRange {
  readonly start: number;
  readonly end: number;
}

export interface RendererTextInputRenderOptions {
  readonly width: number;
  readonly height?: number;
  readonly focused?: boolean;
  readonly style?: RendererCellStyle;
  readonly placeholderStyle?: RendererCellStyle;
  readonly selectionStyle?: RendererCellStyle;
  /**
   * Optional "ghost" text rendered dimmed right after the cursor (inline
   * autocomplete / next-task suggestion). Tab acceptance is handled by the
   * editor layer; this only paints the preview cells.
   */
  readonly ghostText?: string;
  readonly ghostStyle?: RendererCellStyle;
}

export interface RendererTextInputMouseOptions {
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly viewportRow?: number;
}

export interface RendererTextInputRenderResult {
  readonly lines: readonly RendererRegionLine[];
  readonly cursor: RendererCursorState;
  readonly contentRows: number;
  readonly viewportRow: number;
}
