/**
 * TableRenderer — sortable, filterable data tables for structured display.
 *
 * Provides a versatile table component for the TUI:
 * - Column definitions with type-aware formatting (text, number, time, status)
 * - Multi-column sorting (click header or keyboard shortcut)
 * - Row selection with keyboard navigation
 * - Column resizing based on content and available width
 * - Text truncation with ellipsis for overflow
 * - Zebra striping and hover highlighting
 * - Footer with summary statistics
 * - Empty state rendering
 * - Pagination for large datasets
 *
 * Use cases:
 * - Agent list (name, status, progress, tokens, cost, time)
 * - File list (path, size, modified, status)
 * - Session history (name, created, messages, tokens)
 * - Cost breakdown (model, requests, input/output tokens, cost)
 */

import { noteSelectionFeedback } from './feedback-vfx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColumnType = 'text' | 'number' | 'time' | 'status' | 'progress' | 'cost';

export type SortDirection = 'asc' | 'desc' | null;

export interface ColumnDef {
  readonly id: string;
  readonly header: string;
  readonly type: ColumnType;
  /** Minimum width in characters. */
  readonly minWidth: number;
  /** Maximum width (0 = unlimited). */
  readonly maxWidth: number;
  /** Flex grow factor for width distribution. */
  readonly flex: number;
  /** Whether this column is sortable. */
  readonly sortable: boolean;
  /** Alignment within the cell. */
  readonly align: 'left' | 'right' | 'center';
  /** Custom formatter (overrides type-based formatting). */
  readonly format?: (value: unknown) => string;
}

export interface SortState {
  readonly columnId: string;
  readonly direction: 'asc' | 'desc';
}

export interface TableRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
  /** Whether to show zebra striping. */
  readonly zebra?: boolean;
  /** Whether to show the header row. */
  readonly showHeader?: boolean;
  /** Whether to show the footer. */
  readonly showFooter?: boolean;
}

// ---------------------------------------------------------------------------
// TableRenderer
// ---------------------------------------------------------------------------

export class TableRenderer<T extends Record<string, unknown>> {
  private columns: ColumnDef[];
  private rows: T[] = [];
  private sortState: SortState | null = null;
  private selectedIndex = -1;
  private scrollOffset = 0;
  private filterFn: ((row: T) => boolean) | null = null;

  constructor(columns: ColumnDef[]) {
    this.columns = columns;
  }

  // ─── Data Management ──────────────────────────────────────────────

  setRows(rows: T[]): void {
    this.rows = rows;
    this.clampSelection();
  }

  getRows(): T[] {
    return this.getProcessedRows();
  }

  setFilter(fn: ((row: T) => boolean) | null): void {
    this.filterFn = fn;
    this.selectedIndex = -1;
    this.scrollOffset = 0;
  }

  // ─── Sorting ──────────────────────────────────────────────────────

  setSort(columnId: string, direction: 'asc' | 'desc'): void {
    this.sortState = { columnId, direction };
  }

  toggleSort(columnId: string): void {
    if (this.sortState?.columnId === columnId) {
      if (this.sortState.direction === 'asc') {
        this.sortState = { columnId, direction: 'desc' };
      } else {
        this.sortState = null; // Clear sort
      }
    } else {
      this.sortState = { columnId, direction: 'asc' };
    }
  }

  clearSort(): void {
    this.sortState = null;
  }

  getSortState(): SortState | null {
    return this.sortState;
  }

  // ─── Selection ────────────────────────────────────────────────────

  setSelectedIndex(index: number): void {
    const processed = this.getProcessedRows();
    const next = Math.max(-1, Math.min(index, processed.length - 1));
    if (next !== this.selectedIndex) {
      this.selectedIndex = next;
      noteSelectionFeedback();
    }
  }

  moveUp(): void {
    this.setSelectedIndex(this.selectedIndex - 1);
  }

  moveDown(): void {
    this.setSelectedIndex(this.selectedIndex + 1);
  }

  pageUp(pageSize: number): void {
    this.setSelectedIndex(this.selectedIndex - pageSize);
  }

  pageDown(pageSize: number): void {
    this.setSelectedIndex(this.selectedIndex + pageSize);
  }

  getSelectedRow(): T | null {
    const processed = this.getProcessedRows();
    return processed[this.selectedIndex] ?? null;
  }

  get selectedIndexValue(): number {
    return this.selectedIndex;
  }

  // ─── Processing Pipeline ──────────────────────────────────────────

  private getProcessedRows(): T[] {
    let result = [...this.rows];

    // Filter
    if (this.filterFn) {
      result = result.filter(this.filterFn);
    }

    // Sort
    if (this.sortState) {
      const { columnId, direction } = this.sortState;
      const col = this.columns.find((c) => c.id === columnId);
      if (col) {
        result.sort((a, b) => {
          const aVal = a[columnId];
          const bVal = b[columnId];
          const cmp = compareValues(aVal, bVal, col.type);
          return direction === 'asc' ? cmp : -cmp;
        });
      }
    }

    return result;
  }

  private clampSelection(): void {
    const len = this.getProcessedRows().length;
    if (this.selectedIndex >= len) {
      this.selectedIndex = len - 1;
    }
  }

  // ─── Column Width Calculation ─────────────────────────────────────

  private computeColumnWidths(totalWidth: number): number[] {
    const gap = 1; // Space between columns
    const totalGaps = (this.columns.length - 1) * gap;
    const available = totalWidth - totalGaps - 2; // 2 for row cursor

    // Phase 1: Allocate minimum widths
    const widths = this.columns.map((c) => c.minWidth);
    let remaining = available - widths.reduce((a, b) => a + b, 0);

    // Phase 2: Distribute remaining by flex
    const totalFlex = this.columns.reduce((a, c) => a + c.flex, 0);
    if (totalFlex > 0 && remaining > 0) {
      for (let i = 0; i < this.columns.length; i++) {
        const col = this.columns[i]!;
        if (col.flex > 0) {
          const extra = Math.floor((remaining * col.flex) / totalFlex);
          const maxExtra = col.maxWidth > 0 ? col.maxWidth - widths[i]! : Infinity;
          widths[i] = widths[i]! + Math.min(extra, maxExtra);
        }
      }
    }

    return widths;
  }

  // ─── Rendering ────────────────────────────────────────────────────

  render(options: TableRenderOptions): string[] {
    const { width, height, fg, boldFg, dimFg, bg, zebra = true, showHeader = true, showFooter = true } = options;
    const lines: string[] = [];
    const processed = this.getProcessedRows();
    const colWidths = this.computeColumnWidths(width);

    // Header
    if (showHeader) {
      lines.push(this.renderHeader(colWidths, fg, boldFg, dimFg));
      lines.push(dimFg('textMuted', '─'.repeat(Math.min(width - 2, colWidths.reduce((a, b) => a + b + 1, 0)))));
    }

    // Body
    const headerLines = showHeader ? 2 : 0;
    const footerLines = showFooter ? 1 : 0;
    const bodyHeight = height - headerLines - footerLines;

    // Adjust scroll
    this.adjustScroll(bodyHeight, processed.length);

    for (let i = this.scrollOffset; i < processed.length && lines.length < height - footerLines; i++) {
      const row = processed[i]!;
      const isSelected = i === this.selectedIndex;
      const isZebra = zebra && i % 2 === 1;
      lines.push(this.renderRow(row, i, colWidths, isSelected, isZebra, fg, boldFg, dimFg, bg));
    }

    // Empty state
    if (processed.length === 0) {
      lines.push(dimFg('textMuted', '  (no data)'));
    }

    // Footer
    if (showFooter && processed.length > 0) {
      const visible = `${String(this.scrollOffset + 1)}-${String(Math.min(this.scrollOffset + bodyHeight, processed.length))}`;
      lines.push(dimFg('textMuted', ` ${visible} of ${String(processed.length)} rows`));
    }

    return lines;
  }

  private renderHeader(
    colWidths: number[],
    fg: (t: string, s: string) => string,
    boldFg: (t: string, s: string) => string,
    dimFg: (t: string, s: string) => string,
  ): string {
    const parts: string[] = [' ']; // Cursor space

    for (let i = 0; i < this.columns.length; i++) {
      const col = this.columns[i]!;
      const w = colWidths[i] ?? col.minWidth;
      let header = col.header;

      // Sort indicator
      if (this.sortState?.columnId === col.id) {
        header += this.sortState.direction === 'asc' ? ' ↑' : ' ↓';
      }

      // Truncate if needed
      header = truncateCell(header, w);

      // Align
      const aligned = alignText(header, w, col.align);
      parts.push(boldFg('text', aligned));
    }

    return parts.join(' ');
  }

  private renderRow(
    row: T,
    index: number,
    colWidths: number[],
    isSelected: boolean,
    isZebra: boolean,
    fg: (t: string, s: string) => string,
    boldFg: (t: string, s: string) => string,
    dimFg: (t: string, s: string) => string,
    bg: (t: string, s: string) => string,
  ): string {
    const parts: string[] = [];

    // Selection cursor
    parts.push(isSelected ? fg('accent', '▸') : ' ');

    for (let i = 0; i < this.columns.length; i++) {
      const col = this.columns[i]!;
      const w = colWidths[i] ?? col.minWidth;
      const value = row[col.id];

      let cellText: string;
      if (col.format) {
        cellText = col.format(value);
      } else {
        cellText = formatCellValue(value, col.type);
      }

      cellText = truncateCell(cellText, w);
      const aligned = alignText(cellText, w, col.align);

      // Apply selection/zebra styling
      if (isSelected) {
        parts.push(boldFg('text', aligned));
      } else if (isZebra) {
        parts.push(dimFg('textMuted', aligned));
      } else {
        parts.push(fg('text', aligned));
      }
    }

    return parts.join(' ');
  }

  private adjustScroll(visibleHeight: number, totalRows: number): void {
    if (this.selectedIndex < 0) return;
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    }
    if (this.selectedIndex >= this.scrollOffset + visibleHeight) {
      this.scrollOffset = this.selectedIndex - visibleHeight + 1;
    }
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, totalRows - visibleHeight)));
  }
}

// ---------------------------------------------------------------------------
// Preset Column Configurations
// ---------------------------------------------------------------------------

/** Columns for agent swarm table. */
export function agentTableColumns(): ColumnDef[] {
  return [
    { id: 'name', header: 'Agent', type: 'text', minWidth: 10, maxWidth: 20, flex: 2, sortable: true, align: 'left' },
    { id: 'status', header: 'Status', type: 'status', minWidth: 8, maxWidth: 12, flex: 1, sortable: true, align: 'left' },
    { id: 'progress', header: 'Progress', type: 'progress', minWidth: 10, maxWidth: 20, flex: 2, sortable: true, align: 'left' },
    { id: 'tokensUsed', header: 'Tokens', type: 'number', minWidth: 8, maxWidth: 10, flex: 1, sortable: true, align: 'right' },
    { id: 'costUsd', header: 'Cost', type: 'cost', minWidth: 7, maxWidth: 9, flex: 1, sortable: true, align: 'right' },
    { id: 'elapsedMs', header: 'Time', type: 'time', minWidth: 6, maxWidth: 8, flex: 1, sortable: true, align: 'right' },
  ];
}

/** Columns for file list table. */
export function fileTableColumns(): ColumnDef[] {
  return [
    { id: 'path', header: 'Path', type: 'text', minWidth: 20, maxWidth: 60, flex: 4, sortable: true, align: 'left' },
    { id: 'status', header: 'St', type: 'status', minWidth: 3, maxWidth: 4, flex: 0, sortable: true, align: 'center' },
    { id: 'additions', header: '+', type: 'number', minWidth: 4, maxWidth: 6, flex: 1, sortable: true, align: 'right' },
    { id: 'deletions', header: '-', type: 'number', minWidth: 4, maxWidth: 6, flex: 1, sortable: true, align: 'right' },
  ];
}

/** Columns for cost breakdown table. */
export function costTableColumns(): ColumnDef[] {
  return [
    { id: 'model', header: 'Model', type: 'text', minWidth: 12, maxWidth: 25, flex: 3, sortable: true, align: 'left' },
    { id: 'requests', header: 'Reqs', type: 'number', minWidth: 5, maxWidth: 7, flex: 1, sortable: true, align: 'right' },
    { id: 'inputTokens', header: 'Input', type: 'number', minWidth: 7, maxWidth: 10, flex: 1, sortable: true, align: 'right' },
    { id: 'outputTokens', header: 'Output', type: 'number', minWidth: 7, maxWidth: 10, flex: 1, sortable: true, align: 'right' },
    { id: 'costUsd', header: 'Cost', type: 'cost', minWidth: 8, maxWidth: 10, flex: 1, sortable: true, align: 'right' },
  ];
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function compareValues(a: unknown, b: unknown, type: ColumnType): number {
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;

  switch (type) {
    case 'number':
    case 'cost':
    case 'progress':
      return (Number(a) || 0) - (Number(b) || 0);
    case 'time':
      return (Number(a) || 0) - (Number(b) || 0);
    default:
      return String(a).localeCompare(String(b));
  }
}

function formatCellValue(value: unknown, type: ColumnType): string {
  if (value === null || value === undefined) return '—';

  switch (type) {
    case 'number': {
      const n = Number(value);
      if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
      return String(n);
    }
    case 'cost': {
      const n = Number(value);
      if (n < 0.01) return `$${n.toFixed(4)}`;
      if (n < 1) return `$${n.toFixed(3)}`;
      return `$${n.toFixed(2)}`;
    }
    case 'time': {
      const ms = Number(value);
      if (ms < 1000) return `${String(ms)}ms`;
      const sec = Math.floor(ms / 1000);
      if (sec < 60) return `${String(sec)}s`;
      const min = Math.floor(sec / 60);
      return `${String(min)}m${String(sec % 60)}s`;
    }
    case 'progress': {
      const ratio = Number(value);
      const pct = Math.round(ratio * 100);
      const barW = 6;
      const filled = Math.round(ratio * barW);
      return `${'█'.repeat(filled)}${'░'.repeat(barW - filled)} ${String(pct)}%`;
    }
    case 'status':
      return String(value);
    default:
      return String(value);
  }
}

function truncateCell(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 2) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

function alignText(text: string, width: number, align: 'left' | 'right' | 'center'): string {
  if (text.length >= width) return text.slice(0, width);
  switch (align) {
    case 'right':
      return text.padStart(width);
    case 'center': {
      const left = Math.floor((width - text.length) / 2);
      const right = width - text.length - left;
      return ' '.repeat(left) + text + ' '.repeat(right);
    }
    default:
      return text.padEnd(width);
  }
}
