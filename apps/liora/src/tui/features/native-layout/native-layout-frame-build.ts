import {
  createRendererStackFrameRegions,
  projectRendererCursorMarkerLines,
  promoteRendererRegionLinesToCells,
  type RendererCursorState,
  type RendererDiagnosticsSnapshot,
  type RendererFrameRegion,
  type RendererRect,
  type RendererRegionId,
  type RendererRegionLine,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { createCenterModalOverlayRegion } from '#/tui/utils/ui/center-modal';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  paintUltraworkEditorBorderGlow,
  resolveUltraworkBorderGlowHex,
} from '#/tui/features/appearance/appearance-effects';

import type { TUIState } from '../../tui-state';
import {
  nativeEditorFallbackRegionLines,
  nativeEditorRegionRowsForLayout,
  projectNativeEditorRegion,
} from './native-layout-frame-editor';
import {
  createTUIStateDiagnosticsOverlayRegion,
  createTUIStateNativeRegionVfx,
  createTUIToastOverlayRegion,
  type TUIStateNativeDiagnosticsOverlaySource,
} from './native-layout-frame-overlays';
import {
  nativeTranscriptRegionLines,
  promoteTranscriptRegionLinesToCells,
} from './native-layout-frame-transcript';
import { planTUINativeStage, type TUINativeStageChrome } from '#/tui/features/native-layout/native-stage-plan';
import {
  createStageFrameOverlayRegions,
  stageFrameBundleRect,
} from '#/tui/features/stage/stage-frame';
import {
  getStageResizeHoverZone,
  isStageResizeDragging,
} from '#/tui/features/stage/stage-resize-mouse';

export type TUIStateNativeFrameChrome = TUINativeStageChrome;

export interface TUIStateNativeFrame {
  readonly regions: readonly RendererFrameRegion[];
  readonly cursor: RendererCursorState;
  readonly chrome: TUIStateNativeFrameChrome;
  readonly stageWidth: number;
  /** Rendered transcript region lines (cacheable across pure-input frames). */
  readonly transcriptLines: readonly RendererRegionLine[];
}

export function isNativeFullscreenTakeover(state: TUIState): boolean {
  // Splash / tasks browser / approval preview replace the root tree. The native
  // layout path owns painting via container fields, so without this gate the
  // takeover child never reaches the frame and the alternate screen stays empty.
  return (
    state.ui.children.length > 0 &&
    !state.ui.children.includes(state.transcriptContainer)
  );
}

export function normalizeFrameSize(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function hiddenNativeCursor(): RendererCursorState {
  return { x: 0, y: 0, visible: false };
}

/** Cheap string key that changes whenever the transcript selection range changes. */
export function transcriptSelectionCacheKey(state: TUIState): string {
  const range = state.transcriptSelection.rangeForRender();
  if (range === undefined) return '';
  return `${range.start.globalLine}:${range.start.col}-${range.end.globalLine}:${range.end.col}`;
}

function emptyNativeFrameChrome(): TUIStateNativeFrameChrome {
  return {
    header: [],
    activity: [],
    todo: [],
    jobs: [],
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

export function buildTUIStateNativeFrame(
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
     * Pure scroll paint: suppress tool-card live ticks (rebuildBody /
     * requestRender) so wheel storms cannot permanently busy-loop the UI.
     */
    readonly suppressLiveToolTicks?: boolean;
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
  // Pure-input fast path: reuse cached transcript lines when content and
  // viewport are unchanged. Callers must not pass reuse lines for pure-scroll —
  // the visible slice depends on viewport.start (see frame callback).
  const transcriptLines = options.reuseTranscriptLines ??
    nativeTranscriptRegionLines(state, stageWidth, layout.transcriptRows, {
      // Pure scroll must not run tool live ticks (rebuildBody/requestRender)
      // inside paint — that keeps the main thread busy forever under wheel storms.
      suppressLiveToolTicks: options.suppressLiveToolTicks === true,
    });
  const linesByRegion = {
    transcript: transcriptLines,
    header: chrome.header,
    activity: chrome.activity,
    todo: chrome.todo,
    jobs: chrome.jobs,
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
