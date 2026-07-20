import {
  measureRendererRegions,
  type RendererRegionLine,
  type RendererRegionLayout,
  type RendererRect,
} from '#/tui/renderer';

import {
  resolveStageLayout,
  STAGE_MAX_WIDTH,
  type StageLayout,
} from '../controllers/stage-layout';
import type { TUIState } from '../tui-state';

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

/**
 * Probe whether situational panels have content, resolve the centered stage
 * (and optional rail), then measure the vertical stack at the stage width.
 */
export function planTUINativeStage(
  state: TUIState,
  terminalColumns: number,
  terminalRows: number,
  options: PlanTUINativeStageOptions,
): TUINativeStagePlan {
  const cols = Math.max(1, Math.floor(terminalColumns));
  const rows = Math.max(1, Math.floor(terminalRows));
  const probeWidth = Math.min(cols, STAGE_MAX_WIDTH);

  let hasRailContent: boolean;
  if (options.cachedHasRailContent !== undefined) {
    // Pure-input fast path: panel content has not changed, skip the four
    // container renders that only exist to probe for rail content.
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
  });
  const contentWidth = stage.stage.width;
  const reuse = options.reuseChrome;

  const headerLines = reuse?.header ?? state.headerContainer.render(contentWidth);
  const footerLines = reuse?.footer ?? state.footerContainer.render(contentWidth);

  let activityLines: readonly RendererRegionLine[];
  let todoLines: readonly RendererRegionLine[];
  let queueLines: readonly RendererRegionLine[];
  let btwLines: readonly RendererRegionLine[];
  let railLines: readonly RendererRegionLine[] = [];

  if (stage.mode === 'rail' && stage.rail !== undefined) {
    const railWidth = stage.rail.width;
    // Rail width differs from the stage — always re-render panels for the rail.
    const railTodo = state.todoPanelContainer.render(railWidth);
    const railActivity = state.activityContainer.render(railWidth);
    const railQueue = state.queueContainer.render(railWidth);
    const railBtw = state.btwPanelContainer.render(railWidth);
    // Blank divider rows between non-empty sections keep the rail readable;
    // empty sections are omitted so the top-first slice never starts or ends
    // with a dangling separator.
    const railSections = [railTodo, railActivity, railQueue, railBtw].filter(
      (section) => section.length > 0,
    );
    railLines = railSections.flatMap((section, index) =>
      index === 0 ? section : ['', ...section],
    );
    // Stack does not reserve vertical space for railed panels.
    activityLines = [];
    todoLines = [];
    queueLines = [];
    btwLines = [];
  } else {
    activityLines = reuse?.activity ?? state.activityContainer.render(contentWidth);
    todoLines = reuse?.todo ?? state.todoPanelContainer.render(contentWidth);
    queueLines = reuse?.queue ?? state.queueContainer.render(contentWidth);
    btwLines = reuse?.btw ?? state.btwPanelContainer.render(contentWidth);
  }

  const editorLines = options.resolveEditorFallbackLines(contentWidth);
  const fixedRowsWithoutEditor =
    headerLines.length +
    activityLines.length +
    todoLines.length +
    queueLines.length +
    btwLines.length +
    footerLines.length;
  const editorRows = options.resolveEditorRows({
    editorLineCount: editorLines.length,
    fixedRowsWithoutEditor,
    contentWidth,
    contentHeight: stage.stage.height,
  });

  const layout = measureRendererRegions({
    terminalRows: rows,
    terminalColumns: cols,
    contentX: stage.stage.x,
    contentWidth: stage.stage.width,
    contentY: stage.stage.y,
    contentHeight: stage.stage.height,
    heights: {
      header: headerLines.length,
      activity: activityLines.length,
      todo: todoLines.length,
      queue: queueLines.length,
      btw: btwLines.length,
      editor: editorRows,
      footer: footerLines.length,
    },
  });

  const transcriptRegion = layout.regions.find((region) => region.id === 'transcript');
  const railRect =
    stage.mode === 'rail' && stage.rail !== undefined && transcriptRegion?.rect !== undefined
      ? {
          x: stage.rail.x,
          y: transcriptRegion.rect.y,
          width: stage.rail.width,
          height: transcriptRegion.rect.height,
        }
      : undefined;

  return {
    stage,
    layout,
    chrome: {
      header: headerLines,
      activity: stage.mode === 'rail' ? [] : activityLines,
      todo: stage.mode === 'rail' ? [] : todoLines,
      queue: stage.mode === 'rail' ? [] : queueLines,
      btw: stage.mode === 'rail' ? [] : btwLines,
      footer: footerLines,
    },
    editorLines,
    editorRows,
    railLines: railRect === undefined ? [] : railLines.slice(0, railRect.height),
    railRect,
    hasRailContent,
  };
}
