import {
  createRendererStackFrameRegions,
  createRendererDiagnosticsOverlayRegion,
  createRendererRegionVfx,
  measureRendererRegions,
  NativeFrameRenderer,
  NativeTerminalRenderer,
  nativeTerminalAdaptiveFeatureProfile,
  RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
  rendererEditorContentHeight,
  rendererEditorContentWidth,
  measureRendererEditorSurfaceLayout,
  projectRendererCursorMarkerLines,
  projectRendererEditorSurfaceCursor,
  renderNativeLayoutFrame,
  renderRendererEditorSurface,
  resolveRendererEditorSurfaceStyles,
  type NativeLayoutFrameResult,
  type NativeTerminalInput,
  type NativeTerminalOutput,
  type NativeTerminalRendererOptions,
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
  resolveAmbientEffectMode,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';

import type { TUIState } from '../tui-state';

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

export interface TUIStateNativeRendererOptions
  extends Omit<NativeTerminalRendererOptions, 'render'> {
  readonly diagnosticsOverlay?: TUIStateNativeDiagnosticsOverlaySource;
}

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
    fill: options.fill,
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
  let lastDiagnostics: RendererDiagnosticsSnapshot | undefined;
  let nativeRenderer: NativeTerminalRenderer;
  nativeRenderer = new NativeTerminalRenderer({
    ...options,
    autoBeginFrame: false,
    autoFrameHold: options.autoFrameHold ?? (() => !state.transcriptViewport.followOutput),
    outputPolicy: options.outputPolicy ?? 'balanced',
    render: ({ frame, runtime, size, quality }) => {
      if (frame.causes.includes('start')) runtime.cancelRegionAnimationFrame();
      advanceAppearanceAnimationClock(frame.timestamp);
      setAppearanceRenderQuality(quality.level);
      const nativeFrame = buildTUIStateNativeFrame(state, size.columns, size.rows, {
        diagnosticsOverlay: options.diagnosticsOverlay,
        diagnostics: lastDiagnostics,
      });
      return runtime.renderLayoutFrame(nativeFrame.regions, {
        fill: options.fill,
        force: frame.causes.includes('start') || frame.causes.includes('resize'),
        cursor: nativeFrame.cursor,
      });
    },
    onFrame: (result, stats) => {
      setAppearanceRenderHealth(stats.health);
      lastDiagnostics = nativeRenderer.diagnostics;
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
  const activityRows = state.activityContainer.render(frameWidth).length;
  const todoRows = state.todoPanelContainer.render(frameWidth).length;
  const queueRows = state.queueContainer.render(frameWidth).length;
  const btwRows = state.btwPanelContainer.render(frameWidth).length;
  const editorRows = state.editorContainer.render(frameWidth).length;
  const footerRows = state.footerContainer.render(frameWidth).length;
  const layout = measureRendererRegions({
    terminalRows: frameHeight,
    terminalColumns: frameWidth,
    heights: {
      activity: activityRows,
      todo: todoRows,
      queue: queueRows,
      btw: btwRows,
      editor: nativeEditorRegionRowsForLayout(
        state,
        editorRows,
        frameHeight,
        activityRows + todoRows + queueRows + btwRows + footerRows,
      ),
      footer: footerRows,
    },
  });
  return layout.regions.find((region) => region.id === 'editor')?.rect;
}

interface TUIStateNativeFrame {
  readonly regions: readonly RendererFrameRegion[];
  readonly cursor: RendererCursorState;
}

function buildTUIStateNativeFrame(
  state: TUIState,
  width: number,
  height: number,
  options: {
    readonly diagnosticsOverlay?: TUIStateNativeDiagnosticsOverlaySource;
    readonly diagnostics?: RendererDiagnosticsSnapshot;
  } = {},
): TUIStateNativeFrame {
  const activityLines = state.activityContainer.render(width);
  const todoLines = state.todoPanelContainer.render(width);
  const queueLines = state.queueContainer.render(width);
  const btwLines = state.btwPanelContainer.render(width);
  const editorLines = state.editorContainer.render(width);
  const footerLines = state.footerContainer.render(width);
  const fixedRowsWithoutEditor =
    activityLines.length +
    todoLines.length +
    queueLines.length +
    btwLines.length +
    footerLines.length;
  const editorRows = nativeEditorRegionRowsForLayout(
    state,
    editorLines.length,
    height,
    fixedRowsWithoutEditor,
  );
  const layout = measureRendererRegions({
    terminalRows: height,
    terminalColumns: width,
    heights: {
      activity: activityLines.length,
      todo: todoLines.length,
      queue: queueLines.length,
      btw: btwLines.length,
      editor: editorRows,
      footer: footerLines.length,
    },
  });
  const linesByRegion = {
    transcript: state.transcriptContainer.renderWithVisibleRows(width, layout.transcriptRows),
    activity: activityLines,
    todo: todoLines,
    queue: queueLines,
    btw: btwLines,
    editor: editorLines,
    footer: footerLines,
  } satisfies Record<RendererRegionId, readonly RendererRegionLine[]>;

  let cursor = hiddenNativeCursor();
  const regions = createRendererStackFrameRegions(
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
      const content = projected.lines;
      if (content.length === 0 && region.id !== 'transcript') return [];
      const vfx = region.id === 'editor' && state.editor.borderHighlighted
        ? createTUIStateNativeRegionVfx(state, 'focus-pulse', {
            color: currentTheme.palette.primary,
            seed: 'native-editor-focus',
          })
        : undefined;
      return [{ id: region.id, content, clear: true, vfx }];
    }),
  );
  const diagnosticsOverlay = createTUIStateDiagnosticsOverlayRegion(
    state,
    options.diagnosticsOverlay,
    options.diagnostics,
    width,
    height,
  );
  return {
    regions: diagnosticsOverlay === undefined ? regions : [...regions, diagnosticsOverlay],
    cursor,
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
  },
): ReturnType<typeof createRendererRegionVfx> {
  if (!state.transcriptViewport.followOutput) return undefined;
  if (!motionEffectsAllowed()) return undefined;
  const appearance = state.appState.appearance ?? getActiveAppearancePreferences();
  return createRendererRegionVfx({
    preset,
    requested: resolveAmbientEffectMode(appearance),
    quality: getAppearanceRenderQuality(),
    health: getAppearanceRenderHealth(),
    nowMs: appearanceAnimationNow(),
    seed: options.seed,
    color: options.color,
    rect: options.rect,
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
): number {
  if (!state.editorContainer.children.includes(state.editor) || editorRows <= 0) {
    return editorRows;
  }

  const minEditorRows = Math.min(editorRows, 3);
  const availableRows = Math.max(
    0,
    Math.floor(terminalRows) - fixedRowsWithoutEditor - NATIVE_LAYOUT_MIN_TRANSCRIPT_ROWS,
  );
  return Math.min(editorRows, Math.max(minEditorRows, availableRows));
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

  const overlayLines = state.editor.getNativeOverlayLines?.(Math.floor(rect.width)) ?? [];
  const surfaceLayout = measureRendererEditorSurfaceLayout({
    height: Math.floor(rect.height),
    overlays: overlayLines,
  });
  const editorFrameRect = { ...rect, height: surfaceLayout.frameRows };
  const palette = currentTheme.palette;
  const isBash = state.editor.inputMode === 'bash';
  const editorStyles = resolveRendererEditorSurfaceStyles({
    commandMode: isBash,
    focused: state.editor.borderHighlighted,
    canvasBackground: currentTheme.canvasBackgroundEnabled,
    palette: {
      text: palette.text,
      textMuted: palette.textMuted,
      textStrong: palette.textStrong,
      border: palette.border,
      borderFocus: palette.primary,
      command: palette.shellMode,
      surfaceSunken: palette.surfaceSunken,
      selectionBg: palette.selectionBg,
      selectionText: palette.selectionText,
    },
  });
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
    overlays: surfaceLayout.overlayLines,
    scrollbar: {},
    connectedAbove: state.editor.connectedAbove && !state.editor.borderHighlighted,
    borderStyle: editorStyles.borderStyle,
    promptStyle: editorStyles.promptStyle,
    surfaceStyle: editorStyles.surfaceStyle,
    scrollbarTrackStyle: editorStyles.scrollbarTrackStyle,
    scrollbarThumbStyle: editorStyles.scrollbarThumbStyle,
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

function normalizeFrameSize(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function hiddenNativeCursor(): RendererCursorState {
  return { x: 0, y: 0, visible: false };
}
