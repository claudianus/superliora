import {
  createRendererStackFrameRegions,
  createRendererDiagnosticsOverlayRegion,
  createRendererRegionVfx,
  NativeFrameRenderer,
  NativeTerminalRenderer,
  nativeTerminalAdaptiveFeatureProfile,
  resolveNativePremiumRendererDefaults,
  RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
  RENDERER_EDITOR_SHELL_MODE_LABEL,
  rendererEditorContentHeight,
  rendererEditorContentWidth,
  measureRendererEditorSurfaceLayout,
  measureRendererEditorSurfaceNaturalRows,
  projectRendererCursorMarkerLines,
  projectRendererEditorSurfaceCursor,
  promoteRendererRegionLinesToCells,
  renderNativeLayoutFrame,
  renderRendererEditorSurface,
  resolveRendererEditorSurfaceStyles,
  visibleWidth,
  type NativeLayoutFrameResult,
  type NativeTerminalInput,
  type NativeTerminalOutput,
  type NativeTerminalRendererOptions,
  type NativeTerminalRendererRender,
  type RendererCell,
  type RendererCellStyle,
  type RendererCompositionCache,
  type RendererCursorState,
  type RendererDiagnosticsSnapshot,
  type RendererFrameRegion,
  type RendererLineCellCache,
  type RendererOutputTarget,
  type RendererOverlayPanelLineStyle,
  type RendererOverlayPlacement,
  type RendererRect,
  type RendererRegionVfxPreset,
  type RendererRegionId,
  type RendererRegionLine,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  advanceAppearanceAnimationClock,
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  getAppearanceRenderHealth,
  getAppearanceRenderQuality,
  motionEffectsAllowed,
  paintUltraworkEditorBorderGlow,
  resolveAmbientEffectMode,
  resolveUltraworkBorderGlowHex,
  resolveUltraworkEditorBorderStyle,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

import { shouldAnimate, shouldRenderAmbientAnimationFrame } from '../controllers/appearance';
import type { TUIState } from '../tui-state';
import { isTUIInputInteractionActive } from './input-interaction';
import {
  isPureInputFrame,
  resolveTUIStateNativeFramePolicy,
  shouldForceNativeCursor,
  shouldForceTUIStateNativeLayoutFrame,
  shouldRefreshNativeTerminalPalette,
} from './native-frame-policy';

export {
  frameInvalidationIntentToCause,
  isPureInputFrame,
  isPureTranscriptScrollFrame,
  resolveTUIStateNativeFramePolicy,
  shouldForceNativeCursor,
  shouldForceTUIStateNativeLayoutFrame,
  shouldRefreshNativeTerminalPalette,
  type FrameInvalidationIntent,
  type TUIStateNativeFramePolicy,
  type TUIStateNativeFramePolicyInput,
} from './native-frame-policy';
import { CHROME_GUTTER } from '../constant/rendering';
import { resolveStageLayout } from '../controllers/stage-layout';
import {
  planTUINativeStage,
  type TUINativeStageChrome,
} from './native-stage-plan';
import {
  createStageFrameOverlayRegions,
  stageFrameBundleRect,
} from './stage-frame';
import {
  cellSelectedAtColumn,
  shouldHoldTranscriptAnimation,
  type TranscriptSelectionRange,
} from './transcript-selection';

const DEFAULT_NATIVE_FRAME_COLUMNS = 80;
const DEFAULT_NATIVE_FRAME_ROWS = 24;
const NATIVE_LAYOUT_MIN_TRANSCRIPT_ROWS = 1;

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

export type TUIStateNativeDiagnosticsOverlayInput =
  | boolean
  | TUIStateNativeDiagnosticsOverlayOptions;
export type TUIStateNativeDiagnosticsOverlayResolver =
  () => TUIStateNativeDiagnosticsOverlayInput | undefined;
export type TUIStateNativeDiagnosticsOverlaySource =
  | TUIStateNativeDiagnosticsOverlayInput
  | TUIStateNativeDiagnosticsOverlayResolver;

export interface TUIStateNativeDiagnosticsOverlayOptions {
  readonly enabled?: boolean;
  readonly diagnostics?: RendererDiagnosticsSnapshot;
  readonly width?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly placement?: RendererOverlayPlacement;
  readonly marginX?: number;
  readonly marginY?: number;
  readonly zIndex?: number;
  readonly title?: string;
  readonly border?: boolean;
  readonly maxIssues?: number;
  readonly includeIssues?: boolean;
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

interface TUIStateNativeLayoutTracking {
  transcriptStart?: number;
  transcriptContentRows?: number;
  transcriptChildCount?: number;
  editorLayoutRows?: number;
}

export interface TUIStateNativeLayoutShift {
  readonly shifted: boolean;
  readonly viewportScrolled: boolean;
  readonly structuralShift: boolean;
  readonly next: TUIStateNativeLayoutTracking;
}

export function detectTUIStateNativeLayoutShift(
  state: TUIState,
  frameWidth: number,
  prior: TUIStateNativeLayoutTracking,
  frameHeight = state.terminal.rows,
): TUIStateNativeLayoutShift {
  const stageWidth = resolveStageLayout({
    width: frameWidth,
    height: frameHeight,
    hasRailContent: false,
  }).stage.width;
  const transcriptStart = state.transcriptViewport.start();
  const transcriptContentRows = state.transcriptContainer.contentRowCount(stageWidth);
  const transcriptChildCount = state.transcriptContainer.children.length;
  const editorLayoutRows =
    state.editorContainer.children.includes(state.editor) &&
    state.editor.getNativeLayoutRowCount !== undefined
      ? state.editor.getNativeLayoutRowCount(stageWidth)
      : undefined;
  const viewportScrolled =
    prior.transcriptStart !== undefined && prior.transcriptStart !== transcriptStart;
  const structuralShift =
    (prior.transcriptContentRows !== undefined &&
      prior.transcriptContentRows !== transcriptContentRows) ||
    (prior.transcriptChildCount !== undefined &&
      prior.transcriptChildCount !== transcriptChildCount) ||
    (prior.editorLayoutRows !== undefined &&
      editorLayoutRows !== undefined &&
      prior.editorLayoutRows !== editorLayoutRows);
  const next: TUIStateNativeLayoutTracking = {
    transcriptStart,
    transcriptContentRows,
    transcriptChildCount,
  };
  if (editorLayoutRows !== undefined) next.editorLayoutRows = editorLayoutRows;
  return {
    shifted: viewportScrolled || structuralShift,
    viewportScrolled,
    structuralShift,
    next,
  };
}

interface TUIStateNativeChromeCache extends TUINativeStageChrome {
  readonly width: number;
  readonly stageWidth: number;
  readonly stageMode: 'stack' | 'rail';
}

export function createTUIStateNativeRenderCallback(
  state: TUIState,
  options: TUIStateNativeRenderCallbackOptions,
): NativeTerminalRendererRender {
  let layoutTracking: TUIStateNativeLayoutTracking = {};
  let chromeCache: TUIStateNativeChromeCache | undefined;
  return ({ frame, runtime, size, quality }) => {
    if (frame.causes.includes('start')) runtime.cancelRegionAnimationFrame();
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
      shouldRenderAmbientAnimationFrame(
        state.transcriptViewport.followOutput,
        size.rows,
        state.transcriptSelection.isDragging || state.transcriptSelection.hasSelection,
        { nowMs: frame.timestamp },
      );
    const policy = resolveTUIStateNativeFramePolicy({
      causes: frame.causes,
      viewportScrolled: layoutShift.viewportScrolled,
      structuralShift: layoutShift.structuralShift,
      priorTranscriptStart: priorStart,
      nextTranscriptStart: layoutShift.next.transcriptStart ?? 0,
      ambientAnimationAllowed,
    });
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
    const stageProbe = resolveStageLayout({
      width: size.columns,
      height,
      hasRailContent: chromeCache?.stageMode === 'rail',
    });
    const reuseChrome =
      pureInputFrame &&
      chromeCache !== undefined &&
      chromeCache.width === size.columns &&
      chromeCache.stageWidth === stageProbe.stage.width
        ? chromeCache
        : undefined;
    const typingHoldoff = isTUIInputInteractionActive(frame.timestamp);
    const nativeFrame = buildTUIStateNativeFrame(state, size.columns, height, {
      diagnosticsOverlay: options.diagnosticsOverlay,
      diagnostics: runtime.diagnostics,
      reuseChrome,
      // Skip Ultrawork perimeter repaint while typing — animation resumes after holdoff.
      skipDecorativeEditorEffects: typingHoldoff || pureInputFrame,
    });
    if (
      !pureInputFrame ||
      chromeCache === undefined ||
      chromeCache.width !== size.columns ||
      chromeCache.stageWidth !== nativeFrame.stageWidth ||
      chromeCache.stageMode !== nativeFrame.stageMode
    ) {
      chromeCache = {
        width: size.columns,
        stageWidth: nativeFrame.stageWidth,
        stageMode: nativeFrame.stageMode,
        header: nativeFrame.chrome.header,
        activity: nativeFrame.chrome.activity,
        todo: nativeFrame.chrome.todo,
        queue: nativeFrame.chrome.queue,
        btw: nativeFrame.chrome.btw,
        footer: nativeFrame.chrome.footer,
      };
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
      force: policy.force,
      clear: policy.clear,
      cursor: nativeFrame.cursor,
      forceCursor,
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
    autoFrameHold: options.autoFrameHold ?? (() => shouldHoldTranscriptAnimation({
      followOutput: state.transcriptViewport.followOutput,
      transcriptSelection: state.transcriptSelection,
    })),
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
  const plan = planTUINativeStage(state, frameWidth, frameHeight, {
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
  return plan.layout.regions.find((region) => region.id === 'editor')?.rect;
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
  readonly stageMode: 'stack' | 'rail';
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
  },
): TUIStateNativeFrame {
  const canvasBackground = currentTheme.canvasBackgroundCell();
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
      clear: true,
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
    stageMode: 'stack',
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
  } = {},
): TUIStateNativeFrame {
  if (isNativeFullscreenTakeover(state)) {
    return buildNativeFullscreenTakeoverFrame(state, width, height, options);
  }
  const plan = planTUINativeStage(state, width, height, {
    reuseChrome: options.reuseChrome,
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
  const linesByRegion = {
    transcript: nativeTranscriptRegionLines(state, stageWidth, layout.transcriptRows),
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
        clear: true,
        background: canvasBackground,
        vfx,
      }];
    }),
  );
  const regions: RendererFrameRegion[] =
    plan.railRect !== undefined && plan.railLines.length > 0
      ? [
          ...stackRegions,
          {
            id: 'rail',
            rect: plan.railRect,
            content: promoteRendererRegionLinesToCells(
              projectRendererCursorMarkerLines({
                lines: plan.railLines,
                rect: plan.railRect,
                viewport: { x: 0, y: 0, width, height },
              }).lines,
            ),
            clear: true,
            background: canvasBackground,
            zIndex: 2,
          },
        ]
      : [...stackRegions];
  const appearance = state.appState.appearance ?? getActiveAppearancePreferences();
  // Keep letterbox sky + frame chase alive while typing; only editor VFX skips.
  regions.push(
    ...createStageFrameOverlayRegions({
      bundle: stageFrameBundleRect(plan.stage),
      cols: width,
      rows: height,
      nowMs: appearanceAnimationNow(),
      appearance,
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
  return {
    regions: diagnosticsOverlay === undefined ? regions : [...regions, diagnosticsOverlay],
    cursor,
    chrome,
    stageWidth,
    stageMode: plan.stage.mode,
  };
}

function createTUIStateDiagnosticsOverlayRegion(
  state: TUIState,
  input: TUIStateNativeDiagnosticsOverlaySource | undefined,
  fallbackDiagnostics: RendererDiagnosticsSnapshot | undefined,
  width: number,
  height: number,
): RendererFrameRegion | undefined {
  const options = normalizeDiagnosticsOverlayInput(input);
  if (options === undefined) return undefined;
  const diagnostics = options.diagnostics ?? fallbackDiagnostics;
  if (diagnostics === undefined) return undefined;
  const palette = currentTheme.palette;
  const panelBg = currentTheme.canvasBackgroundEnabled ? palette.surfaceRaised : undefined;
  const severityColor = diagnostics.severity === 'degraded'
    ? palette.error
    : diagnostics.severity === 'watch'
      ? palette.warning
      : palette.success;
  const region = createRendererDiagnosticsOverlayRegion(diagnostics, {
    id: 'kimi-native-renderer-diagnostics',
    viewport: { x: 0, y: 0, width, height },
    width: options.width,
    minWidth: options.minWidth,
    maxWidth: options.maxWidth ?? Math.min(72, Math.max(12, width - 2)),
    maxHeight: options.maxHeight ?? 8,
    placement: options.placement ?? 'top-right',
    marginX: options.marginX ?? 1,
    marginY: options.marginY ?? 1,
    zIndex: options.zIndex,
    title: options.title ?? 'Renderer',
    border: options.border,
    maxIssues: options.maxIssues ?? 2,
    includeIssues: options.includeIssues,
    style: {
      container: { fg: palette.text, bg: panelBg },
      border: { fg: severityColor, bg: panelBg },
      title: { fg: severityColor, bg: panelBg, bold: true },
      body: { fg: palette.textDim, bg: panelBg },
    },
    lineStyle: createTUIStateDiagnosticsOverlayLineStyle(panelBg),
    background: { char: ' ', style: { fg: palette.text, bg: panelBg } },
  });
  if (region === undefined || diagnostics.severity === 'ok') return region;
  return {
    ...region,
    vfx: createTUIStateNativeRegionVfx(state, 'focus-pulse', {
      color: severityColor,
      seed: `native-diagnostics:${diagnostics.severity}`,
    }),
  };
}

function createTUIStateNativeRegionVfx(
  state: TUIState,
  preset: RendererRegionVfxPreset,
  options: {
    readonly color: string;
    readonly seed: string;
    readonly rect?: RendererRect;
    readonly premiumIntervalMs?: number;
    readonly subtleIntervalMs?: number;
    readonly minIntensity?: number;
    readonly maxIntensity?: number;
    readonly width?: number;
  },
): ReturnType<typeof createRendererRegionVfx> {
  if (!state.transcriptViewport.followOutput) return undefined;
  if (!motionEffectsAllowed()) return undefined;
  const appearance = state.appState.appearance ?? getActiveAppearancePreferences();
  // Ultrawork / premium spectacle pins full quality so the glow does not freeze under load.
  const premiumPinned =
    resolveAmbientEffectMode(appearance) === 'premium' || state.appState.ultraworkMode === true;
  return createRendererRegionVfx({
    preset,
    requested:
      state.appState.ultraworkMode === true
        ? 'premium'
        : resolveAmbientEffectMode(appearance),
    quality: premiumPinned ? 'full' : getAppearanceRenderQuality(),
    health: premiumPinned ? 'healthy' : getAppearanceRenderHealth(),
    nowMs: appearanceAnimationNow(),
    seed: options.seed,
    color: options.color,
    rect: options.rect,
    premiumIntervalMs: options.premiumIntervalMs,
    subtleIntervalMs: options.subtleIntervalMs,
    minIntensity: options.minIntensity,
    maxIntensity: options.maxIntensity,
    width: options.width,
  });
}

function normalizeDiagnosticsOverlayInput(
  input: TUIStateNativeDiagnosticsOverlaySource | undefined,
): TUIStateNativeDiagnosticsOverlayOptions | undefined {
  if (typeof input === 'function') return normalizeDiagnosticsOverlayInput(input());
  if (input === undefined || input === false) return undefined;
  if (input === true) return {};
  if (input.enabled === false) return undefined;
  return input;
}

function createTUIStateDiagnosticsOverlayLineStyle(
  background: string | undefined,
): RendererOverlayPanelLineStyle {
  return (line): RendererCellStyle | undefined => {
    const palette = currentTheme.palette;
    if (line.startsWith('degraded:')) return { fg: palette.error, bg: background, bold: true };
    if (line.startsWith('watch:')) return { fg: palette.warning, bg: background, bold: true };
    return undefined;
  };
}

function nativeEditorRegionRowsForLayout(
  state: TUIState,
  editorRows: number,
  terminalRows: number,
  fixedRowsWithoutEditor: number,
  frameWidth: number,
): number {
  if (!state.editorContainer.children.includes(state.editor) || editorRows <= 0) {
    return editorRows;
  }

  const overlayLines = state.editor.getNativeOverlayLines?.(Math.floor(frameWidth)) ?? [];
  const desiredRows = state.editor.getNativeLayoutRowCount?.(Math.floor(frameWidth))
    ?? (overlayLines.length > 0
      ? measureRendererEditorSurfaceNaturalRows(overlayLines)
      : editorRows);
  // Closed box needs 3 rows; open autocomplete needs at least 4
  // (top + input + ≥1 suggestion + bottom). Capping the floor at 3 used to
  // clip slash suggestions in short terminals even when a 4th row was free.
  const minEditorRows = Math.min(
    desiredRows,
    overlayLines.length > 0 ? 4 : 3,
  );
  const availableRows = Math.max(
    0,
    Math.floor(terminalRows) - fixedRowsWithoutEditor - NATIVE_LAYOUT_MIN_TRANSCRIPT_ROWS,
  );
  return Math.min(desiredRows, Math.max(minEditorRows, availableRows));
}

function projectNativeEditorRegion(
  state: TUIState,
  fallbackLines: readonly RendererRegionLine[],
  rect: RendererRect | undefined,
  terminalColumns: number,
  terminalRows: number,
): {
  readonly lines: readonly RendererRegionLine[];
  readonly cursor?: RendererCursorState;
} {
  if (rect === undefined || !state.editorContainer.children.includes(state.editor)) {
    return projectRendererCursorMarkerLines({
      lines: fallbackLines,
      rect,
      viewport: { x: 0, y: 0, width: terminalColumns, height: terminalRows },
    });
  }
  if (rect.width < 5 || rect.height < 3) {
    return projectRendererCursorMarkerLines({
      lines: fallbackLines,
      rect,
      viewport: { x: 0, y: 0, width: terminalColumns, height: terminalRows },
    });
  }

  const palette = currentTheme.palette;
  const isBash = state.editor.inputMode === 'bash';
  const ultraworkGlow =
    state.appState.ultraworkMode === true && motionEffectsAllowed();
  const ultraworkBorderStyle = ultraworkGlow
    ? resolveUltraworkEditorBorderStyle(appearanceAnimationNow())
    : undefined;
  const editorStyles = resolveRendererEditorSurfaceStyles({
    commandMode: isBash,
    focused: state.editor.borderHighlighted || ultraworkGlow,
    canvasBackground: currentTheme.canvasBackgroundEnabled,
    palette: {
      text: palette.text,
      textMuted: palette.textMuted,
      textStrong: palette.textStrong,
      border: palette.border,
      // Ultrawork replaces the static focus color with a liquid multi-hue base;
      // paintUltraworkEditorBorderGlow then adds the perimeter chase on top.
      borderFocus: ultraworkGlow
        ? resolveUltraworkBorderGlowHex(appearanceAnimationNow())
        : palette.primary,
      command: palette.shellMode,
      surfaceSunken: palette.surfaceSunken,
      background: palette.background,
      selectionBg: palette.selectionBg,
      selectionText: palette.selectionText,
    },
  });
  const overlayLines = state.editor.getNativeOverlayLines?.(Math.floor(rect.width), {
    text: editorStyles.textStyle,
    selected: editorStyles.autocompleteSelectedStyle,
    description: editorStyles.autocompleteDescriptionStyle,
    scroll: editorStyles.autocompleteScrollStyle,
  }) ?? [];
  const surfaceLayout = measureRendererEditorSurfaceLayout({
    height: Math.floor(rect.height),
    overlays: overlayLines,
  });
  const editorFrameRect = { ...rect, height: surfaceLayout.frameRows };
  const contentHeight = rendererEditorContentHeight(
    editorFrameRect,
    RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
  ) ?? 1;
  const contentWidth = rendererEditorContentWidth(
    editorFrameRect,
    RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
  ) ?? 1;
  const input = state.nativeEditorTextInput.inputForEditor(state.editor, {
    focused: true,
    cursorShape: 'bar',
    cursorBlinking: true,
    layoutWidth: contentWidth,
    layoutHeight: contentHeight,
    style: editorStyles.textStyle,
    placeholderStyle: editorStyles.placeholderStyle,
    selectionStyle: editorStyles.selectionStyle,
  });
  const rendered = input.render({
    width: contentWidth,
    height: contentHeight,
    focused: true,
    style: editorStyles.textStyle,
    placeholderStyle: editorStyles.placeholderStyle,
    selectionStyle: editorStyles.selectionStyle,
  });
  const surface = renderRendererEditorSurface({
    width: Math.floor(rect.width),
    frameRows: surfaceLayout.frameRows,
    content: rendered,
    prompt: isBash ? '!' : '>',
    topLabel: isBash ? RENDERER_EDITOR_SHELL_MODE_LABEL : undefined,
    overlays: surfaceLayout.overlayLines,
    scrollbar: {},
    connectedAbove: state.editor.connectedAbove && !state.editor.borderHighlighted && !ultraworkGlow,
    borderStyle: ultraworkBorderStyle ?? editorStyles.borderStyle,
    promptStyle: editorStyles.promptStyle,
    surfaceStyle: editorStyles.surfaceStyle,
    scrollbarTrackStyle: editorStyles.scrollbarTrackStyle,
    scrollbarThumbStyle: editorStyles.scrollbarThumbStyle,
    slashTokenStyle: isBash ? undefined : editorStyles.slashTokenStyle,
  });
  const cursor = projectRendererEditorSurfaceCursor({
    surface,
    rect,
    viewport: { x: 0, y: 0, width: terminalColumns, height: terminalRows },
  });

  const projected: {
    readonly lines: readonly RendererRegionLine[];
    cursor?: RendererCursorState;
  } = {
    lines: surface.lines,
  };
  if (cursor !== undefined) projected.cursor = cursor;
  return projected;
}

function nativeEditorFallbackRegionLines(
  state: TUIState,
  width: number,
): readonly RendererRegionLine[] {
  if (
    state.editorContainer.children.includes(state.editor) &&
    state.editor.getNativeRegionLines !== undefined
  ) {
    return state.editor.getNativeRegionLines(width);
  }
  return state.editorContainer.render(width);
}

/**
 * Parse transcript ANSI lines at frame-compose time (same path as footer chrome)
 * and backfill a theme text foreground when a visible cell only carries background.
 * Without an explicit fg, terminals fall back to their default foreground (often
 * bright white) after authoritative clears — which looked like "theme colors died"
 * in the transcript while footer strings kept their chalk hex colors.
 */
function promoteTranscriptRegionLinesToCells(
  lines: readonly RendererRegionLine[],
): readonly RendererRegionLine[] {
  const defaultFg = currentTheme.palette.text;
  return promoteRendererRegionLinesToCells(lines).map((line) => {
    if (typeof line === 'string') return line;
    return line.map((cell) => {
      if (cell.style?.fg !== undefined || cell.char.trim().length === 0) return cell;
      return { ...cell, style: { fg: defaultFg, ...cell.style } };
    });
  });
}

function nativeTranscriptRegionLines(
  state: TUIState,
  width: number,
  visibleRows: number,
): readonly RendererRegionLine[] {
  const container = state.transcriptContainer;
  const lines = typeof container.renderWithVisibleRegionLines === 'function'
    ? container.renderWithVisibleRegionLines(width, visibleRows)
    : promoteRendererRegionLinesToCells(
        container.renderWithVisibleRows(width, visibleRows),
      );
  const range = state.transcriptSelection.rangeForRender();
  if (range === undefined) return lines;
  const palette = currentTheme.palette;
  const editorStyles = resolveRendererEditorSurfaceStyles({
    palette: {
      text: palette.text,
      textMuted: palette.textMuted,
      textStrong: palette.textStrong,
      border: palette.border,
      borderFocus: palette.borderFocus,
      command: palette.shellMode,
      surfaceSunken: palette.surfaceSunken,
      background: palette.background,
      selectionBg: palette.selectionBg,
      selectionText: palette.selectionText,
    },
    canvasBackground: currentTheme.canvasBackgroundEnabled,
  });
  return applyTranscriptSelectionOverlay(
    lines,
    state.transcriptViewport.start(),
    range,
    editorStyles.selectionStyle,
  );
}

function applyTranscriptSelectionOverlay(
  lines: readonly RendererRegionLine[],
  viewportStart: number,
  range: TranscriptSelectionRange,
  selectionStyle: RendererCellStyle,
): readonly RendererRegionLine[] {
  return lines.map((line, rowIndex) =>
    applyTranscriptSelectionOverlayToLine(
      line,
      viewportStart + rowIndex,
      range,
      selectionStyle,
    ),
  );
}

function applyTranscriptSelectionOverlayToLine(
  line: RendererRegionLine,
  globalLine: number,
  range: TranscriptSelectionRange,
  selectionStyle: RendererCellStyle,
): RendererRegionLine {
  if (typeof line === 'string') {
    return applyTranscriptSelectionOverlayToLine(
      promoteRendererRegionLinesToCells([line])[0] ?? [],
      globalLine,
      range,
      selectionStyle,
    );
  }
  let col = 0;
  return line.map((cell) => {
    const cellWidth = Math.max(1, visibleWidth(cell.char));
    const selected = cellSelectedAtColumn(
      globalLine,
      col,
      col + cellWidth,
      range,
      CHROME_GUTTER,
    );
    col += cellWidth;
    if (!selected) return cell;
    return {
      ...cell,
      style: mergeTranscriptSelectionCellStyle(cell.style, selectionStyle),
    };
  });
}

function mergeTranscriptSelectionCellStyle(
  base: RendererCellStyle | undefined,
  overlay: RendererCellStyle,
): RendererCellStyle {
  if (base === undefined) return overlay;
  return { ...base, ...overlay };
}

function normalizeFrameSize(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function hiddenNativeCursor(): RendererCursorState {
  return { x: 0, y: 0, visible: false };
}
