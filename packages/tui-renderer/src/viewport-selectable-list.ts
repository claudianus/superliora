import {
  clamp,
  mod,
  normalizeContentRows,
  normalizeScrollPadding,
  normalizeScrollTop,
  normalizeSelectedIndex,
  normalizeSignedRows,
  normalizeViewportRows,
} from './viewport-normalize';
import type {
  RendererSelectableListProjectOptions,
  RendererSelectableListProjection,
  RendererSelectableListViewportOptions,
  RendererSelectableListViewportSnapshot,
  RendererSelectableListViewportUpdate,
} from './viewport-types';

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
