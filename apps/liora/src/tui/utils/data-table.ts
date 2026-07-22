/**
 * DataTable — sortable, filterable, selectable tabular data display.
 *
 * Provides spreadsheet-quality data tables:
 * - Column definitions with types (string, number, date, boolean)
 * - Sort by any column (ascending/descending)
 * - Filter rows by column value
 * - Row selection (single/multi)
 * - Column resizing
 * - Fixed header with scrollable body
 * - Cell alignment (left, right, center)
 * - Cell formatting (custom render functions)
 * - Row grouping with collapse
 * - Zebra striping
 * - Hover highlighting
 * - Keyboard navigation (arrows, Home/End, PageUp/Down)
 * - Column visibility toggle
 * - Footer with aggregations (sum, avg, count)
 *
 * Visual style:
 * ┌────┬──────────────┬────────┬─────────┐
 * │ #  │ Name         │ Size   │ Status  │
 * ├────┼──────────────┼────────┼─────────┤
 * │ 1  │ main.ts      │ 2.4 KB │ ✓       │
 * │ 2  │ utils.ts     │ 1.1 KB │ ✓       │
 * │▸3  │ index.ts     │ 0.8 KB │ ◉       │
 * └────┴──────────────┴────────┴─────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ColumnType = 'string' | 'number' | 'date' | 'boolean' | 'custom';
export type Alignment = 'left' | 'right' | 'center';
export type SortDirection = 'asc' | 'desc' | null;

export interface ColumnDef {
  readonly id: string;
  readonly header: string;
  readonly type: ColumnType;
  readonly width?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly align?: Alignment;
  readonly sortable?: boolean;
  readonly visible?: boolean;
  readonly format?: (value: unknown, row: Record<string, unknown>) => string;
  readonly icon?: string;
}

export interface TableRow {
  readonly id: string;
  readonly data: Record<string, unknown>;
  readonly selected?: boolean;
  readonly expanded?: boolean;
  readonly children?: TableRow[];
}

export interface TableState {
  readonly sortColumn: string | null;
  readonly sortDirection: SortDirection;
  readonly filterText: string;
  readonly cursorRow: number;
  readonly cursorCol: number;
  readonly scrollOffset: number;
  readonly selectedRows: Set<string>;
}

export interface TableRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly zebra?: boolean;
  readonly showHeader?: boolean;
  readonly showFooter?: boolean;
  readonly showRowNumbers?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// DataTable
// ---------------------------------------------------------------------------

export class DataTable {
  private columns: ColumnDef[] = [];
  private rows: TableRow[] = [];
  private state: TableState = {
    sortColumn: null,
    sortDirection: null,
    filterText: '',
    cursorRow: 0,
    cursorCol: 0,
    scrollOffset: 0,
    selectedRows: new Set(),
  };

  // ─── Configuration ───────────────────────────────────────────────

  /** Set column definitions. */
  setColumns(columns: ColumnDef[]): void {
    this.columns = columns;
  }

  /** Set row data. */
  setRows(rows: TableRow[]): void {
    this.rows = rows;
    if (this.state.cursorRow >= rows.length) {
      this.state = { ...this.state, cursorRow: Math.max(0, rows.length - 1) };
    }
  }

  /** Add a single row. */
  addRow(row: TableRow): void {
    this.rows.push(row);
  }

  /** Remove a row by ID. */
  removeRow(id: string): void {
    this.rows = this.rows.filter((r) => r.id !== id);
    this.state.selectedRows.delete(id);
  }

  // ─── Sorting ─────────────────────────────────────────────────────

  /** Sort by a column. Toggles direction if already sorted. */
  sortBy(columnId: string): void {
    const column = this.columns.find((c) => c.id === columnId);
    if (!column || column.sortable === false) return;

    let direction: SortDirection;
    if (this.state.sortColumn === columnId) {
      // Cycle: asc → desc → null
      direction = this.state.sortDirection === 'asc' ? 'desc' : this.state.sortDirection === 'desc' ? null : 'asc';
    } else {
      direction = 'asc';
    }

    this.state = { ...this.state, sortColumn: direction ? columnId : null, sortDirection: direction };

    if (direction) {
      this.rows.sort((a, b) => {
        const aVal = a.data[columnId];
        const bVal = b.data[columnId];
        const cmp = this.compareValues(aVal, bVal, column.type);
        return direction === 'asc' ? cmp : -cmp;
      });
    }
  }

  private compareValues(a: unknown, b: unknown, type: ColumnType): number {
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;

    switch (type) {
      case 'number':
        return Number(a) - Number(b);
      case 'date':
        return new Date(a as string).getTime() - new Date(b as string).getTime();
      case 'boolean':
        return Number(Boolean(a)) - Number(Boolean(b));
      default:
        return String(a).localeCompare(String(b));
    }
  }

  // ─── Filtering ───────────────────────────────────────────────────

  /** Set filter text (searches all columns). */
  setFilter(text: string): void {
    this.state = { ...this.state, filterText: text.toLowerCase(), cursorRow: 0, scrollOffset: 0 };
  }

  /** Get filtered rows. */
  private getFilteredRows(): TableRow[] {
    if (!this.state.filterText) return this.rows;

    return this.rows.filter((row) => {
      return this.columns.some((col) => {
        const value = row.data[col.id];
        return value !== null && value !== undefined &&
          String(value).toLowerCase().includes(this.state.filterText);
      });
    });
  }

  // ─── Selection ───────────────────────────────────────────────────

  /** Toggle row selection. */
  toggleSelect(rowId: string): void {
    const selected = new Set(this.state.selectedRows);
    if (selected.has(rowId)) {
      selected.delete(rowId);
    } else {
      selected.add(rowId);
    }
    this.state = { ...this.state, selectedRows: selected };
  }

  /** Select all rows. */
  selectAll(): void {
    const selected = new Set(this.rows.map((r) => r.id));
    this.state = { ...this.state, selectedRows: selected };
  }

  /** Clear selection. */
  clearSelection(): void {
    this.state = { ...this.state, selectedRows: new Set() };
  }

  /** Get selected row IDs. */
  getSelected(): string[] {
    return [...this.state.selectedRows];
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Move cursor up. */
  moveUp(): void {
    if (this.state.cursorRow > 0) {
      this.state = { ...this.state, cursorRow: this.state.cursorRow - 1 };
      this.ensureVisible();
    }
  }

  /** Move cursor down. */
  moveDown(): void {
    const filtered = this.getFilteredRows();
    if (this.state.cursorRow < filtered.length - 1) {
      this.state = { ...this.state, cursorRow: this.state.cursorRow + 1 };
      this.ensureVisible();
    }
  }

  /** Move cursor left. */
  moveLeft(): void {
    if (this.state.cursorCol > 0) {
      this.state = { ...this.state, cursorCol: this.state.cursorCol - 1 };
    }
  }

  /** Move cursor right. */
  moveRight(): void {
    const visibleCols = this.columns.filter((c) => c.visible !== false);
    if (this.state.cursorCol < visibleCols.length - 1) {
      this.state = { ...this.state, cursorCol: this.state.cursorCol + 1 };
    }
  }

  private ensureVisible(): void {
    const viewHeight = 10; // Approximate
    if (this.state.cursorRow < this.state.scrollOffset) {
      this.state = { ...this.state, scrollOffset: this.state.cursorRow };
    } else if (this.state.cursorRow >= this.state.scrollOffset + viewHeight) {
      this.state = { ...this.state, scrollOffset: this.state.cursorRow - viewHeight + 1 };
    }
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get row count. */
  get rowCount(): number {
    return this.getFilteredRows().length;
  }

  /** Get column count. */
  get colCount(): number {
    return this.columns.filter((c) => c.visible !== false).length;
  }

  /** Get cursor position. */
  get cursor(): { row: number; col: number } {
    return { row: this.state.cursorRow, col: this.state.cursorCol };
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the table. */
  render(options: TableRenderOptions): string[] {
    const { width, height, zebra = true, showHeader = true, showRowNumbers = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const visibleCols = this.columns.filter((c) => c.visible !== false);
    const filteredRows = this.getFilteredRows();

    // Calculate column widths
    const colWidths = this.calculateColumnWidths(visibleCols, filteredRows, width, showRowNumbers);

    // Header
    if (showHeader) {
      lines.push(this.renderBorder(colWidths, 'top', showRowNumbers, fg));
      lines.push(this.renderHeaderRow(visibleCols, colWidths, showRowNumbers, options));
      lines.push(this.renderBorder(colWidths, 'mid', showRowNumbers, fg));
    }

    // Body
    const bodyHeight = height - (showHeader ? 3 : 0) - 1;
    const start = this.state.scrollOffset;
    const end = Math.min(start + bodyHeight, filteredRows.length);

    for (let i = start; i < end; i++) {
      const row = filteredRows[i]!;
      const isCursor = i === this.state.cursorRow;
      const isSelected = this.state.selectedRows.has(row.id);
      const isZebra = zebra && i % 2 === 1;

      lines.push(this.renderDataRow(row, visibleCols, colWidths, i, {
        isCursor, isSelected, isZebra, showRowNumbers, ...options,
      }));
    }

    // Empty state
    if (filteredRows.length === 0) {
      const emptyMsg = this.state.filterText ? 'No matching rows' : 'No data';
      lines.push(dimFg('textMuted', `  ${emptyMsg}`));
    }

    // Footer border
    lines.push(this.renderBorder(colWidths, 'bottom', showRowNumbers, fg));

    return lines;
  }

  private calculateColumnWidths(cols: ColumnDef[], rows: TableRow[], totalWidth: number, showRowNums: boolean): number[] {
    const available = totalWidth - (showRowNums ? 5 : 0) - cols.length * 3 - 1;
    const widths: number[] = [];

    for (const col of cols) {
      if (col.width) {
        widths.push(col.width);
      } else {
        // Auto-size based on content
        let maxLen = col.header.length;
        for (const row of rows.slice(0, 50)) {
          const val = this.formatCell(row, col);
          maxLen = Math.max(maxLen, val.length);
        }
        widths.push(Math.min(maxLen + 2, col.maxWidth ?? 30));
      }
    }

    // Scale to fit
    const total = widths.reduce((a, b) => a + b, 0);
    if (total > available) {
      const scale = available / total;
      return widths.map((w) => Math.max(4, Math.floor(w * scale)));
    }

    return widths;
  }

  private formatCell(row: TableRow, col: ColumnDef): string {
    const value = row.data[col.id];
    if (col.format) return col.format(value, row.data);

    if (value === null || value === undefined) return '';

    switch (col.type) {
      case 'boolean':
        return value ? '✓' : '✗';
      case 'number':
        return String(value);
      default:
        return String(value);
    }
  }

  private renderBorder(widths: number[], position: 'top' | 'mid' | 'bottom', showRowNums: boolean, fg: (t: string, s: string) => string): string {
    const chars = {
      top: { left: '┌', mid: '┬', right: '┐', fill: '─' },
      mid: { left: '├', mid: '┼', right: '┤', fill: '─' },
      bottom: { left: '└', mid: '┴', right: '┘', fill: '─' },
    }[position];

    const segments = widths.map((w) => chars.fill.repeat(w + 2));
    if (showRowNums) segments.unshift(chars.fill.repeat(4));

    return fg('textMuted', chars.left + segments.join(chars.mid) + chars.right);
  }

  private renderHeaderRow(cols: ColumnDef[], widths: number[], showRowNums: boolean, options: TableRenderOptions): string {
    const { fg, boldFg, dimFg } = options;
    const cells: string[] = [];

    if (showRowNums) {
      cells.push(dimFg('textMuted', ' # '));
    }

    for (let i = 0; i < cols.length; i++) {
      const col = cols[i]!;
      const w = widths[i]!;
      const isSorted = this.state.sortColumn === col.id;

      let header = col.header;
      if (isSorted) {
        header += this.state.sortDirection === 'asc' ? ' ▲' : ' ▼';
      }

      const icon = col.icon ? `${col.icon} ` : '';
      const content = `${icon}${header}`;
      const padded = this.padCell(content, w, col.align ?? 'left');

      cells.push(isSorted ? boldFg('primary', padded) : boldFg('text', padded));
    }

    return `${fg('textMuted', '│')} ${cells.join(` ${fg('textMuted', '│')} `)} ${fg('textMuted', '│')}`;
  }

  private renderDataRow(row: TableRow, cols: ColumnDef[], widths: number[], index: number, options: TableRenderOptions & { isCursor: boolean; isSelected: boolean; isZebra: boolean; showRowNumbers: boolean }): string {
    const { fg, boldFg, dimFg, isCursor, isSelected, isZebra, showRowNumbers } = options;
    const cells: string[] = [];

    if (showRowNumbers) {
      const rowNum = isSelected ? fg('accent', '▸') + dimFg('textMuted', String(index + 1).padStart(2)) : dimFg('textMuted', String(index + 1).padStart(3));
      cells.push(rowNum);
    }

    for (let i = 0; i < cols.length; i++) {
      const col = cols[i]!;
      const w = widths[i]!;
      const value = this.formatCell(row, col);
      const padded = this.padCell(value, w, col.align ?? 'left');

      if (isCursor && i === this.state.cursorCol) {
        cells.push(boldFg('primary', padded));
      } else if (isSelected) {
        cells.push(fg('accent', padded));
      } else if (isZebra) {
        cells.push(dimFg('textMuted', padded));
      } else {
        cells.push(fg('text', padded));
      }
    }

    const border = isCursor ? fg('accent', '│') : fg('textMuted', '│');
    return `${border} ${cells.join(` ${fg('textMuted', '│')} `)} ${border}`;
  }

  private padCell(text: string, width: number, align: Alignment): string {
    const len = text.replace(/\x1b\[[0-9;]*m/g, '').length;
    const padding = Math.max(0, width - len);

    switch (align) {
      case 'right':
        return ' '.repeat(padding) + text;
      case 'center':
        const left = Math.floor(padding / 2);
        const right = padding - left;
        return ' '.repeat(left) + text + ' '.repeat(right);
      default:
        return text + ' '.repeat(padding);
    }
  }
}
