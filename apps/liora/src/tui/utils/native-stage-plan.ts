import {
  measureRendererRegions,
  type RendererRegionLine,
  type RendererRegionLayout,
  type RendererRect,
} from '#/tui/renderer';

import {
  resolveStageLayout,
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
}

export interface PlanTUINativeStageOptions {
  readonly reuseChrome?: TUINativeStageChrome;
  /**
   * Shell-aware workspace center band (see `resolveStageLayout`'s
   * `workspaceCenter`). When set, the stage resolves inside this band instead
   * of assuming the terminal is unoccupied by workspace docks.
   */
  readonly workspaceCenter?: RendererRect;
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
 * Resolve the centered stage, then measure the vertical stack at the stage
 * width. Situational panels always render inside the stage column.
 */
export function planTUINativeStage(
  state: TUIState,
  terminalColumns: number,
  terminalRows: number,
  options: PlanTUINativeStageOptions,
): TUINativeStagePlan {
  const cols = Math.max(1, Math.floor(terminalColumns));
  const rows = Math.max(1, Math.floor(terminalRows));

  const stage = resolveStageLayout({
    width: cols,
    height: rows,
    workspaceCenter: options.workspaceCenter,
    userStageSize: state.userStageSize,
  });
  const contentWidth = stage.stage.width;
  const reuse = options.reuseChrome;

  const headerLines = reuse?.header ?? state.headerContainer.render(contentWidth);
  const footerLines = reuse?.footer ?? state.footerContainer.render(contentWidth);
  const activityLines = reuse?.activity ?? state.activityContainer.render(contentWidth);
  const todoLines = reuse?.todo ?? state.todoPanelContainer.render(contentWidth);
  const queueLines = reuse?.queue ?? state.queueContainer.render(contentWidth);
  const btwLines = reuse?.btw ?? state.btwPanelContainer.render(contentWidth);

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

  return {
    stage,
    layout,
    chrome: {
      header: headerLines,
      activity: activityLines,
      todo: todoLines,
      queue: queueLines,
      btw: btwLines,
      footer: footerLines,
    },
    editorLines,
    editorRows,
  };
}
