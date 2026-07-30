import {
  clamp,
  formatCompactCount,
  normalizeContentRows,
  normalizeOffsetRows,
  normalizePositiveRows,
  normalizeSignedRows,
  normalizeViewportRows,
} from './normalize';
import type {
  RendererViewportHistoryStatus,
  RendererViewportHistoryStatusInput,
  RendererViewportHistoryStatusOptions,
  RendererViewportLineWindowOptions,
  RendererViewportLineWindowProjection,
  RendererViewportOptions,
  RendererViewportScrollAction,
  RendererViewportSnapshot,
  RendererViewportUpdate,
} from './types';

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

  jumpToLine(line: number): RendererViewportSnapshot {
    const clampedLine = Math.max(0, Math.floor(line));
    const offset = this.contentRows - this.viewportRows - clampedLine;
    return this.setOffset(offset);
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
