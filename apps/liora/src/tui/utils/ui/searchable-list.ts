/**
 * Cursor + fuzzy-search + paging state machine shared by list pickers
 * (ChoicePicker, ModelSelector). Pure logic, no rendering.
 *
 * The component owns presentation and the keys that carry component-specific
 * meaning — Enter (submit), Esc (cancel), and ←/→ (paging in one picker, a
 * thinking toggle in another). This unit owns the keys that behave identically
 * everywhere: ↑/↓, PgUp/PgDn, and search editing.
 */

import { fuzzyFilter, Key, matchesKey } from '#/tui/renderer';

import {
  gridMoveDown,
  gridMoveLeft,
  gridMoveRight,
  gridMoveUp,
} from './grid-nav';
import { pageView, type PageView } from './paging';
import { isPrintableChar, printableChar } from '#/tui/utils/printable-key';

const DEFAULT_PAGE_SIZE = 8;

export interface SearchableListOptions<T> {
  readonly items: readonly T[];
  /** Text a list item is fuzzy-matched against. */
  readonly toSearchText: (item: T) => string;
  /** Optional visibility gate evaluated before fuzzy matching. */
  readonly isVisible?: (item: T, query: string) => boolean;
  /** Items per page; defaults to 8. */
  readonly pageSize?: number;
  /** Initial cursor position (clamped to >= 0). */
  readonly initialIndex?: number;
  /** When false, typed characters are ignored. Defaults to false. */
  readonly searchable?: boolean;
  /**
   * Grid columns for 2D navigation (↑↓ move by columns, ←→ move within row).
   * Defaults to 1 (classic list). Callers may update via {@link setColumns}.
   */
  readonly columns?: number;
}

export interface SearchableListView<T> {
  /** Items after the active query filter. */
  readonly items: readonly T[];
  /** Page math for the current cursor over {@link items}. */
  readonly page: PageView;
  /** Cursor clamped into the current {@link items} range. */
  readonly selectedIndex: number;
  readonly query: string;
}

export class SearchableList<T> {
  private readonly items: readonly T[];
  private readonly toSearchText: (item: T) => string;
  private readonly isVisible?: (item: T, query: string) => boolean;
  private readonly pageSize: number;
  private readonly searchable: boolean;
  private columns: number;
  private query = '';
  private cursor: number;

  constructor(opts: SearchableListOptions<T>) {
    this.items = opts.items;
    this.toSearchText = opts.toSearchText;
    this.isVisible = opts.isVisible;
    this.pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
    this.searchable = opts.searchable ?? false;
    this.columns = Math.max(1, opts.columns ?? 1);
    this.cursor = Math.max(opts.initialIndex ?? 0, 0);
  }

  /** Update grid columns (typically from render width). */
  setColumns(columns: number): void {
    this.columns = Math.max(1, columns);
  }

  getColumns(): number {
    return this.columns;
  }

  /**
   * Effective items-per-page for paging. When multi-column, one "page" is
   * still measured in items but callers can page by whole visual rows via
   * PgUp/PgDn stepping `pageSize` (row-oriented UIs multiply by columns).
   */
  pageStride(): number {
    return this.pageSize * Math.max(1, this.columns);
  }

  filtered(): readonly T[] {
    const isVisible = this.isVisible;
    const items =
      isVisible === undefined
        ? this.items
        : this.items.filter((item) => isVisible(item, this.query));
    if (this.query.length === 0) return items;
    return fuzzyFilter([...items], this.query, this.toSearchText);
  }

  /** The item under the cursor, clamped into the filtered range. */
  selected(): T | undefined {
    const items = this.filtered();
    if (items.length === 0) return undefined;
    return items[Math.min(this.cursor, items.length - 1)];
  }

  view(): SearchableListView<T> {
    const items = this.filtered();
    return {
      items,
      page: pageView(items.length, this.cursor, this.pageSize),
      selectedIndex: Math.min(this.cursor, Math.max(0, items.length - 1)),
      query: this.query,
    };
  }

  moveUp(): void {
    const count = this.filtered().length;
    this.cursor = gridMoveUp({ index: this.cursor, count, columns: this.columns });
  }

  moveDown(): void {
    const count = this.filtered().length;
    this.cursor = gridMoveDown({ index: this.cursor, count, columns: this.columns });
  }

  moveLeft(): void {
    const count = this.filtered().length;
    this.cursor = gridMoveLeft({ index: this.cursor, count, columns: this.columns });
  }

  moveRight(): void {
    const count = this.filtered().length;
    this.cursor = gridMoveRight({ index: this.cursor, count, columns: this.columns });
  }

  /** Jump the cursor to an absolute filtered index (clamped). */
  setSelectedIndex(index: number): void {
    const max = Math.max(0, this.filtered().length - 1);
    this.cursor = Math.max(0, Math.min(max, index));
  }

  pageUp(): void {
    this.cursor = Math.max(0, this.cursor - this.pageStride());
  }

  pageDown(): void {
    this.cursor = Math.min(
      Math.max(0, this.filtered().length - 1),
      this.cursor + this.pageStride(),
    );
  }

  /** Clears the active query and resets the cursor. Returns whether a query was cleared. */
  clearQuery(): boolean {
    if (this.query.length === 0) return false;
    this.query = '';
    this.cursor = 0;
    return true;
  }

  /**
   * Handles the keys every picker shares: ↑/↓, PgUp/PgDn, and — when searchable —
   * Backspace and printable characters. Returns true when the key was consumed.
   * Enter, Esc, and ←/→ are intentionally left to the component.
   */
  handleKey(data: string): boolean {
    if (matchesKey(data, Key.up)) {
      this.moveUp();
      return true;
    }
    if (matchesKey(data, Key.down)) {
      this.moveDown();
      return true;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.pageUp();
      return true;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.pageDown();
      return true;
    }
    if (!this.searchable) return false;
    if (matchesKey(data, Key.backspace)) {
      if (this.query.length > 0) {
        this.query = this.query.slice(0, -1);
        this.cursor = 0;
      }
      return true;
    }
    const ch = printableChar(data);
    if (isPrintableChar(ch)) {
      this.query += ch;
      this.cursor = 0;
      return true;
    }
    return false;
  }
}
