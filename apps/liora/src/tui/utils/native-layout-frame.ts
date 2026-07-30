import {
  createRendererStackFrameRegions,
  NativeFrameRenderer,
  NativeTerminalRenderer,
  nativeTerminalAdaptiveFeatureProfile,
  resolveNativePremiumRendererDefaults,
  projectRendererCursorMarkerLines,
  promoteRendererRegionLinesToCells,
  renderNativeLayoutFrame,
  type NativeLayoutFrameResult,
  type NativeTerminalInput,
  type NativeTerminalOutput,
  type NativeTerminalRendererOptions,
  type NativeTerminalRendererRender,
  type RendererCell,
  type RendererCompositionCache,
  type RendererCursorState,
  type RendererDiagnosticsSnapshot,
  type RendererFrameRegion,
  type RendererLineCellCache,
  type RendererOutputTarget,
  type RendererRect,
  type RendererRegionId,
  type RendererRegionLine,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { createCenterModalOverlayRegion } from '#/tui/utils/center-modal';
import {
  advanceAppearanceAnimationClock,
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  getAppearanceRenderHealth,
  getAppearanceRenderQuality,
  motionEffectsAllowed,
  paintUltraworkEditorBorderGlow,
  resolveUltraworkBorderGlowHex,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

import { shouldAnimate, shouldRenderAmbientAnimationFrame } from '../controllers/appearance';
import type { TUIState } from '../tui-state';
import { IdleStageComponent } from '../components/chrome/idle-stage';
import {
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
  type TUIStateNativeFramePolicy,
} from './native-frame-policy';

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
import { resolveStageLayout } from '../controllers/stage-layout';
import {
  nativeEditorFallbackRegionLines,
  nativeEditorRegionRowsForLayout,
  NATIVE_LAYOUT_MIN_TRANSCRIPT_ROWS,
  projectNativeEditorRegion,
} from './native-layout-frame-editor';
import {
  createTUIStateDiagnosticsOverlayRegion,
  createTUIStateNativeRegionVfx,
  createTUIToastOverlayRegion,
  type TUIStateNativeDiagnosticsOverlayOptions,
  type TUIStateNativeDiagnosticsOverlayInput,
  type TUIStateNativeDiagnosticsOverlayResolver,
  type TUIStateNativeDiagnosticsOverlaySource,
} from './native-layout-frame-overlays';
import {
  detectTUIStateNativeLayoutShift,
  type TUIStateNativeLayoutShift,
  type TUIStateNativeLayoutTracking,
} from './native-layout-frame-shift';
import {
  nativeTranscriptRegionLines,
  promoteTranscriptRegionLinesToCells,
} from './native-layout-frame-transcript';
import {
  planTUINativeStage,
  type TUINativeStageChrome,
} from './native-stage-plan';
import {
  createStageFrameOverlayRegions,
  stageFrameBundleRect,
} from './stage-frame';
import {
  getStageResizeHoverZone,
  isStageResizeDragging,
  resetStageResizePointerShape,
} from './stage-resize-mouse';
import { shouldHoldTranscriptAnimation } from './transcript-selection';

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

const DEFAULT_NATIVE_FRAME_COLUMNS = 80;
const DEFAULT_NATIVE_FRAME_ROWS = 24;

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

interface TUIStateNativeChromeCache extends TUINativeStageChrome {
  readonly width: number;
  readonly stageWidth: number;
  /**
   * Activity-state signature (streaming phase + thinking) the cached chrome was
   * built under. Chrome only carries time-based content (moon spinner, pulsing
   * model label) while the agent is active; matching this epoch is what lets
   * animation frames reuse idle chrome safely and forces a rebuild the instant
   * activity starts/stops so a stale spinner is never reused.
   */
  readonly chromeEpoch: string;
}

export function createTUIStateNativeRenderCallback(
  state: TUIState,
  options: TUIStateNativeRenderCallbackOptions,
): NativeTerminalRendererRender {
  let layoutTracking: TUIStateNativeLayoutTracking = {};
  let chromeCache: TUIStateNativeChromeCache | undefined;
  let transcriptLineCache: readonly RendererRegionLine[] | undefined;
  let transcriptLineCacheWidth: number | undefined;
  let transcriptLineCacheSelectionKey: string | undefined;
  return ({ frame, runtime, size, quality }) => {
    if (frame.causes.includes('start')) runtime.cancelRegionAnimationFrame();
    if (frame.causes.includes('resize')) {
      // Terminal resize invalidates the grip geometry the Kitty pointer shape
      // was pushed for; drop drag/hover state so the cursor cannot get stuck.
      resetStageResizePointerShape(state.terminal);
    }
    advanceAppearanceAnimationClock(frame.timestamp);
    setAppearanceRenderQuality(quality.level);
    // The frame buffer may already be capped below the real terminal height
    // (see `measureFrameHeight` in createTUIStateNativeRenderer), so layout
    // must be computed against the actual buffer height, not `size.rows`.
    const height = runtime.frameRenderer.height;
    const priorStart = layoutTracking.transcriptStart;
    const layoutShift = detectTUIStateNativeLayoutShift(
      state,
      size.columns,
      layoutTracking,
      height,
    );
    const ambientAnimationAllowed =
      shouldAnimate(state.appState.appearance ?? getActiveAppearancePreferences()) &&
      (isNativeFullscreenTakeover(state) ||
        shouldRenderAmbientAnimationFrame(
          size.rows,
          state.transcriptSelection.isDragging || state.transcriptSelection.hasSelection,
          { nowMs: frame.timestamp },
        ));
    const policy = resolveTUIStateNativeFramePolicy({
      causes: frame.causes,
      viewportScrolled: layoutShift.viewportScrolled,
      structuralShift: layoutShift.structuralShift,
      geometryShift: layoutShift.geometryShift,
      contentGrew: layoutShift.contentGrew,
      contentShrunk: layoutShift.contentShrunk,
      priorTranscriptStart: priorStart,
      nextTranscriptStart: layoutShift.next.transcriptStart ?? 0,
      ambientAnimationAllowed,
    });
    // Post-splash anti-flicker: the last morph frame is still on screen. Suppress
    // the full-clear so the real UI cross-fades in without a black flash. The flag
    // is consumed exactly once (first frame after splash disposal).
    const splashJustDisposed = state.splashJustDisposed === true;
    if (splashJustDisposed) {
      state.splashJustDisposed = false;
    }
    const effectivePolicy: TUIStateNativeFramePolicy = splashJustDisposed
      ? { ...policy, clear: false }
      : policy;
    if (
      policy.clearTranscriptSelection &&
      (state.transcriptSelection.hasSelection || state.transcriptSelection.isDragging)
    ) {
      state.transcriptSelection.clear();
    }
    layoutTracking = layoutShift.next;
    if (policy.refreshTerminalPalette) options.onAuthoritativeFrame?.();
    // Pure keystroke frames only rewrite the editor. Reuse chrome lines so we
    // do not re-render header/footer/queue on every character.
    const pureInputFrame = isPureInputFrame(
      frame.causes,
      layoutShift.structuralShift,
      layoutShift.viewportScrolled,
    );
    const workspaceCenter =
      options.workspaceCenter?.({ columns: size.columns, rows: height }) ?? undefined;
    const stageProbe = resolveStageLayout({
      width: size.columns,
      height,
      workspaceCenter,
      userStageSize: state.userStageSize,
    });
    // Cache the rendered stage band so mouse hit-testing (resize grab zones)
    // matches the on-screen geometry exactly, dock and workspace centering
    // included.
    state.cachedStageBand = stageProbe.stage;
    // Chrome (header/footer/panels) only carries time-based content while the
    // agent is active — the activity pane's moon spinner and the footer's
    // pulsing model label both gate on `streamingPhase !== 'idle' || thinking`.
    // A live goal also keeps chrome dynamic: footer goal badge + Todo Board
    // monitor wall-clock / status pulse must re-render on content + animation
    // ticks (footer 1s timer invalidates 'content' → cause 'request').
    // When idle with no live goal, chrome is fully static, so animation frames
    // can reuse the cached chrome lines instead of re-rendering the whole
    // chrome tree every tick (the dominant per-frame cost once the transcript
    // is long). The chromeEpoch guard forces a rebuild whenever activity or
    // live-goal presence starts/stops so stale chrome is never reused.
    const liveGoal = isLiveGoalChromeActive(state.appState.goal);
    const chromeStatic =
      state.appState.streamingPhase === 'idle' && !state.appState.thinking && !liveGoal;
    const chromeEpoch = tuiChromeEpoch({
      streamingPhase: state.appState.streamingPhase,
      thinking: state.appState.thinking,
      liveGoalId: liveGoal ? state.appState.goal!.goalId : undefined,
      liveGoalStatus: liveGoal ? state.appState.goal!.status : undefined,
    });
    const reuseChrome = shouldReuseTUIChromeCache({
      hasCache: chromeCache !== undefined,
      widthMatches: chromeCache?.width === size.columns,
      stageWidthMatches: chromeCache?.stageWidth === stageProbe.stage.width,
      epochMatches: chromeCache?.chromeEpoch === chromeEpoch,
      pureInputFrame,
      chromeStatic,
      causes: frame.causes,
    })
      ? chromeCache
      : undefined;
    // Animation / idle-aquarium ticks must not full-clear. Request-only frames
    // while Jewel Tank is mounted (e.g. thinking footer) used to clear:true the
    // whole transcript — ~70% frame rewrite that tears into black horizontal bands
    // inside the stage even with sync wrapping.
    // Structural / viewport / resize frames keep clears so layout holes wipe.
    const idleAquariumMounted = state.transcriptContainer.children.some(
      (child) => child instanceof IdleStageComponent,
    );
    const ambientDamageOnly = splashJustDisposed || shouldUseAmbientDamageOnlyPaint({
      structuralShift: layoutShift.structuralShift,
      geometryShift: layoutShift.geometryShift,
      contentGrew: layoutShift.contentGrew,
      contentShrunk: layoutShift.contentShrunk,
      viewportScrolled: layoutShift.viewportScrolled,
      causes: frame.causes,
      ambientAnimationAllowed,
      idleAquariumMounted,
      fullscreenTakeover: isNativeFullscreenTakeover(state),
    });
    // Pure-input fast path: skip panel probes and transcript rendering when
    // the layout has not shifted. The editor is the only region that changes.
    // Mouse clicks that alter the transcript selection invalidate the cache
    // so the selection overlay is repainted immediately.
    //
    // Pure-scroll fast path: the transcript content has not changed — only
    // the viewport offset moved. Reuse the cached lines so we do not
    // regenerate the entire transcript (ANSI conversion, markdown rendering,
    // syntax highlighting) on every wheel tick.
    const selectionKey = transcriptSelectionCacheKey(state);
    const pureScrollFrame = isPureTranscriptScrollFrame(
      frame.causes,
      layoutShift.viewportScrolled,
      layoutShift.structuralShift,
    );
    const canReuseTranscript =
      (pureInputFrame || pureScrollFrame) &&
      transcriptLineCache !== undefined &&
      transcriptLineCacheWidth === size.columns &&
      transcriptLineCacheSelectionKey === selectionKey;
    const nativeFrame = buildTUIStateNativeFrame(state, size.columns, height, {
      diagnosticsOverlay: options.diagnosticsOverlay,
      diagnostics: runtime.diagnostics,
      reuseChrome,
      workspaceCenter,
      // Skip Ultrawork perimeter repaint on pure-input and pure-scroll frames;
      // animation frames still paint it so the border chase stays smooth.
      skipDecorativeEditorEffects: pureInputFrame || pureScrollFrame,
      // Damage-only stage paint on ambient ticks — see ambientDamageOnly.
      ambientDamageOnly,
      // Reuse transcript lines when the transcript has not changed.
      reuseTranscriptLines: canReuseTranscript ? transcriptLineCache : undefined,
    });
    // Refresh the cache only when chrome was freshly built this frame. Reused
    // frames keep the existing cache (its lines already match nativeFrame.chrome).
    if (reuseChrome === undefined) {
      chromeCache = {
        width: size.columns,
        stageWidth: nativeFrame.stageWidth,
        chromeEpoch,
        header: nativeFrame.chrome.header,
        activity: nativeFrame.chrome.activity,
        todo: nativeFrame.chrome.todo,
        queue: nativeFrame.chrome.queue,
        btw: nativeFrame.chrome.btw,
        footer: nativeFrame.chrome.footer,
      };
    }
    // Cache transcript lines for pure-input frame reuse.
    if (!canReuseTranscript) {
      transcriptLineCache = nativeFrame.transcriptLines;
      transcriptLineCacheWidth = size.columns;
      transcriptLineCacheSelectionKey = selectionKey;
    }
    // force/clear come from policy (pure input stays incremental). forceCursor
    // is independent and always on for IME caret stickiness — see shouldForceNativeCursor.
    const forceCursor = shouldForceNativeCursor({
      causes: frame.causes,
      structuralShift: layoutShift.structuralShift,
      viewportScrolled: layoutShift.viewportScrolled,
    });
    const result = runtime.renderLayoutFrame(nativeFrame.regions, {
      fill: options.fill ?? currentTheme.canvasBackgroundCell(),
      force: effectivePolicy.force,
      clear: effectivePolicy.clear,
      cursor: nativeFrame.cursor,
      forceCursor,
      // Draw workspace panels/ticker/status bar BEFORE present() so the writes
      // are flushed within this frame. Calling this after renderLayoutFrame
      // wrote into the back buffer past present(), where the next beginFrame()
      // discarded it — so panels/ticker/status bar never reached the terminal.
      beforePresent: (frameRenderer) => {
        options.postFrameRender?.({ frameRenderer, columns: size.columns, rows: height });
      },
    });
    return result;
  };
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

type TUIStateNativeFrameChrome = TUINativeStageChrome;

interface TUIStateNativeFrame {
  readonly regions: readonly RendererFrameRegion[];
  readonly cursor: RendererCursorState;
  readonly chrome: TUIStateNativeFrameChrome;
  readonly stageWidth: number;
  /** Rendered transcript region lines (cacheable across pure-input frames). */
  readonly transcriptLines: readonly RendererRegionLine[];
}
function isNativeFullscreenTakeover(state: TUIState): boolean {
  // Splash / tasks browser / approval preview replace the root tree. The native
  // layout path owns painting via container fields, so without this gate the
  // takeover child never reaches the frame and the alternate screen stays empty.
  return (
    state.ui.children.length > 0 &&
    !state.ui.children.includes(state.transcriptContainer)
  );
}

function emptyNativeFrameChrome(): TUIStateNativeFrameChrome {
  return {
    header: [],
    activity: [],
    todo: [],
    queue: [],
    btw: [],
    footer: [],
  };
}

function buildNativeFullscreenTakeoverFrame(
  state: TUIState,
  width: number,
  height: number,
  options: {
    readonly diagnosticsOverlay?: TUIStateNativeDiagnosticsOverlaySource;
    readonly diagnostics?: RendererDiagnosticsSnapshot;
    readonly skipDecorativeEditorEffects?: boolean;
    readonly ambientDamageOnly?: boolean;
  },
): TUIStateNativeFrame {
  const canvasBackground = currentTheme.canvasBackgroundCell();
  const ambientDamageOnly = options.ambientDamageOnly === true;
  const lines: RendererRegionLine[] = [];
  for (const child of state.ui.children) {
    const rendered = child.render(width);
    for (const line of rendered) {
      lines.push(line);
    }
  }
  // Clip or pad to the terminal height so the takeover owns the full surface.
  const clipped = lines.slice(0, height);
  while (clipped.length < height) {
    clipped.push(' '.repeat(Math.max(0, width)));
  }
  const rect = { x: 0, y: 0, width, height };
  const projected = projectRendererCursorMarkerLines({
    lines: clipped,
    rect,
    viewport: { x: 0, y: 0, width, height },
  });
  const content = promoteRendererRegionLinesToCells(projected.lines);
  const regions: RendererFrameRegion[] = [
    {
      id: 'fullscreen-takeover',
      rect,
      content,
      // Splash ambient ticks must damage-write only — full clear every frame
      // wipes the cinematic and reads as choppy FPS.
      clear: !ambientDamageOnly,
      background: canvasBackground,
      zIndex: 1_000,
    },
  ];
  const skipDecorative = options.skipDecorativeEditorEffects === true;
  const diagnosticsOverlay = skipDecorative
    ? undefined
    : createTUIStateDiagnosticsOverlayRegion(
        state,
        options.diagnosticsOverlay,
        options.diagnostics,
        width,
        height,
      );
  return {
    regions: diagnosticsOverlay === undefined ? regions : [...regions, diagnosticsOverlay],
    cursor: projected.cursor ?? hiddenNativeCursor(),
    chrome: emptyNativeFrameChrome(),
    stageWidth: width,
    transcriptLines: [],
  };
}

function buildTUIStateNativeFrame(
  state: TUIState,
  width: number,
  height: number,
  options: {
    readonly diagnosticsOverlay?: TUIStateNativeDiagnosticsOverlaySource;
    readonly diagnostics?: RendererDiagnosticsSnapshot;
    readonly reuseChrome?: TUIStateNativeFrameChrome;
    /** Skip Ultrawork perimeter chase / focus VFX (typing hot path). */
    readonly skipDecorativeEditorEffects?: boolean;
    /**
     * Pure ambient ticks: paint stage stack without region clear fills so we
     * only damage-write changed cells (avoids clear→paint tear bands).
     */
    readonly ambientDamageOnly?: boolean;
    /**
     * Cached transcript region lines from a prior frame. When set,
     * nativeTranscriptRegionLines is skipped — the transcript has not changed
     * on pure-input frames.
     */
    readonly reuseTranscriptLines?: readonly RendererRegionLine[];
    /**
     * Shell-aware workspace center band (see `resolveStageLayout`'s
     * `workspaceCenter`). When set, the stage resolves inside this band.
     */
    readonly workspaceCenter?: RendererRect;
  } = {},
): TUIStateNativeFrame {
  if (isNativeFullscreenTakeover(state)) {
    return buildNativeFullscreenTakeoverFrame(state, width, height, options);
  }
  const plan = planTUINativeStage(state, width, height, {
    reuseChrome: options.reuseChrome,
    workspaceCenter: options.workspaceCenter,
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
  const stageWidth = plan.stage.stage.width;
  const chrome = plan.chrome;
  const layout = plan.layout;
  // Pure-input fast path: reuse cached transcript lines when the transcript
  // has not changed (no structural shift, no viewport scroll).
  const transcriptLines = options.reuseTranscriptLines ??
    nativeTranscriptRegionLines(state, stageWidth, layout.transcriptRows);
  const linesByRegion = {
    transcript: transcriptLines,
    header: chrome.header,
    activity: chrome.activity,
    todo: chrome.todo,
    queue: chrome.queue,
    btw: chrome.btw,
    editor: plan.editorLines,
    footer: chrome.footer,
  } satisfies Record<RendererRegionId, readonly RendererRegionLine[]>;

  let cursor = hiddenNativeCursor();
  const canvasBackground = currentTheme.canvasBackgroundCell();
  const skipDecorative = options.skipDecorativeEditorEffects === true;
  const ambientDamageOnly = options.ambientDamageOnly === true;
  const stackRegions = createRendererStackFrameRegions(
    layout,
    layout.regions.flatMap((region) => {
      const source = linesByRegion[region.id];
      const projected =
        region.id === 'editor'
          ? projectNativeEditorRegion(state, source, region.rect, width, height)
          : projectRendererCursorMarkerLines({
              lines: source,
              rect: region.rect,
              viewport: { x: 0, y: 0, width, height },
            });
      if (projected.cursor !== undefined && cursor.visible === false) {
        cursor = projected.cursor;
      }
      // The editor cursor takes precedence over any earlier region's cursor
      // marker — the terminal cursor must sit at the text insertion point so
      // the OS IME renders its preedit (composing) text there, not at a stale
      // cursor position left over from a non-editor region.
      if (region.id === 'editor' && projected.cursor !== undefined) {
        cursor = projected.cursor;
      }
      const ultraworkBorder =
        region.id === 'editor' &&
        state.appState.ultraworkMode === true &&
        motionEffectsAllowed() &&
        !skipDecorative;
      // Promote ANSI strings to cells before Ultrawork border paint. Approval /
      // permission dialogs replace the editor and still emit chalk strings —
      // raw Array.from on those lines used to leak SGR bodies as visible text.
      const rawContent = region.id === 'transcript'
        ? promoteTranscriptRegionLinesToCells(projected.lines)
        : promoteRendererRegionLinesToCells(projected.lines);
      const content =
        ultraworkBorder && rawContent.length > 0
          ? paintUltraworkEditorBorderGlow(rawContent, appearanceAnimationNow())
          : rawContent;
      if (content.length === 0 && region.id !== 'transcript') return [];
      const vfx =
        region.id === 'editor' && state.editor.borderHighlighted && !skipDecorative
          ? ultraworkBorder
            ? createTUIStateNativeRegionVfx(state, 'loading-shimmer', {
                color: resolveUltraworkBorderGlowHex(appearanceAnimationNow()),
                seed: 'native-editor-ultrawork',
                // Faster, brighter chase across the frame perimeter feel.
                premiumIntervalMs: 720,
                subtleIntervalMs: 980,
                minIntensity: 0.18,
                maxIntensity: 0.72,
                width: 4,
              })
            : createTUIStateNativeRegionVfx(state, 'focus-pulse', {
                color: currentTheme.palette.primary,
                seed: 'native-editor-focus',
              })
          : undefined;
      return [{
        id: region.id,
        content,
        // Ambient ticks must not blank the whole stage rect before paint —
        // without sync that clear→rewrite sequence reads as horizontal tear.
        clear: !ambientDamageOnly,
        background: canvasBackground,
        vfx,
      }];
    }),
  );
  const regions: RendererFrameRegion[] = [...stackRegions];
  const appearance = state.appState.appearance ?? getActiveAppearancePreferences();
  // Keep letterbox sky + frame chase alive while typing; only editor VFX skips.
  regions.push(
    ...createStageFrameOverlayRegions({
      bundle: stageFrameBundleRect(plan.stage),
      cols: width,
      rows: height,
      nowMs: appearanceAnimationNow(),
      appearance,
      resizeHoverZone: getStageResizeHoverZone(),
      resizeDragging: isStageResizeDragging(),
    }),
  );
  const diagnosticsOverlay = skipDecorative
    ? undefined
    : createTUIStateDiagnosticsOverlayRegion(
        state,
        options.diagnosticsOverlay,
        options.diagnostics,
        width,
        height,
      );
  if (diagnosticsOverlay !== undefined) regions.push(diagnosticsOverlay);
  const centerModalOverlay = createCenterModalOverlayRegion(state.centerModalStack, {
    x: 0,
    y: 0,
    width,
    height,
  });
  if (centerModalOverlay !== undefined) regions.push(centerModalOverlay);
  const editorTopY = layout?.regions?.find((region) => region.id === 'editor')?.rect?.y;
  const toastOverlay = createTUIToastOverlayRegion(state, width, height, editorTopY);
  if (toastOverlay !== undefined) regions.push(toastOverlay);
  return {
    regions,
    cursor,
    chrome,
    stageWidth,
    transcriptLines,
  };
}

function normalizeFrameSize(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function hiddenNativeCursor(): RendererCursorState {
  return { x: 0, y: 0, visible: false };
}

/** Cheap string key that changes whenever the transcript selection range changes. */
function transcriptSelectionCacheKey(state: TUIState): string {
  const range = state.transcriptSelection.rangeForRender();
  if (range === undefined) return '';
  return `${range.start.globalLine}:${range.start.col}-${range.end.globalLine}:${range.end.col}`;
}
