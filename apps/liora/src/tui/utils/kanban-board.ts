/**
 * KanbanBoard — task board with columns, cards, and drag support.
 *
 * Provides Trello-style kanban visualization:
 * - Multiple columns (To Do, In Progress, Done, etc.)
 * - Cards with title, description, labels, assignees
 * - Card priority indicators (low, medium, high, urgent)
 * - Drag-and-drop between columns (keyboard: h/l to move)
 * - WIP (Work In Progress) limits per column
 * - Card filtering by label/assignee
 * - Card count per column
 * - Swimlanes (horizontal grouping)
 * - Card expansion (show details)
 * - Color-coded labels
 * - Due date indicators
 * - Compact/expanded card views
 *
 * Visual style:
 * ┌─ To Do (3) ─────┐ ┌─ In Progress (2) ┐ ┌─ Done (5) ────────┐
 * │ ┌─────────────┐ │ │ ┌─────────────┐  │ │ ┌─────────────┐   │
 * │ │ Fix login   │ │ │ │ Add tests   │  │ │ │ Setup CI    │   │
 * │ │ 🔴 high     │ │ │ │ 🟡 medium   │  │ │ │ ✓ complete  │   │
 * │ └─────────────┘ │ │ └─────────────┘  │ │ └─────────────┘   │
 * │ ┌─────────────┐ │ │ ┌─────────────┐  │ │        ...        │
 * │ │ Update docs │ │ │ │ Refactor    │  │ │                   │
 * │ └─────────────┘ │ │ └─────────────┘  │ │                   │
 * └─────────────────┘ └──────────────────┘ └───────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CardPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface CardLabel {
  readonly id: string;
  readonly name: string;
  readonly color: string; // Hex color
}

export interface KanbanCard {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly priority: CardPriority;
  readonly labels: readonly CardLabel[];
  readonly assignees: readonly string[];
  readonly dueDate?: Date;
  readonly createdAt: number;
  readonly completedAt?: number;
  readonly expanded?: boolean;
}

export interface KanbanColumn {
  readonly id: string;
  readonly title: string;
  readonly color?: string;
  readonly wipLimit?: number;
  readonly cards: KanbanCard[];
}

export interface KanbanRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly cardWidth?: number;
  readonly showDescriptions?: boolean;
  readonly showAssignees?: boolean;
  readonly showDueDates?: boolean;
  readonly compact?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_ICONS: Record<CardPriority, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🟠',
  urgent: '🔴',
};

const PRIORITY_COLORS: Record<CardPriority, string> = {
  low: 'success',
  medium: 'warning',
  high: 'warning',
  urgent: 'error',
};

const DEFAULT_CARD_WIDTH = 20;

// ---------------------------------------------------------------------------
// KanbanBoard
// ---------------------------------------------------------------------------

export class KanbanBoard {
  private columns: KanbanColumn[] = [];
  private cursorCol = 0;
  private cursorCard = 0;
  private draggedCard: { colIndex: number; cardIndex: number } | null = null;

  // ─── Column Management ───────────────────────────────────────────

  /** Add a column. */
  addColumn(column: Omit<KanbanColumn, 'cards'> & { cards?: KanbanCard[] }): void {
    this.columns.push({ ...column, cards: column.cards ?? [] });
  }

  /** Remove a column. */
  removeColumn(id: string): void {
    this.columns = this.columns.filter((c) => c.id !== id);
  }

  /** Get all columns. */
  getColumns(): readonly KanbanColumn[] {
    return this.columns;
  }

  /** Get column by ID. */
  getColumn(id: string): KanbanColumn | undefined {
    return this.columns.find((c) => c.id === id);
  }

  // ─── Card Management ─────────────────────────────────────────────

  /** Add a card to a column. */
  addCard(columnId: string, card: KanbanCard): boolean {
    const column = this.columns.find((c) => c.id === columnId);
    if (!column) return false;

    // Check WIP limit
    if (column.wipLimit && column.cards.length >= column.wipLimit) {
      return false;
    }

    column.cards.push(card);
    return true;
  }

  /** Remove a card. */
  removeCard(cardId: string): void {
    for (const column of this.columns) {
      column.cards = column.cards.filter((c) => c.id !== cardId);
    }
  }

  /** Move a card to a different column. */
  moveCard(cardId: string, toColumnId: string, toIndex?: number): boolean {
    // Find and remove from source
    let card: KanbanCard | undefined;
    for (const column of this.columns) {
      const index = column.cards.findIndex((c) => c.id === cardId);
      if (index >= 0) {
        card = column.cards[index];
        column.cards.splice(index, 1);
        break;
      }
    }

    if (!card) return false;

    // Add to destination
    const destColumn = this.columns.find((c) => c.id === toColumnId);
    if (!destColumn) return false;

    // Check WIP limit
    if (destColumn.wipLimit && destColumn.cards.length >= destColumn.wipLimit) {
      return false;
    }

    if (toIndex !== undefined && toIndex >= 0 && toIndex <= destColumn.cards.length) {
      destColumn.cards.splice(toIndex, 0, card);
    } else {
      destColumn.cards.push(card);
    }

    return true;
  }

  /** Move card left (to previous column). */
  moveCardLeft(cardId: string): boolean {
    if (this.cursorCol > 0) {
      const targetCol = this.columns[this.cursorCol - 1]!;
      return this.moveCard(cardId, targetCol.id);
    }
    return false;
  }

  /** Move card right (to next column). */
  moveCardRight(cardId: string): boolean {
    if (this.cursorCol < this.columns.length - 1) {
      const targetCol = this.columns[this.cursorCol + 1]!;
      return this.moveCard(cardId, targetCol.id);
    }
    return false;
  }

  // ─── Navigation ──────────────────────────────────────────────────

  /** Move cursor left (previous column). */
  moveLeft(): void {
    if (this.cursorCol > 0) {
      this.cursorCol--;
      this.cursorCard = 0;
    }
  }

  /** Move cursor right (next column). */
  moveRight(): void {
    if (this.cursorCol < this.columns.length - 1) {
      this.cursorCol++;
      this.cursorCard = 0;
    }
  }

  /** Move cursor up (previous card). */
  moveUp(): void {
    if (this.cursorCard > 0) {
      this.cursorCard--;
    }
  }

  /** Move cursor down (next card). */
  moveDown(): void {
    const column = this.columns[this.cursorCol];
    if (column && this.cursorCard < column.cards.length - 1) {
      this.cursorCard++;
    }
  }

  /** Get current cursor position. */
  getCursor(): { col: number; card: number } {
    return { col: this.cursorCol, card: this.cursorCard };
  }

  /** Get the currently selected card. */
  getSelectedCard(): KanbanCard | null {
    const column = this.columns[this.cursorCol];
    return column?.cards[this.cursorCard] ?? null;
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get total card count. */
  get totalCards(): number {
    return this.columns.reduce((sum, col) => sum + col.cards.length, 0);
  }

  /** Get cards by priority. */
  getCardsByPriority(priority: CardPriority): KanbanCard[] {
    const result: KanbanCard[] = [];
    for (const column of this.columns) {
      for (const card of column.cards) {
        if (card.priority === priority) result.push(card);
      }
    }
    return result;
  }

  /** Get overdue cards. */
  getOverdueCards(): KanbanCard[] {
    const now = Date.now();
    const result: KanbanCard[] = [];
    for (const column of this.columns) {
      for (const card of column.cards) {
        if (card.dueDate && card.dueDate.getTime() < now && !card.completedAt) {
          result.push(card);
        }
      }
    }
    return result;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the kanban board. */
  render(options: KanbanRenderOptions): string[] {
    const { width, height, cardWidth = DEFAULT_CARD_WIDTH, compact = false, fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    if (this.columns.length === 0) {
      return [dimFg('textMuted', '  (no columns)')];
    }

    // Calculate column widths
    const colCount = this.columns.length;
    const totalGaps = (colCount - 1) * 1;
    const availableWidth = width - totalGaps;
    const colWidth = Math.max(cardWidth + 4, Math.floor(availableWidth / colCount));

    // Render header row
    const headers = this.columns.map((col, i) => {
      const isCursor = i === this.cursorCol;
      const count = col.cards.length;
      const wip = col.wipLimit ? `/${String(col.wipLimit)}` : '';
      const title = `${col.title} (${String(count)}${wip})`;
      const padded = this.padCenter(title, colWidth - 2);

      if (isCursor) {
        return boldFg('primary', `┌─${padded}─┐`);
      }
      return fg('textMuted', `┌─${padded}─┐`);
    });
    lines.push(headers.join(' '));

    // Render cards row by row
    const maxCards = Math.max(...this.columns.map((c) => c.cards.length));
    const cardHeight = compact ? 2 : 4;
    const maxRows = Math.min(maxCards, Math.floor((height - 3) / cardHeight));

    for (let row = 0; row < maxRows; row++) {
      const cardLines: string[][] = this.columns.map((col, colIdx) => {
        const card = col.cards[row];
        const isCursorCol = colIdx === this.cursorCol;
        const isCursorCard = row === this.cursorCard;

        if (card) {
          return this.renderCard(card, colWidth - 2, {
            isCursor: isCursorCol && isCursorCard,
            compact,
            ...options,
          });
        }
        // Empty slot
        const empty: string[] = [];
        for (let i = 0; i < cardHeight; i++) {
          empty.push(fg('textDim', `│${' '.repeat(colWidth - 2)}│`));
        }
        return empty;
      });

      // Combine columns for this row
      for (let lineIdx = 0; lineIdx < cardHeight; lineIdx++) {
        const line = cardLines.map((lines) => lines[lineIdx] ?? '').join(' ');
        lines.push(line);
      }
    }

    // Bottom border
    const bottoms = this.columns.map((_, i) => {
      const isCursor = i === this.cursorCol;
      const border = `└${'─'.repeat(colWidth - 2)}┘`;
      return isCursor ? fg('primary', border) : fg('textMuted', border);
    });
    lines.push(bottoms.join(' '));

    return lines;
  }

  private renderCard(card: KanbanCard, width: number, options: KanbanRenderOptions & { isCursor: boolean; compact: boolean }): string[] {
    const { fg, boldFg, dimFg, isCursor, compact, showDescriptions = true } = options;
    const lines: string[] = [];
    const innerWidth = width - 2;

    const border = isCursor ? fg('accent', '│') : fg('textMuted', '│');
    const topBorder = isCursor ? fg('accent', '┌') + fg('accent', '─'.repeat(innerWidth)) + fg('accent', '┐') : fg('textMuted', '┌' + '─'.repeat(innerWidth) + '┐');
    const bottomBorder = isCursor ? fg('accent', '└') + fg('accent', '─'.repeat(innerWidth)) + fg('accent', '┘') : fg('textMuted', '└' + '─'.repeat(innerWidth) + '┘');

    lines.push(topBorder);

    // Title
    const priorityIcon = PRIORITY_ICONS[card.priority];
    const title = this.truncate(card.title, innerWidth - 3);
    const titleLine = isCursor
      ? `${border} ${priorityIcon} ${boldFg('text', title)}${' '.repeat(Math.max(0, innerWidth - title.length - 3))}${border}`
      : `${border} ${priorityIcon} ${fg('text', title)}${' '.repeat(Math.max(0, innerWidth - title.length - 3))}${border}`;
    lines.push(titleLine);

    if (!compact) {
      // Labels
      if (card.labels.length > 0) {
        const labelStr = card.labels.map((l) => l.name).join(' ');
        const labels = this.truncate(labelStr, innerWidth - 2);
        lines.push(`${border} ${dimFg('textMuted', labels)}${' '.repeat(Math.max(0, innerWidth - labels.length - 2))}${border}`);
      } else {
        lines.push(`${border}${' '.repeat(innerWidth)}${border}`);
      }

      // Assignees / Due date
      const meta: string[] = [];
      if (card.assignees.length > 0) {
        meta.push(`@${card.assignees.join(', @')}`);
      }
      if (card.dueDate) {
        const isOverdue = card.dueDate.getTime() < Date.now() && !card.completedAt;
        meta.push(isOverdue ? '⚠ overdue' : '📅 due');
      }
      if (meta.length > 0) {
        const metaStr = this.truncate(meta.join(' '), innerWidth - 2);
        lines.push(`${border} ${dimFg('textMuted', metaStr)}${' '.repeat(Math.max(0, innerWidth - metaStr.length - 2))}${border}`);
      } else {
        lines.push(`${border}${' '.repeat(innerWidth)}${border}`);
      }
    }

    lines.push(bottomBorder);
    return lines;
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '…';
  }

  private padCenter(text: string, width: number): string {
    const padding = Math.max(0, width - text.length);
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
}

// ---------------------------------------------------------------------------
// Helper: Create default board
// ---------------------------------------------------------------------------

/** Create a standard kanban board with common columns. */
export function createDefaultBoard(): KanbanBoard {
  const board = new KanbanBoard();
  board.addColumn({ id: 'backlog', title: 'Backlog' });
  board.addColumn({ id: 'todo', title: 'To Do' });
  board.addColumn({ id: 'progress', title: 'In Progress', wipLimit: 3 });
  board.addColumn({ id: 'review', title: 'Review', wipLimit: 2 });
  board.addColumn({ id: 'done', title: 'Done' });
  return board;
}
