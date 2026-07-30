import type {
  NativeLayoutFrameResult,
  NativeFrameRenderer,
  NativeTerminalRendererOptions,
  RendererCell,
  RendererCompositionCache,
  RendererCursorState,
  RendererDiagnosticsSnapshot,
  RendererLineCellCache,
  RendererOutputTarget,
  RendererRect,
} from '#/tui/renderer';

import type { TUIStateNativeDiagnosticsOverlaySource } from './native-layout-frame-overlays';

export const DEFAULT_NATIVE_FRAME_COLUMNS = 80;
export const DEFAULT_NATIVE_FRAME_ROWS = 24;

export interface TUIStateNativeFrameOptions {
  readonly renderer?: NativeFrameRenderer;
  readonly output?: RendererOutputTarget;
  readonly width?: number;
  readonly height?: number;
  readonly force?: boolean;
  readonly fill?: RendererCell;
  readonly lineCache?: RendererLineCellCache;
  readonly compositionCache?: RendererCompositionCache;
  readonly diagnosticsOverlay?: TUIStateNativeDiagnosticsOverlaySource;
  readonly diagnostics?: RendererDiagnosticsSnapshot;
}

export interface TUIStateNativeFrameResult extends NativeLayoutFrameResult {
  readonly renderer: NativeFrameRenderer;
  readonly width: number;
  readonly height: number;
  readonly cursor: RendererCursorState;
}

export interface TUIStateNativeRenderCallbackOptions {
  readonly diagnosticsOverlay?: TUIStateNativeDiagnosticsOverlaySource;
  readonly fill?: RendererCell;
  /**
   * Invoked when the native renderer performs an authoritative full redraw
   * (layout shift, resize, scroll, etc.). Use this to refresh terminal-side
   * theme state such as OSC palette colors after incremental frames are cleared.
   */
  readonly onAuthoritativeFrame?: () => void;
  /**
   * When true, the rendered UI height is capped to the actual content
   * height (transcript + chrome) instead of always occupying the full
   * terminal viewport. The UI grows as the transcript grows and never
   * exceeds the real terminal height. Defaults to false (always fill the
   * terminal), matching the previous fixed full-viewport behavior.
   */
  readonly growWithContent?: boolean;
  /**
   * Shell-aware workspace center band for multi-panel layout (e.g.
   * `WorkspaceController.getCenterRect(...)`). When provided, the stage
   * resolves inside this band instead of assuming docks are flush against
   * the terminal edges.
   */
  readonly workspaceCenter?: (ctx: { columns: number; rows: number }) => RendererRect | null;
  /**
   * Called after the main frame is rendered. Use this to draw workspace
   * panels into the reserved dock areas via the frame renderer.
   */
  readonly postFrameRender?: (context: {
    readonly frameRenderer: import('@harness-kit/tui-renderer').NativeFrameRenderer;
    readonly columns: number;
    readonly rows: number;
  }) => void;
}

export interface TUIStateNativeRendererOptions
  extends Omit<NativeTerminalRendererOptions, 'render'>,
    TUIStateNativeRenderCallbackOptions {}

export type TUIStateVisibleNativeRendererOptions = Omit<
  TUIStateNativeRendererOptions,
  'input' | 'output'
>;
