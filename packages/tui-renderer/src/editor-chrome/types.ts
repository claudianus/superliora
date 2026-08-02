import type { RendererCellStyle } from '../cell-buffer/index';
import type { RendererRect, RendererRegionLine } from '../render/compositor';
import type {
  RendererEditorCursor,
  RendererEditorTextInputGeometry,
} from '../editor/text-input';
import type { RendererCursorState } from '../terminal/output';
import type { RendererTextInputRenderResult } from '../text-input/index';
import type { RendererTheme } from '../theme';

export type RendererEditorPaint = (text: string) => string;

export const RENDERER_EDITOR_PROMPT_X = 2;
export const RENDERER_EDITOR_CONTENT_X = 4;
export const RENDERER_EDITOR_CONTENT_Y = 1;
export const RENDERER_EDITOR_CONTENT_RIGHT_INSET = 2;
export const RENDERER_EDITOR_SHELL_MODE_LABEL = ' ! shell mode ';
export const RENDERER_EDITOR_CONTENT_BOTTOM_INSET = 1;
export const RENDERER_EDITOR_SCROLLBAR_TRACK = '│';
export const RENDERER_EDITOR_SCROLLBAR_THUMB = '█';
export const RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY: Readonly<
  Required<RendererEditorTextInputGeometry>
> = Object.freeze({
  contentX: RENDERER_EDITOR_CONTENT_X,
  contentY: RENDERER_EDITOR_CONTENT_Y,
  contentRightInset: RENDERER_EDITOR_CONTENT_RIGHT_INSET,
  contentBottomInset: RENDERER_EDITOR_CONTENT_BOTTOM_INSET,
});

export interface RendererEditorFrameOptions {
  readonly width: number;
  readonly height: number;
  readonly inputLines: readonly RendererRegionLine[];
  readonly inputCursor?: RendererCursorState;
  readonly prompt?: string;
  readonly connectedAbove?: boolean;
  readonly topLabel?: string;
  readonly promptX?: number;
  readonly contentX?: number;
  readonly borderStyle?: RendererCellStyle;
  readonly promptStyle?: RendererCellStyle;
  readonly surfaceStyle?: RendererCellStyle;
  readonly scrollbarLines?: readonly string[];
  readonly scrollbarTrackStyle?: RendererCellStyle;
  readonly scrollbarThumbStyle?: RendererCellStyle;
  readonly scrollbarTrackChar?: string;
  readonly scrollbarThumbChar?: string;
  /** When true, the frame paints no top border (used when overlays attach above). */
  readonly omitTopBorder?: boolean;
  readonly omitBottomBorder?: boolean;
}

/**
 * Where autocomplete suggestion rows attach relative to the input frame.
 * - `below` (legacy): input then suggestions; bottom border deferred to overlay chrome
 * - `above` (product default): suggestions then input; top border deferred to overlay chrome
 */
export type RendererEditorOverlayPlacement = 'above' | 'below';

export interface RendererEditorOverlayLinesOptions {
  readonly width: number;
  readonly lines: readonly RendererRegionLine[];
  readonly borderStyle?: RendererCellStyle;
  readonly surfaceStyle?: RendererCellStyle;
  readonly textStyle?: RendererCellStyle;
  readonly contentX?: number;
  /**
   * Which edge of the continuous editor box the overlay chrome owns.
   * - `bottom` (default): side rails + bottom corners (suggestions below input)
   * - `top`: top corners + side rails (suggestions above input)
   */
  readonly cap?: 'top' | 'bottom';
}

export interface RendererEditorFrameResult {
  readonly lines: readonly RendererRegionLine[];
  readonly cursor?: RendererCursorState;
}

export interface RendererEditorSurfaceArgumentHintOptions
  extends RendererEditorArgumentHintOptions {
  readonly enabled?: boolean;
  readonly width?: number;
  readonly style?: RendererCellStyle;
}

export interface RendererEditorSurfaceOptions
  extends Omit<RendererEditorFrameOptions, 'height' | 'inputLines' | 'inputCursor'> {
  readonly content: RendererTextInputRenderResult;
  readonly frameRows?: number;
  readonly argumentHint?: RendererEditorSurfaceArgumentHintOptions;
  readonly overlays?: readonly RendererRegionLine[];
  /**
   * Suggestion placement relative to the input. Defaults to `'above'` so the
   * prompt baseline stays on the bottom-pinned editor edge.
   */
  readonly overlayPlacement?: RendererEditorOverlayPlacement;
  readonly scrollbar?: RendererEditorSurfaceScrollbarOptions | false;
  readonly slashTokenStyle?: RendererCellStyle;
  readonly textStyle?: RendererCellStyle;
}

export interface RendererEditorSurfaceResult {
  readonly lines: readonly RendererRegionLine[];
  readonly frameLines: readonly RendererRegionLine[];
  readonly overlayLines: readonly RendererRegionLine[];
  readonly cursor?: RendererCursorState;
}

export interface RendererEditorSurfaceCursorProjectionOptions {
  readonly surface: RendererEditorSurfaceResult;
  readonly rect: RendererRect;
  readonly viewport?: RendererRect;
}

export interface RendererEditorSurfaceStylePalette {
  readonly text: string;
  readonly textMuted: string;
  readonly textStrong: string;
  readonly border: string;
  readonly borderFocus: string;
  readonly command: string;
  readonly surfaceSunken: string;
  /** Root canvas color; used for editor fill when `canvasBackground` is enabled. */
  readonly background?: string;
  readonly selectionBg: string;
  readonly selectionText: string;
  /** Foreground for inline ghost text (autocomplete / suggestion preview). */
  readonly ghostText?: string;
}

export interface RendererEditorSurfaceStyleOptions {
  readonly palette?: RendererEditorSurfaceStylePalette;
  readonly theme?: RendererTheme;
  readonly commandMode?: boolean;
  readonly focused?: boolean;
  readonly canvasBackground?: boolean;
}

export interface RendererEditorSurfaceStyles {
  readonly borderStyle: RendererCellStyle;
  readonly textStyle: RendererCellStyle;
  readonly promptStyle: RendererCellStyle;
  readonly surfaceStyle: RendererCellStyle;
  readonly scrollbarTrackStyle: RendererCellStyle;
  readonly scrollbarThumbStyle: RendererCellStyle;
  readonly placeholderStyle: RendererCellStyle;
  readonly selectionStyle: RendererCellStyle;
  readonly autocompleteSelectedStyle: RendererCellStyle;
  readonly autocompleteDescriptionStyle: RendererCellStyle;
  readonly autocompleteScrollStyle: RendererCellStyle;
  readonly slashTokenStyle: RendererCellStyle;
  readonly ghostStyle: RendererCellStyle;
}

export interface RendererEditorSurfaceLayoutOptions {
  readonly height: number;
  readonly overlays?: readonly RendererRegionLine[];
  readonly minFrameRows?: number;
  readonly overlayPlacement?: RendererEditorOverlayPlacement;
}

export interface RendererEditorSurfaceLayoutResult {
  readonly rows: number;
  readonly frameRows: number;
  readonly contentRows: number;
  readonly overlayRows: number;
  readonly overlayLines: readonly RendererRegionLine[];
}

export interface RendererEditorSurfaceScrollbarOptions {
  readonly minThumbRows?: number;
  readonly trackChar?: string;
  readonly thumbChar?: string;
}

export interface RendererEditorArgumentHintOptions {
  readonly text: string;
  readonly cursor: RendererEditorCursor;
  readonly hints: ReadonlyMap<string, string>;
}

export interface RendererEditorArgumentHintProjectionOptions
  extends RendererEditorArgumentHintOptions {
  readonly width: number;
  readonly style?: RendererCellStyle;
}
