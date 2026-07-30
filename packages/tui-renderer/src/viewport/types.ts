export type RendererViewportScrollAction =
  | 'line-up'
  | 'line-down'
  | 'page-up'
  | 'page-down'
  | 'home'
  | 'end'
  | 'to-bottom';

export type RendererTranscriptScrollAction =
  | 'line-up'
  | 'line-down'
  | 'page-up'
  | 'page-down'
  | 'top'
  | 'bottom';

export interface RendererViewportOptions {
  readonly contentRows?: number;
  readonly viewportRows?: number;
  readonly offsetFromBottom?: number;
  readonly followOutput?: boolean;
}

export interface RendererViewportUpdate {
  readonly contentRows?: number;
  readonly viewportRows?: number;
}

export interface RendererViewportSnapshot {
  readonly contentRows: number;
  readonly viewportRows: number;
  readonly maxOffsetFromBottom: number;
  readonly offsetFromBottom: number;
  readonly followOutput: boolean;
  readonly start: number;
  readonly end: number;
  readonly hasOverflow: boolean;
  readonly hasNewContentBelow: boolean;
}

export interface RendererViewportHistoryStatusInput {
  readonly followOutput: boolean;
  readonly offsetFromBottom: number;
}

export interface RendererViewportHistoryStatusOptions {
  readonly historyLabel?: string;
  readonly rowsLabel?: string;
}

export interface RendererViewportHistoryStatus {
  readonly rowsBehind: number;
  readonly label: string;
}

export interface RendererViewportLineWindowOptions<TLine = string> {
  readonly lines: readonly TLine[];
  readonly viewportRows?: number;
  readonly offsetFromBottom?: number;
  readonly followOutput?: boolean;
  readonly fill?: TLine;
}

export interface RendererViewportLineWindowProjection<TLine = string>
  extends RendererViewportSnapshot {
  readonly lines: readonly TLine[];
}

export interface RendererTranscriptViewportOptions extends RendererViewportOptions {
  readonly lineScrollRows?: number;
}

export interface RendererScrollableLineWindowOptions<TLine = string> {
  readonly lines: readonly TLine[];
  readonly viewportRows: number;
  readonly scrollTop?: number;
  readonly followTail?: boolean;
  readonly fill?: TLine;
}

export interface RendererScrollableLineViewportOptions {
  readonly contentRows?: number;
  readonly viewportRows?: number;
  readonly scrollTop?: number;
  readonly followTail?: boolean;
}

export interface RendererScrollableLineViewportUpdate {
  readonly contentRows?: number;
  readonly viewportRows?: number;
}

export interface RendererScrollableLineViewportProjectOptions<TLine = string> {
  readonly lines: readonly TLine[];
  readonly viewportRows?: number;
  readonly fill?: TLine;
}

export interface RendererStableScrollableLineViewportProjectOptions<TLine = string> {
  readonly lines: readonly TLine[];
  readonly maxViewportRows?: number;
  readonly fill?: TLine;
}

export interface RendererScrollableLineViewportSnapshot {
  readonly contentRows: number;
  readonly viewportRows: number;
  readonly start: number;
  readonly end: number;
  readonly scrollTop: number;
  readonly maxScrollTop: number;
  readonly followTail: boolean;
  readonly hasOverflow: boolean;
  readonly lineFrom: number;
  readonly lineTo: number;
  readonly scrollPercent: number;
}

export interface RendererScrollableLineWindowProjection<TLine = string>
  extends RendererScrollableLineViewportSnapshot {
  readonly lines: readonly TLine[];
}

export interface RendererStableScrollableLineWindowProjection<TLine = string>
  extends RendererScrollableLineWindowProjection<TLine> {
  readonly stableViewportRows: number;
}

export interface RendererSelectableListViewportOptions {
  readonly itemCount?: number;
  readonly viewportRows?: number;
  readonly selectedIndex?: number;
  readonly scrollTop?: number;
  readonly scrollPadding?: number;
}

export interface RendererSelectableListViewportUpdate {
  readonly itemCount?: number;
  readonly viewportRows?: number;
  readonly selectedIndex?: number;
  readonly scrollPadding?: number;
}

export interface RendererSelectableListViewportSnapshot {
  readonly itemCount: number;
  readonly viewportRows: number;
  readonly selectedIndex: number;
  readonly scrollTop: number;
  readonly maxScrollTop: number;
  readonly start: number;
  readonly end: number;
  readonly hasSelection: boolean;
  readonly hasOverflow: boolean;
  readonly selectedViewportIndex: number | null;
  readonly lineFrom: number;
  readonly lineTo: number;
  readonly scrollPercent: number;
}

export interface RendererSelectableListProjectOptions<TItem> {
  readonly items: readonly TItem[];
  readonly viewportRows?: number;
  readonly scrollPadding?: number;
}

export interface RendererSelectableListProjectedItem<TItem> {
  readonly item: TItem;
  readonly index: number;
  readonly isSelected: boolean;
}

export interface RendererSelectableListProjection<TItem>
  extends RendererSelectableListViewportSnapshot {
  readonly items: readonly RendererSelectableListProjectedItem<TItem>[];
}
