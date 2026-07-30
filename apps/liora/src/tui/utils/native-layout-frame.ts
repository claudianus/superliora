import {
  NativeFrameRenderer,
  NativeTerminalRenderer,
  nativeTerminalAdaptiveFeatureProfile,
  resolveNativePremiumRendererDefaults,
  renderNativeLayoutFrame,
  type NativeTerminalInput,
  type NativeTerminalOutput,
  type RendererDiagnosticsSnapshot,
  type RendererFrameRegion,
  type RendererRect,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { setAppearanceRenderHealth } from '#/tui/utils/appearance-effects';

import type { TUIState } from '../tui-state';
import {
  buildTUIStateNativeFrame,
  isNativeFullscreenTakeover,
  normalizeFrameSize,
  type TUIStateNativeFrameChrome,
} from './native-layout-frame-build';
import { createTUIStateNativeRenderCallback } from './native-layout-frame-callback';
import {
  nativeEditorFallbackRegionLines,
  nativeEditorRegionRowsForLayout,
  NATIVE_LAYOUT_MIN_TRANSCRIPT_ROWS,
} from './native-layout-frame-editor';
import type { TUIStateNativeDiagnosticsOverlaySource } from './native-layout-frame-overlays';
import {
  DEFAULT_NATIVE_FRAME_COLUMNS,
  DEFAULT_NATIVE_FRAME_ROWS,
  type TUIStateNativeFrameOptions,
  type TUIStateNativeFrameResult,
  type TUIStateNativeRendererOptions,
  type TUIStateVisibleNativeRendererOptions,
} from './native-layout-frame-types';
import { planTUINativeStage } from './native-stage-plan';
import { shouldHoldTranscriptAnimation } from './transcript-selection';

export {
  frameInvalidationIntentToCause,
  isLiveGoalChromeActive,
  isPureInputFrame,
  isPureTranscriptScrollFrame,
  resolveTUIStateNativeFramePolicy,
  shouldForceNativeCursor,
  shouldForceTUIStateNativeLayoutFrame,
  shouldRefreshNativeTerminalPalette,
  shouldReuseTUIChromeCache,
  shouldUseAmbientDamageOnlyPaint,
  tuiChromeEpoch,
  type FrameInvalidationIntent,
  type TUIStateNativeFramePolicy,
  type TUIStateNativeFramePolicyInput,
} from './native-frame-policy';
export {
  detectTUIStateNativeLayoutShift,
  type TUIStateNativeLayoutShift,
} from './native-layout-frame-shift';
export type {
  TUIStateNativeDiagnosticsOverlayInput,
  TUIStateNativeDiagnosticsOverlayOptions,
  TUIStateNativeDiagnosticsOverlayResolver,
  TUIStateNativeDiagnosticsOverlaySource,
} from './native-layout-frame-overlays';
export type {
  TUIStateNativeFrameOptions,
  TUIStateNativeFrameResult,
  TUIStateNativeRenderCallbackOptions,
  TUIStateNativeRendererOptions,
  TUIStateVisibleNativeRendererOptions,
} from './native-layout-frame-types';
export { createTUIStateNativeRenderCallback } from './native-layout-frame-callback';

export function renderTUIStateNativeFrame(
  state: TUIState,
  options: TUIStateNativeFrameOptions = {},
): TUIStateNativeFrameResult {
  const width = normalizeFrameSize(
    options.width ?? state.terminal.columns,
    DEFAULT_NATIVE_FRAME_COLUMNS,
  );
  const height = normalizeFrameSize(
    options.height ?? state.terminal.rows,
    DEFAULT_NATIVE_FRAME_ROWS,
  );
  const renderer =
    options.renderer ??
    new NativeFrameRenderer({
      width,
      height,
      output: options.output ?? { write: () => {} },
      synchronized: true,
      hideCursor: true,
      showCursor: true,
    });

  renderer.resize(width, height);
  const frame = buildTUIStateNativeFrame(state, width, height, {
    diagnosticsOverlay: options.diagnosticsOverlay,
    diagnostics: options.diagnostics,
  });
  const result = renderNativeLayoutFrame(renderer, frame.regions, {
    fill: options.fill ?? currentTheme.canvasBackgroundCell(),
    force: options.force,
    cursor: frame.cursor,
    composition: {
      lineCache: options.lineCache,
      cache: options.compositionCache,
    },
  });

  return { ...result, renderer, width, height, cursor: frame.cursor };
}

export function createTUIStateNativeRenderer(
  state: TUIState,
  options: TUIStateNativeRendererOptions,
): NativeTerminalRenderer {
  const premiumDefaults = resolveNativePremiumRendererDefaults({
    features: options.features,
    synchronized: options.synchronized,
    outputPolicy: typeof options.outputPolicy === 'string' ? options.outputPolicy : undefined,
    regionVfxFrames: options.regionVfxFrames,
    environment: process.env,
  });
  let nativeRenderer: NativeTerminalRenderer;
  nativeRenderer = new NativeTerminalRenderer({
    ...options,
    autoBeginFrame: false,
    autoFrameHold: options.autoFrameHold ?? (() => {
      // Fullscreen takeover (splash, tasks browser, approval preview) owns its
      // own animations — never hold frames based on transcript scroll state.
      if (isNativeFullscreenTakeover(state)) return false;
      return shouldHoldTranscriptAnimation({
        transcriptSelection: state.transcriptSelection,
      });
    }),
    outputPolicy: options.outputPolicy ?? premiumDefaults.outputPolicy,
    regionVfxFrames: options.regionVfxFrames ?? premiumDefaults.regionVfxFrames,
    measureFrameHeight: options.growWithContent === true
      ? (size) => measureTUIStateNativeFrameHeight(state, size.columns, size.rows)
      : options.measureFrameHeight,
    render: createTUIStateNativeRenderCallback(state, options),
    onFrame: (result, stats) => {
      setAppearanceRenderHealth(stats.health);
      options.onFrame?.(result, stats);
    },
  });
  state.toast.onChanged = () => {
    nativeRenderer.requestRender('manual');
  };
  return nativeRenderer;
}

export function createTUIStateVisibleNativeRenderer(
  state: TUIState,
  options: TUIStateVisibleNativeRendererOptions = {},
): NativeTerminalRenderer {
  return createTUIStateNativeRenderer(state, {
    ...options,
    features: options.features ?? nativeTerminalAdaptiveFeatureProfile('inline-app', process.env),
    input: state.terminal as unknown as NativeTerminalInput,
    output: state.terminal as unknown as NativeTerminalOutput,
    renderOnStart: options.renderOnStart ?? true,
    synchronizedOutputProbe: options.synchronizedOutputProbe ?? true,
    unrefTimers: options.unrefTimers ?? true,
  });
}

export function buildTUIStateNativeFrameRegions(
  state: TUIState,
  width: number,
  height: number,
  options: {
    readonly diagnosticsOverlay?: TUIStateNativeDiagnosticsOverlaySource;
    readonly diagnostics?: RendererDiagnosticsSnapshot;
    readonly reuseChrome?: TUIStateNativeFrameChrome;
    readonly skipDecorativeEditorEffects?: boolean;
    readonly ambientDamageOnly?: boolean;
    readonly workspaceCenter?: RendererRect;
  } = {},
): readonly RendererFrameRegion[] {
  return buildTUIStateNativeFrame(state, width, height, options).regions;
}

export function getTUIStateNativeEditorRect(
  state: TUIState,
  width = state.terminal.columns,
  height = state.terminal.rows,
): RendererRect | undefined {
  if (!state.editorContainer.children.includes(state.editor)) return undefined;
  const frameWidth = normalizeFrameSize(width, DEFAULT_NATIVE_FRAME_COLUMNS);
  const frameHeight = normalizeFrameSize(height, DEFAULT_NATIVE_FRAME_ROWS);
  // Cheap editor line-count probe (internally cached by text + width). This
  // detects Enter / backspace line changes without a full layout pass.
  const editorLineCount = state.editor.getNativeLayoutRowCount?.(frameWidth) ?? -1;
  // Fast path: reuse the rect from the last call with the same key. This
  // avoids the expensive planTUINativeStage call (renders all chrome +
  // panels) on every keystroke. The cache self-invalidates on terminal
  // resize (dimension mismatch) or editor height change (line count mismatch).
  if (
    state.cachedEditorRect !== undefined &&
    state.cachedEditorRectColumns === frameWidth &&
    state.cachedEditorRectRows === frameHeight &&
    state.cachedEditorRectLineCount === editorLineCount
  ) {
    return state.cachedEditorRect;
  }
  // Slow path: full layout computation (first call, resize, line count change).
  const plan = planTUINativeStage(state, frameWidth, frameHeight, {
    resolveEditorFallbackLines: (contentWidth) =>
      nativeEditorFallbackRegionLines(state, contentWidth),
    resolveEditorRows: ({ editorLineCount: elc, fixedRowsWithoutEditor, contentWidth, contentHeight }) =>
      nativeEditorRegionRowsForLayout(
        state,
        elc,
        contentHeight,
        fixedRowsWithoutEditor,
        contentWidth,
      ),
  });
  const rect = plan.layout.regions.find((region) => region.id === 'editor')?.rect;
  // Cache for subsequent calls with the same key.
  state.cachedEditorRect = rect;
  state.cachedEditorRectColumns = frameWidth;
  state.cachedEditorRectRows = frameHeight;
  state.cachedEditorRectLineCount = editorLineCount;
  return rect;
}

/**
 * Computes the smallest frame height (at most `terminalRows`) that fits the
 * chrome regions at their natural size plus the transcript's actual content,
 * so the UI grows with the conversation instead of always occupying the full
 * terminal viewport.
 */
export function measureTUIStateNativeFrameHeight(
  state: TUIState,
  width: number,
  terminalRows: number,
): number {
  if (!Number.isFinite(terminalRows) || terminalRows <= 0) return terminalRows;
  const frameWidth = normalizeFrameSize(width, DEFAULT_NATIVE_FRAME_COLUMNS);
  const plan = planTUINativeStage(state, frameWidth, terminalRows, {
    resolveEditorFallbackLines: (contentWidth) =>
      nativeEditorFallbackRegionLines(state, contentWidth),
    resolveEditorRows: ({ editorLineCount, fixedRowsWithoutEditor, contentWidth, contentHeight }) =>
      nativeEditorRegionRowsForLayout(
        state,
        editorLineCount,
        contentHeight,
        fixedRowsWithoutEditor,
        contentWidth,
      ),
  });
  if (!Number.isFinite(plan.layout.transcriptRows)) return terminalRows;
  const contentRows = state.transcriptContainer.contentRowCount(plan.stage.stage.width);
  const desiredTranscriptRows = Math.min(
    plan.layout.transcriptRows,
    Math.max(NATIVE_LAYOUT_MIN_TRANSCRIPT_ROWS, contentRows),
  );
  return terminalRows - (plan.layout.transcriptRows - desiredTranscriptRows);
}
