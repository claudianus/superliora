import type { Component } from '#/tui/renderer';
import { isTranscriptMeasureMode, truncateToWidth } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  projectToolOutputViewport,
  resizeToolOutputViewport,
  scrollToolOutputViewport,
  syncToolOutputViewportContent,
  toolOutputViewportThumb,
  type ToolOutputViewportState,
} from '#/tui/utils/tool/tool-output-viewport';

export interface ToolOutputViewportComponentOptions {
  readonly child: Component;
  readonly getState: () => ToolOutputViewportState;
  readonly setState: (state: ToolOutputViewportState) => void;
  readonly expanded?: boolean;
  readonly initialFollowEnd?: boolean;
}

function statesEqual(left: ToolOutputViewportState, right: ToolOutputViewportState): boolean {
  return left.offset === right.offset &&
    left.height === right.height &&
    left.contentRows === right.contentRows;
}

/** Optional content-revision probe for nested truncated bodies. */
function childContentRevision(child: Component): number {
  const withRev = child as Component & { getContentRevision?: () => number };
  if (typeof withRev.getContentRevision === 'function') {
    return withRev.getContentRevision();
  }
  // Container of truncated bodies: OR revisions so deferred format busts cache.
  const children = (child as { children?: readonly Component[] }).children;
  if (!Array.isArray(children) || children.length === 0) return 0;
  let rev = 0;
  for (const c of children) {
    rev = (rev * 31 + childContentRevision(c)) | 0;
  }
  return rev;
}

function measureChildRows(child: Component, width: number): number {
  if (typeof child.measureContentRows === 'function') {
    return child.measureContentRows(width);
  }
  return child.render(width).length;
}

export class ToolOutputViewportComponent implements Component {
  private readonly child: Component;
  private readonly getState: () => ToolOutputViewportState;
  private readonly setState: (state: ToolOutputViewportState) => void;
  private readonly initialFollowEnd: boolean;
  private expanded: boolean;
  private hovered = false;
  private dragging = false;
  private lastRenderedRows = 0;
  private lastOverflow = false;
  // Child render cache: reuse when width + body revision match. Revision
  // advances when deferred highlight finishes so plain→pretty is not sticky.
  private cachedChildWidth = -1;
  private cachedChildRevision = Number.MIN_SAFE_INTEGER;
  private cachedChildLines: string[] = [];
  private cachedChildInvalid = true;

  constructor(options: ToolOutputViewportComponentOptions) {
    this.child = options.child;
    this.getState = options.getState;
    this.setState = options.setState;
    this.expanded = options.expanded ?? false;
    this.initialFollowEnd = options.initialFollowEnd ?? false;
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
  }

  setHovered(hovered: boolean): void {
    this.hovered = hovered;
  }

  setDragging(dragging: boolean): void {
    this.dragging = dragging;
  }

  scroll(deltaRows: number): boolean {
    const current = this.getState();
    // Pass expanded so max-offset uses the taller expanded window budget.
    const next = scrollToolOutputViewport(current, deltaRows, this.expanded);
    if (next === current) return false;
    this.setState(next);
    return true;
  }

  resize(requestedHeight: number, maxHeight: number): boolean {
    const current = this.getState();
    const next = resizeToolOutputViewport(current, requestedHeight, maxHeight);
    if (next === current) return false;
    this.setState(next);
    return true;
  }

  get height(): number {
    return this.getState().height;
  }

  get renderedRows(): number {
    return this.lastRenderedRows;
  }

  get overflowing(): boolean {
    return this.lastOverflow;
  }

  isGripRow(localRow: number): boolean {
    return this.lastOverflow && localRow === this.lastRenderedRows - 1;
  }

  invalidate(): void {
    this.child.invalidate?.();
    this.cachedChildInvalid = true;
    this.cachedChildRevision = Number.MIN_SAFE_INTEGER;
  }

  /**
   * Geometry without full child paint. Nested multi-k tool bodies return
   * measure placeholders that are not always iterable — never slice them here.
   */
  measureContentRows(width: number): number {
    const safeWidth = Math.max(1, Math.floor(width));
    const contentWidth = safeWidth > 1 ? safeWidth - 1 : safeWidth;
    const bodyRows = measureChildRows(this.child, contentWidth);
    const state = this.syncContentRows(bodyRows);
    const projection = projectToolOutputViewport(state, this.expanded);
    return projection.endRow - projection.startRow;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    // Always reserve a rail column when there may be overflow so expand/collapse
    // does not reflow content width (which would bust the child render cache).
    const contentWidth = safeWidth > 1 ? safeWidth - 1 : safeWidth;

    // Geometry probes: projected window height only — no child line arrays.
    if (isTranscriptMeasureMode()) {
      const rows = this.measureContentRows(safeWidth);
      return Array.from({ length: rows }, () => '');
    }

    let lines: string[];

    const revision = childContentRevision(this.child);
    if (
      this.cachedChildInvalid ||
      this.cachedChildWidth !== contentWidth ||
      this.cachedChildRevision !== revision
    ) {
      this.cachedChildLines = this.child.render(contentWidth);
      this.cachedChildWidth = contentWidth;
      this.cachedChildRevision = childContentRevision(this.child);
      this.cachedChildInvalid = false;
    }
    lines = this.cachedChildLines;

    const state = this.syncContentRows(lines.length);

    const projection = projectToolOutputViewport(state, this.expanded);
    const visible = lines.slice(projection.startRow, projection.endRow);
    this.lastRenderedRows = visible.length;
    this.lastOverflow = projection.overflow && safeWidth > 1;

    if (!this.lastOverflow) {
      return visible.map((line) => truncateToWidth(line, safeWidth, '', false));
    }

    const thumb = toolOutputViewportThumb(state, visible.length, this.expanded);
    const active = this.hovered || this.dragging;
    return visible.map((line, row) => {
      const content = truncateToWidth(line, contentWidth, '', true);
      const isGrip = row === visible.length - 1;
      const isThumb = thumb !== undefined && row >= thumb.startRow && row < thumb.endRow;
      const glyph = isGrip ? '╂' : isThumb ? '┃' : '│';
      const token = active && (isGrip || isThumb) ? 'primary' : 'textMuted';
      return content + currentTheme.fg(token, glyph);
    });
  }

  private syncContentRows(contentRows: number): ToolOutputViewportState {
    const current = this.getState();
    let next = syncToolOutputViewportContent(current, contentRows);
    if (this.initialFollowEnd && current.contentRows === 0 && next.contentRows > 0) {
      next = scrollToolOutputViewport(next, Number.MAX_SAFE_INTEGER);
    }
    if (!statesEqual(current, next)) this.setState(next);
    return next;
  }
}
