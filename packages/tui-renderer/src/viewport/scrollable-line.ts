import {
  clamp,
  normalizeContentRows,
  normalizePositiveRows,
  normalizeScrollTop,
  normalizeSignedRows,
  normalizeViewportRows,
} from './normalize';
import type {
  RendererScrollableLineViewportOptions,
  RendererScrollableLineViewportProjectOptions,
  RendererScrollableLineViewportSnapshot,
  RendererScrollableLineViewportUpdate,
  RendererScrollableLineWindowOptions,
  RendererScrollableLineWindowProjection,
  RendererStableScrollableLineViewportProjectOptions,
  RendererStableScrollableLineWindowProjection,
  RendererViewportScrollAction,
} from './types';

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
