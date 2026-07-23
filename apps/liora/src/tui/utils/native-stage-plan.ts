import {
  measureRendererRegions,
  type RendererRegionLine,
  type RendererRegionLayout,
  type RendererRect,
} from '#/tui/renderer';

import {
  resolveStageLayout,
  STAGE_MAX_WIDTH,
  STAGE_RAIL_GAP,
  type StageLayout,
} from '../controllers/stage-layout';
import type { TUIState } from '../tui-state';
import {
  bentoFrameContentWidth,
  frameBentoRegionLines,
} from './bento-region-frame';

export interface TUINativeStageChrome {
  readonly header: readonly RendererRegionLine[];
  readonly activity: readonly RendererRegionLine[];
  readonly todo: readonly RendererRegionLine[];
  readonly queue: readonly RendererRegionLine[];
  readonly btw: readonly RendererRegionLine[];
  readonly footer: readonly RendererRegionLine[];
}

export interface TUINativeStagePlan {
  readonly stage: StageLayout;
  readonly layout: RendererRegionLayout;
  readonly chrome: TUINativeStageChrome;
  readonly editorLines: readonly RendererRegionLine[];
  readonly editorRows: number;
  /** Panel lines for the situational rail (empty when mode is stack). */
  readonly railLines: readonly RendererRegionLine[];
  readonly railRect?: RendererRect;
  /** Whether any situational panel had content (drives rail vs stack probe). */
  readonly hasRailContent: boolean;
}

export interface PlanTUINativeStageOptions {
  readonly reuseChrome?: TUINativeStageChrome;
  /**
   * When provided, skip the four panel probe renders (todo / activity / queue /
   * btw) and use this value directly. Pure-input frames reuse chrome, so panel
   * content has not changed and the probes are pure overhead.
   */
  readonly cachedHasRailContent?: boolean;
  /**
   * Shell-aware workspace center band (see `resolveStageLayout`'s
   * `workspaceCenter`). When set, the stage resolves inside this band instead
   * of assuming the terminal is unoccupied by workspace docks.
   */
  readonly workspaceCenter?: RendererRect;
  /**
   * Frame header / footer (and situational rail) as bento tiles.
   * Transcript stays frameless (hero reading surface). Editor keeps its own
   * surface chrome. Default true.
   */
  readonly bentoTiles?: boolean;
  /**
   * Editor fallback lines / row budget resolved at the final stage width so
   * wrap math matches the painted editor region.
   */
  readonly resolveEditorFallbackLines: (contentWidth: number) => readonly RendererRegionLine[];
  readonly resolveEditorRows: (input: {
    readonly editorLineCount: number;
    readonly fixedRowsWithoutEditor: number;
    readonly contentWidth: number;
    readonly contentHeight: number;
  }) => number;
}

function lineToPlainText(line: RendererRegionLine): string {
  if (typeof line === 'string') return line;
  // Cell arrays: join characters only (framing is ANSI-string based).
  return line.map((cell) => cell.char).join('');
}

function maybeFrame(
  enabled: boolean,
  lines: readonly RendererRegionLine[],
  outerWidth: number,
  title: string | undefined,
  kind: 'chrome' | 'input' | 'rail' | 'panel',
  minHeight?: number,
): readonly RendererRegionLine[] {
  if (!enabled || lines.length === 0) return lines;
  return frameBentoRegionLines({
    width: outerWidth,
    title,
    kind,
    lines: lines.map(lineToPlainText),
    minHeight,
  });
}

/**
 * Probe whether situational panels have content, resolve the stage (full-bleed
 * bento or capped reading column) and optional rail, then measure the vertical
 * stack at the stage width.
 */
export function planTUINativeStage(
  state: TUIState,
  terminalColumns: number,
  terminalRows: number,
  options: PlanTUINativeStageOptions,
): TUINativeStagePlan {
  const cols = Math.max(1, Math.floor(terminalColumns));
  const rows = Math.max(1, Math.floor(terminalRows));
  const bentoTiles = options.bentoTiles !== false;
  // Narrow / short terminals: drop inter-tile gaps; skip chrome frames when
  // the band is too short so transcript keeps reading room.
  // Situational panels already draw their own chrome (or live in the rail
  // tile) — never wrap them again.
  const spacious = cols >= 100;
  const tallEnough = rows >= 28;
  const frameChrome = bentoTiles && tallEnough;
  // Bento tiles already frame themselves — inter-region gaps become empty
  // gutters (especially editor→Status). Keep the stack flush.
  const regionGap = 0;
  const probeWidth = Math.min(cols, STAGE_MAX_WIDTH);

  let hasRailContent: boolean;
  if (options.cachedHasRailContent !== undefined) {
    hasRailContent = options.cachedHasRailContent;
  } else {
    const probeTodo = state.todoPanelContainer.render(probeWidth);
    const probeActivity = state.activityContainer.render(probeWidth);
    const probeQueue = state.queueContainer.render(probeWidth);
    const probeBtw = state.btwPanelContainer.render(probeWidth);
    hasRailContent =
      probeTodo.length > 0 ||
      probeActivity.length > 0 ||
      probeQueue.length > 0 ||
      probeBtw.length > 0;
  }

  const stage = resolveStageLayout({
    width: cols,
    height: rows,
    hasRailContent,
    workspaceCenter: options.workspaceCenter,
    fullBleed: bentoTiles,
  });
  const contentWidth = stage.stage.width;
  const bundleWidth =
    stage.mode === 'rail' && stage.rail !== undefined
      ? stage.stage.width + STAGE_RAIL_GAP + stage.rail.width
      : contentWidth;
  // Header/footer span the full stage+rail bundle in rail mode.
  const chromeWidth = bundleWidth;
  // Header/footer are open-sided chrome bands — full width, no │ overhead.
  const chromeInner = bentoTiles ? bentoFrameContentWidth(chromeWidth, 'chrome') : chromeWidth;
  // Stage-column content (editor + stack panels) uses the full stage width —
  // only header/footer/rail shrink for their bento chrome.
  const columnWidth = contentWidth;
  const reuse = options.reuseChrome;

  // When chrome is reused from a prior frame it is already framed — do not
  // wrap again (that produced nested ╭│╭ borders).
  const rawHeader =
    reuse?.header ?? state.headerContainer.render(chromeInner);
  const rawFooter =
    reuse?.footer ?? state.footerContainer.render(chromeInner);

  let rawActivity: readonly RendererRegionLine[];
  let rawTodo: readonly RendererRegionLine[];
  let rawQueue: readonly RendererRegionLine[];
  let rawBtw: readonly RendererRegionLine[];
  let rawRail: readonly RendererRegionLine[] = [];

  if (stage.mode === 'rail' && stage.rail !== undefined) {
    const railOuter = stage.rail.width;
    const railInner = bentoTiles ? bentoFrameContentWidth(railOuter) : railOuter;
    const railTodo = state.todoPanelContainer.render(railInner);
    const railActivity = state.activityContainer.render(railInner);
    const railQueue = state.queueContainer.render(railInner);
    const railBtw = state.btwPanelContainer.render(railInner);
    const railSections = [railTodo, railActivity, railQueue, railBtw].filter(
      (section) => section.length > 0,
    );
    rawRail = railSections.flatMap((section, index) =>
      index === 0 ? section : ['', ...section],
    );
    rawActivity = [];
    rawTodo = [];
    rawQueue = [];
    rawBtw = [];
  } else if (reuse) {
    rawActivity = reuse.activity;
    rawTodo = reuse.todo;
    rawQueue = reuse.queue;
    rawBtw = reuse.btw;
  } else {
    rawActivity = state.activityContainer.render(columnWidth);
    rawTodo = state.todoPanelContainer.render(columnWidth);
    rawQueue = state.queueContainer.render(columnWidth);
    rawBtw = state.btwPanelContainer.render(columnWidth);
  }

  const rawEditor = options.resolveEditorFallbackLines(columnWidth);

  const framedHeader = reuse
    ? rawHeader
    : maybeFrame(frameChrome, rawHeader, chromeWidth, undefined, 'chrome');
  const framedFooter = reuse
    ? rawFooter
    : maybeFrame(frameChrome, rawFooter, chromeWidth, spacious ? 'Status' : undefined, 'chrome');
  // Situational panels keep their own internal chrome (or the rail tile).
  const framedActivity = rawActivity;
  const framedTodo = rawTodo;
  const framedQueue = rawQueue;
  const framedBtw = rawBtw;
  const fixedRowsWithoutEditor =
    framedHeader.length +
    framedActivity.length +
    framedTodo.length +
    framedQueue.length +
    framedBtw.length +
    framedFooter.length;
  // Editor paints its own rounded chrome via renderRendererEditorSurface —
  // do not wrap again (that ate transcript rows for an invisible outer frame).
  const editorInnerRows = options.resolveEditorRows({
    editorLineCount: rawEditor.length,
    fixedRowsWithoutEditor,
    contentWidth: columnWidth,
    contentHeight: stage.stage.height,
  });
  const editorInnerLines = rawEditor.slice(0, Math.max(0, editorInnerRows));
  const framedEditor = editorInnerLines;
  const editorRows = framedEditor.length;

  const layout = measureRendererRegions({
    terminalRows: rows,
    terminalColumns: cols,
    contentX: stage.stage.x,
    contentWidth: stage.stage.width,
    contentY: stage.stage.y,
    contentHeight: stage.stage.height,
    heights: {
      header: framedHeader.length,
      activity: framedActivity.length,
      todo: framedTodo.length,
      queue: framedQueue.length,
      btw: framedBtw.length,
      editor: editorRows,
      footer: framedFooter.length,
    },
    regionGap,
  });

  // Expand header/footer to the full stage+rail bundle so the top/bottom
  // chrome reads as one continuous bento band above/below the split.
  const regions =
    bundleWidth > contentWidth
      ? layout.regions.map((region) => {
          if (region.id !== 'header' && region.id !== 'footer') return region;
          if (region.rect === undefined) return region;
          return {
            ...region,
            rect: { ...region.rect, width: bundleWidth },
          };
        })
      : layout.regions;
  const layoutWithChrome = { ...layout, regions };

  const transcriptRegion = layoutWithChrome.regions.find((region) => region.id === 'transcript');
  const railOuterWidth = stage.rail?.width ?? 0;
  const railRect =
    stage.mode === 'rail' && stage.rail !== undefined && transcriptRegion?.rect !== undefined
      ? {
          x: stage.rail.x,
          y: transcriptRegion.rect.y,
          width: stage.rail.width,
          // Sit beside the transcript only. Stretching through the editor
          // left a tall empty Context body when todo/activity were short.
          height: Math.max(1, transcriptRegion.rect.height),
        }
      : undefined;
  const framedRail =
    stage.mode === 'rail' && stage.rail !== undefined
      ? maybeFrame(
          frameChrome,
          rawRail,
          railOuterWidth,
          'Context',
          'rail',
          railRect?.height,
        )
      : [];

  return {
    stage,
    layout: layoutWithChrome,
    chrome: {
      header: framedHeader,
      activity: stage.mode === 'rail' ? [] : framedActivity,
      todo: stage.mode === 'rail' ? [] : framedTodo,
      queue: stage.mode === 'rail' ? [] : framedQueue,
      btw: stage.mode === 'rail' ? [] : framedBtw,
      footer: framedFooter,
    },
    editorLines: framedEditor,
    editorRows,
    railLines: railRect === undefined ? [] : framedRail.slice(0, railRect.height),
    railRect,
    hasRailContent,
  };
}
