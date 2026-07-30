import type { Component } from '#/tui/renderer';
import { truncateToWidth } from '#/tui/renderer';
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
  // child render cache: 같은 width와 invalidate가 없으면 재사용
  private cachedChildWidth = -1;
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
    const next = scrollToolOutputViewport(current, deltaRows);
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
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    let contentWidth = safeWidth;
    let lines: string[];

    if (!this.expanded && safeWidth > 1) {
      // collapsed 상태: rail 공간을 위해 safeWidth - 1로 render하되 cache 활용
      const collapsedWidth = safeWidth - 1;
      if (this.cachedChildInvalid || this.cachedChildWidth !== collapsedWidth) {
        this.cachedChildLines = this.child.render(collapsedWidth);
        this.cachedChildWidth = collapsedWidth;
        this.cachedChildInvalid = false;
      }
      contentWidth = collapsedWidth;
      lines = this.cachedChildLines;
    } else {
      // expanded 상태: full width로 render하되 cache 활용
      if (this.cachedChildInvalid || this.cachedChildWidth !== safeWidth) {
        this.cachedChildLines = this.child.render(safeWidth);
        this.cachedChildWidth = safeWidth;
        this.cachedChildInvalid = false;
      }
      lines = this.cachedChildLines;
    }

    const state = this.syncContentRows(lines.length);

    const projection = projectToolOutputViewport(state, this.expanded);
    const visible = lines.slice(projection.startRow, projection.endRow);
    this.lastRenderedRows = visible.length;
    this.lastOverflow = projection.overflow && safeWidth > 1;

    if (!this.lastOverflow) {
      return visible.map((line) => truncateToWidth(line, safeWidth, '', false));
    }

    const thumb = toolOutputViewportThumb(state, visible.length);
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
