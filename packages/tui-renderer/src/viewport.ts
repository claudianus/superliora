import type { NativeInputEvent } from './input-events';

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

export class RendererViewport {
  private contentRows: number;
  private viewportRows: number;
  private offsetFromBottom: number;
  private followOutput: boolean;

  constructor(options: RendererViewportOptions = {}) {
    const snapshot = createRendererViewportSnapshot(options);
    this.contentRows = snapshot.contentRows;
    this.viewportRows = snapshot.viewportRows;
    this.offsetFromBottom = snapshot.offsetFromBottom;
    this.followOutput = snapshot.followOutput;
  }

  update(update: RendererViewportUpdate): RendererViewportSnapshot {
    const preserveStart = !this.followOutput;
    const start = preserveStart ? this.snapshot().start : 0;
    if (update.contentRows !== undefined) this.contentRows = update.contentRows;
    if (update.viewportRows !== undefined) this.viewportRows = update.viewportRows;
    if (preserveStart) {
      const contentRows = normalizeContentRows(this.contentRows);
      const viewportRows = normalizeViewportRows(this.viewportRows);
      this.offsetFromBottom = Math.max(0, contentRows - viewportRows - start);
      this.followOutput = false;
    }
    return this.normalize();
  }

  scroll(action: RendererViewportScrollAction, amount?: number): RendererViewportSnapshot {
    const rows = normalizePositiveRows(amount ?? 1);
    const pageRows = amount === undefined
      ? normalizePositiveRows(this.viewportRows)
      : rows;
    if (action === 'line-up') return this.scrollBy(-rows);
    if (action === 'line-down') return this.scrollBy(rows);
    if (action === 'page-up') return this.scrollBy(-pageRows);
    if (action === 'page-down') return this.scrollBy(pageRows);
    if (action === 'home') return this.setOffset(Number.POSITIVE_INFINITY);
    return this.toBottom();
  }

  scrollBy(deltaRows: number): RendererViewportSnapshot {
    const rows = normalizeSignedRows(deltaRows);
    if (rows === 0) return this.snapshot();
    return this.setOffset(this.offsetFromBottom - rows);
  }

  toBottom(): RendererViewportSnapshot {
    this.offsetFromBottom = 0;
    this.followOutput = true;
    return this.normalize();
  }

  snapshot(): RendererViewportSnapshot {
    return createRendererViewportSnapshot({
      contentRows: this.contentRows,
      viewportRows: this.viewportRows,
      offsetFromBottom: this.offsetFromBottom,
      followOutput: this.followOutput,
    });
  }

  private setOffset(offsetFromBottom: number): RendererViewportSnapshot {
    if (offsetFromBottom <= 0) return this.toBottom();
    this.offsetFromBottom = offsetFromBottom;
    this.followOutput = false;
    return this.normalize();
  }

  private normalize(): RendererViewportSnapshot {
    const snapshot = this.snapshot();
    this.contentRows = snapshot.contentRows;
    this.viewportRows = snapshot.viewportRows;
    this.offsetFromBottom = snapshot.offsetFromBottom;
    this.followOutput = snapshot.followOutput;
    return snapshot;
  }
}

export class RendererTranscriptViewport {
  private readonly viewport: RendererViewport;
  private current: RendererViewportSnapshot;
  private readonly lineScrollRows: number;

  constructor(options: RendererTranscriptViewportOptions = {}) {
    this.viewport = new RendererViewport({
      contentRows: options.contentRows,
      viewportRows: options.viewportRows ?? Number.POSITIVE_INFINITY,
      offsetFromBottom: options.offsetFromBottom,
      followOutput: options.followOutput,
    });
    this.current = this.viewport.snapshot();
    this.lineScrollRows = normalizePositiveRows(options.lineScrollRows ?? 3);
  }

  get followOutput(): boolean {
    return this.current.followOutput;
  }

  get offsetFromBottom(): number {
    return this.current.offsetFromBottom;
  }

  get lastContentRows(): number {
    return this.current.contentRows;
  }

  get lastVisibleRows(): number {
    return this.current.viewportRows;
  }

  sync(contentRows: number, viewportRows: number): RendererViewportSnapshot {
    this.current = this.viewport.update({ contentRows, viewportRows });
    return this.current;
  }

  scroll(action: RendererTranscriptScrollAction): boolean {
    const previous = this.current;
    this.current = this.viewport.scroll(
      rendererTranscriptToViewportScrollAction(action),
      rendererTranscriptScrollRows(action, this.current.viewportRows, this.lineScrollRows),
    );
    return viewportPositionChanged(previous, this.current);
  }

  start(): number {
    return this.current.start;
  }

  snapshot(): RendererViewportSnapshot {
    return this.current;
  }
}

export function createRendererViewportSnapshot(options: RendererViewportOptions): RendererViewportSnapshot {
  const contentRows = normalizeContentRows(options.contentRows);
  const viewportRows = normalizeViewportRows(options.viewportRows);
  const maxOffsetFromBottom = Math.max(0, contentRows - viewportRows);
  const requestedOffset = normalizeOffsetRows(options.offsetFromBottom);
  const requestedFollow = options.followOutput ?? requestedOffset === 0;
  const offsetFromBottom = requestedFollow
    ? 0
    : clamp(requestedOffset, 0, maxOffsetFromBottom);
  const followOutput = requestedFollow;
  const start = Math.max(0, contentRows - viewportRows - offsetFromBottom);
  const end = Math.min(contentRows, start + viewportRows);

  return {
    contentRows,
    viewportRows,
    maxOffsetFromBottom,
    offsetFromBottom,
    followOutput,
    start,
    end,
    hasOverflow: maxOffsetFromBottom > 0,
    hasNewContentBelow: !followOutput && offsetFromBottom > 0,
  };
}

export function projectRendererViewportHistoryStatus(
  input: RendererViewportHistoryStatusInput | undefined,
  options: RendererViewportHistoryStatusOptions = {},
): RendererViewportHistoryStatus | undefined {
  if (input === undefined || input.followOutput) return undefined;
  const rowsBehind = normalizePositiveRows(input.offsetFromBottom);
  const historyLabel = options.historyLabel ?? 'history';
  const rowsLabel = options.rowsLabel ?? 'rows';
  return {
    rowsBehind,
    label: `${historyLabel} +${formatCompactCount(rowsBehind)} ${rowsLabel}`,
  };
}

export function projectRendererViewportLineWindow<TLine = string>(
  options: RendererViewportLineWindowOptions<TLine>,
): RendererViewportLineWindowProjection<TLine> {
  const snapshot = createRendererViewportSnapshot({
    contentRows: options.lines.length,
    viewportRows: options.viewportRows,
    offsetFromBottom: options.offsetFromBottom,
    followOutput: options.followOutput,
  });
  const lines = options.lines.slice(snapshot.start, snapshot.end);
  const fill = options.fill;
  if (fill !== undefined && Number.isFinite(snapshot.viewportRows)) {
    while (lines.length < snapshot.viewportRows) lines.push(fill);
  }
  return { ...snapshot, lines };
}

export class RendererScrollableLineViewport {
  private contentRows: number;
  private viewportRows: number;
  private scrollTop: number;
  private followTail: boolean;

  constructor(options: RendererScrollableLineViewportOptions = {}) {
    const snapshot = createRendererScrollableLineViewportSnapshot(options);
    this.contentRows = snapshot.contentRows;
    this.viewportRows = snapshot.viewportRows;
    this.scrollTop = snapshot.scrollTop;
    this.followTail = snapshot.followTail;
  }

  update(update: RendererScrollableLineViewportUpdate): RendererScrollableLineViewportSnapshot {
    const before = this.snapshot();
    if (update.contentRows !== undefined) this.contentRows = update.contentRows;
    if (update.viewportRows !== undefined) this.viewportRows = update.viewportRows;
    return this.applySnapshot(createRendererScrollableLineViewportSnapshot({
      contentRows: this.contentRows,
      viewportRows: this.viewportRows,
      scrollTop: this.scrollTop,
      followTail: before.followTail,
    }));
  }

  scroll(action: RendererViewportScrollAction, amount?: number): RendererScrollableLineViewportSnapshot {
    const rows = normalizePositiveRows(amount ?? 1);
    const pageRows = amount === undefined
      ? normalizePositiveRows(this.viewportRows)
      : rows;
    if (action === 'line-up') return this.scrollBy(-rows);
    if (action === 'line-down') return this.scrollBy(rows);
    if (action === 'page-up') return this.scrollBy(-pageRows);
    if (action === 'page-down') return this.scrollBy(pageRows);
    if (action === 'home') return this.scrollTo(0);
    return this.toBottom();
  }

  scrollBy(deltaRows: number): RendererScrollableLineViewportSnapshot {
    const rows = normalizeSignedRows(deltaRows);
    if (rows === 0) return this.snapshot();
    return this.scrollTo(this.scrollTop + rows);
  }

  scrollTo(scrollTop: number): RendererScrollableLineViewportSnapshot {
    return this.applySnapshot(createRendererScrollableLineViewportSnapshot({
      contentRows: this.contentRows,
      viewportRows: this.viewportRows,
      scrollTop,
      followTail: false,
    }));
  }

  toBottom(): RendererScrollableLineViewportSnapshot {
    return this.applySnapshot(createRendererScrollableLineViewportSnapshot({
      contentRows: this.contentRows,
      viewportRows: this.viewportRows,
      followTail: true,
    }));
  }

  project<TLine = string>(
    options: RendererScrollableLineViewportProjectOptions<TLine>,
  ): RendererScrollableLineWindowProjection<TLine> {
    const snapshot = this.update({
      contentRows: options.lines.length,
      viewportRows: options.viewportRows,
    });
    const projection = projectRendererScrollableLineWindow({
      lines: options.lines,
      viewportRows: snapshot.viewportRows,
      scrollTop: snapshot.scrollTop,
      followTail: snapshot.followTail,
      fill: options.fill,
    });
    this.applyProjection(projection);
    return projection;
  }

  snapshot(): RendererScrollableLineViewportSnapshot {
    return createRendererScrollableLineViewportSnapshot({
      contentRows: this.contentRows,
      viewportRows: this.viewportRows,
      scrollTop: this.scrollTop,
      followTail: this.followTail,
    });
  }

  private applyProjection(
    projection: RendererScrollableLineWindowProjection<unknown>,
  ): void {
    this.contentRows = projection.contentRows;
    this.viewportRows = projection.viewportRows;
    this.scrollTop = projection.scrollTop;
    this.followTail = projection.followTail;
  }

  private applySnapshot(
    snapshot: RendererScrollableLineViewportSnapshot,
  ): RendererScrollableLineViewportSnapshot {
    this.contentRows = snapshot.contentRows;
    this.viewportRows = snapshot.viewportRows;
    this.scrollTop = snapshot.scrollTop;
    this.followTail = snapshot.followTail;
    return snapshot;
  }
}

export class RendererStableScrollableLineViewport {
  private readonly viewport = new RendererScrollableLineViewport();
  private stableViewportRows = 0;

  project<TLine = string>(
    options: RendererStableScrollableLineViewportProjectOptions<TLine>,
  ): RendererStableScrollableLineWindowProjection<TLine> {
    const contentRows = options.lines.length;
    const targetUncapped = Math.max(this.stableViewportRows, contentRows);
    const maxViewportRows = options.maxViewportRows === undefined
      ? undefined
      : normalizeViewportRows(options.maxViewportRows);
    const viewportRows = maxViewportRows === undefined
      ? targetUncapped
      : Math.min(maxViewportRows, targetUncapped);
    this.stableViewportRows = Math.max(this.stableViewportRows, viewportRows);

    const projection = this.viewport.project({
      lines: options.lines,
      viewportRows,
      fill: options.fill,
    });
    return {
      ...projection,
      stableViewportRows: this.stableViewportRows,
    };
  }

  scroll(
    action: RendererViewportScrollAction,
    amount?: number,
  ): RendererScrollableLineViewportSnapshot {
    return this.viewport.scroll(action, amount);
  }

  toBottom(): RendererScrollableLineViewportSnapshot {
    return this.viewport.toBottom();
  }

  snapshot(): RendererScrollableLineViewportSnapshot {
    return this.viewport.snapshot();
  }
}

export function createRendererScrollableLineViewportSnapshot(
  options: RendererScrollableLineViewportOptions,
): RendererScrollableLineViewportSnapshot {
  const contentRows = normalizeContentRows(options.contentRows);
  const viewportRows = normalizeViewportRows(options.viewportRows);
  const maxScrollTop = viewportRows <= 0
    ? contentRows
    : Math.max(0, contentRows - viewportRows);
  const requestedScrollTop = normalizeScrollTop(options.scrollTop);
  const scrollTop = options.followTail === true
    ? maxScrollTop
    : clamp(requestedScrollTop, 0, maxScrollTop);
  const start = scrollTop;
  const end = viewportRows <= 0
    ? scrollTop
    : Math.min(contentRows, start + viewportRows);

  return {
    contentRows,
    viewportRows,
    start,
    end,
    scrollTop,
    maxScrollTop,
    followTail: scrollTop === maxScrollTop,
    hasOverflow: maxScrollTop > 0,
    lineFrom: contentRows === 0 || viewportRows <= 0 ? 0 : start + 1,
    lineTo: contentRows === 0 || viewportRows <= 0 ? 0 : end,
    scrollPercent: maxScrollTop === 0
      ? 100
      : Math.round((scrollTop / maxScrollTop) * 100),
  };
}

export class RendererSelectableListViewport {
  private itemCount: number;
  private viewportRows: number;
  private selectedIndex: number;
  private scrollTop: number;
  private scrollPadding: number;

  constructor(options: RendererSelectableListViewportOptions = {}) {
    const snapshot = createRendererSelectableListViewportSnapshot(options);
    this.itemCount = snapshot.itemCount;
    this.viewportRows = snapshot.viewportRows;
    this.selectedIndex = snapshot.selectedIndex;
    this.scrollTop = snapshot.scrollTop;
    this.scrollPadding = normalizeScrollPadding(options.scrollPadding, snapshot.viewportRows);
  }

  update(update: RendererSelectableListViewportUpdate): RendererSelectableListViewportSnapshot {
    if (update.itemCount !== undefined) this.itemCount = update.itemCount;
    if (update.viewportRows !== undefined) this.viewportRows = update.viewportRows;
    if (update.selectedIndex !== undefined) this.selectedIndex = update.selectedIndex;
    if (update.scrollPadding !== undefined) this.scrollPadding = update.scrollPadding;
    return this.normalize();
  }

  select(index: number): RendererSelectableListViewportSnapshot {
    this.selectedIndex = index;
    return this.normalize();
  }

  moveSelection(deltaRows: number, wrap = false): RendererSelectableListViewportSnapshot {
    const rows = normalizeSignedRows(deltaRows);
    const snapshot = this.snapshot();
    if (rows === 0 || !snapshot.hasSelection) return snapshot;
    if (wrap) {
      return this.select(mod(snapshot.selectedIndex + rows, snapshot.itemCount));
    }
    return this.select(snapshot.selectedIndex + rows);
  }

  selectFirst(): RendererSelectableListViewportSnapshot {
    return this.select(0);
  }

  selectLast(): RendererSelectableListViewportSnapshot {
    return this.select(Number.POSITIVE_INFINITY);
  }

  project<TItem>(
    options: RendererSelectableListProjectOptions<TItem>,
  ): RendererSelectableListProjection<TItem> {
    const snapshot = this.update({
      itemCount: options.items.length,
      viewportRows: options.viewportRows,
      scrollPadding: options.scrollPadding,
    });
    const items = options.items
      .slice(snapshot.start, snapshot.end)
      .map((item, offset) => {
        const index = snapshot.start + offset;
        return {
          item,
          index,
          isSelected: snapshot.hasSelection && index === snapshot.selectedIndex,
        };
      });
    return { ...snapshot, items };
  }

  snapshot(): RendererSelectableListViewportSnapshot {
    return createRendererSelectableListViewportSnapshot({
      itemCount: this.itemCount,
      viewportRows: this.viewportRows,
      selectedIndex: this.selectedIndex,
      scrollTop: this.scrollTop,
      scrollPadding: this.scrollPadding,
    });
  }

  private normalize(): RendererSelectableListViewportSnapshot {
    const snapshot = this.snapshot();
    this.itemCount = snapshot.itemCount;
    this.viewportRows = snapshot.viewportRows;
    this.selectedIndex = snapshot.selectedIndex;
    this.scrollTop = snapshot.scrollTop;
    this.scrollPadding = normalizeScrollPadding(this.scrollPadding, snapshot.viewportRows);
    return snapshot;
  }
}

export function createRendererSelectableListViewportSnapshot(
  options: RendererSelectableListViewportOptions,
): RendererSelectableListViewportSnapshot {
  const itemCount = normalizeContentRows(options.itemCount);
  const viewportRows = normalizeViewportRows(options.viewportRows);
  const selectedIndex = normalizeSelectedIndex(options.selectedIndex, itemCount);
  const maxScrollTop = viewportRows <= 0 ? 0 : Math.max(0, itemCount - viewportRows);
  const scrollPadding = normalizeScrollPadding(options.scrollPadding, viewportRows);
  let scrollTop = clamp(normalizeScrollTop(options.scrollTop), 0, maxScrollTop);
  const hasSelection = itemCount > 0;

  if (hasSelection && viewportRows > 0) {
    const paddedTop = scrollTop + scrollPadding;
    const paddedBottom = scrollTop + viewportRows - 1 - scrollPadding;
    if (selectedIndex < paddedTop) {
      scrollTop = clamp(selectedIndex - scrollPadding, 0, maxScrollTop);
    } else if (selectedIndex > paddedBottom) {
      scrollTop = clamp(selectedIndex - viewportRows + 1 + scrollPadding, 0, maxScrollTop);
    }
  }

  const start = viewportRows <= 0 ? 0 : scrollTop;
  const end = viewportRows <= 0 ? 0 : Math.min(itemCount, start + viewportRows);
  const selectedViewportIndex =
    hasSelection && selectedIndex >= start && selectedIndex < end
      ? selectedIndex - start
      : null;

  return {
    itemCount,
    viewportRows,
    selectedIndex,
    scrollTop,
    maxScrollTop,
    start,
    end,
    hasSelection,
    hasOverflow: maxScrollTop > 0,
    selectedViewportIndex,
    lineFrom: itemCount === 0 || viewportRows <= 0 ? 0 : start + 1,
    lineTo: itemCount === 0 || viewportRows <= 0 ? 0 : end,
    scrollPercent: maxScrollTop === 0
      ? 100
      : Math.round((scrollTop / maxScrollTop) * 100),
  };
}

export function projectRendererScrollableLineWindow<TLine = string>(
  options: RendererScrollableLineWindowOptions<TLine>,
): RendererScrollableLineWindowProjection<TLine> {
  const contentRows = options.lines.length;
  const snapshot = createRendererScrollableLineViewportSnapshot({
    contentRows,
    viewportRows: options.viewportRows,
    scrollTop: options.scrollTop,
    followTail: options.followTail,
  });
  const { viewportRows } = snapshot;
  if (viewportRows <= 0) {
    return {
      lines: [],
      ...snapshot,
    };
  }

  if (snapshot.hasOverflow) {
    const visible = options.lines.slice(snapshot.start, snapshot.end);
    return {
      lines: visible,
      ...snapshot,
    };
  }

  const padded = [...options.lines];
  if (options.fill !== undefined) {
    while (padded.length < viewportRows) padded.push(options.fill);
  }
  return {
    lines: padded,
    ...snapshot,
  };
}

export function rendererViewportActionForInput(
  event: NativeInputEvent,
): RendererViewportScrollAction | undefined {
  if (event.type === 'mouse' && event.action === 'wheel') {
    if (event.button === 'wheel-up') return 'line-up';
    if (event.button === 'wheel-down') return 'line-down';
  }

  if (event.type !== 'key') return undefined;
  if (event.key === 'pageup') return 'page-up';
  if (event.key === 'pagedown') return 'page-down';
  if (event.key === 'home') return 'home';
  if (event.key === 'end') return 'end';
  return undefined;
}

function normalizeContentRows(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeViewportRows(value: number | undefined): number {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeOffsetRows(value: number | undefined): number {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeScrollTop(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeSelectedIndex(value: number | undefined, itemCount: number): number {
  if (itemCount <= 0) return 0;
  if (value === Number.POSITIVE_INFINITY) return itemCount - 1;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return clamp(Math.floor(value), 0, itemCount - 1);
}

function normalizeScrollPadding(value: number | undefined, viewportRows: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  if (viewportRows <= 1) return 0;
  return clamp(Math.floor(value), 0, Math.floor((viewportRows - 1) / 2));
}

function normalizePositiveRows(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value));
}

function rendererTranscriptToViewportScrollAction(
  action: RendererTranscriptScrollAction,
): RendererViewportScrollAction {
  if (action === 'top') return 'home';
  if (action === 'bottom') return 'to-bottom';
  return action;
}

function rendererTranscriptScrollRows(
  action: RendererTranscriptScrollAction,
  viewportRows: number,
  lineScrollRows: number,
): number {
  if (action === 'top' || action === 'bottom') return 1;
  if (!Number.isFinite(viewportRows)) return 1;
  const pageRows = Math.max(1, Math.floor(viewportRows) - 1);
  return action === 'line-up' || action === 'line-down'
    ? Math.min(lineScrollRows, pageRows)
    : pageRows;
}

function viewportPositionChanged(
  previous: RendererViewportSnapshot,
  next: RendererViewportSnapshot,
): boolean {
  return previous.followOutput !== next.followOutput ||
    previous.offsetFromBottom !== next.offsetFromBottom;
}

function formatCompactCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function normalizeSignedRows(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.trunc(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mod(value: number, modulus: number): number {
  if (modulus <= 0) return 0;
  return ((value % modulus) + modulus) % modulus;
}
