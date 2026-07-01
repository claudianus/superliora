/**
 * TodoPanel — live-updating TODO list shown before the input area.
 *
 * Mounted as a dedicated `Container` slot between the activity pane
 * (spinners / thinking stream) and the queue / editor block. The host
 * calls {@link setTodos} whenever the LLM invokes the `TodoList`
 * tool; state survives across turns so the list stays visible until
 * explicitly cleared (`todos: []`), a new session starts, or `/clear`
 * is issued.
 */

import type { Component } from '@earendil-works/pi-tui';
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import chalk from 'chalk';

import { currentTheme } from '#/tui/theme/theme';
import type { ColorPalette } from '#/tui/theme/colors';

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  readonly title: string;
  readonly status: TodoStatus;
}

const MAX_VISIBLE = 5;
const BOARD_MIN_WIDTH = 72;
const BOARD_COLUMN_MIN_WIDTH = 16;
const BOARD_INDENT = '  ';
const BOARD_SEPARATOR = ' │ ';

export interface VisibleTodos {
  readonly rows: readonly TodoItem[];
  readonly hidden: number;
  readonly hiddenCounts: Record<TodoStatus, number>;
}

/**
 * Pick which todos to render when the list exceeds {@link MAX_VISIBLE}.
 *
 * The selector is order-agnostic — the TodoList tool keeps whatever
 * order the model produced and does not group items by status, so an
 * interleaved sequence like `pending, done, pending, done, ...` is
 * possible and must still yield MAX_VISIBLE rows when enough exist.
 *
 * Strategy:
 * 1. Include every `in_progress` item (capped at MAX_VISIBLE).
 * 2. Fill remaining slots with "what's next" — the earliest `pending`
 *    items in their original positions — while reserving one slot for
 *    "what just finished" — the latest `done` item — when both kinds
 *    exist. If one side has too few candidates, the other expands.
 *
 * Items are returned in their original order.
 */
export function selectVisibleTodos(todos: readonly TodoItem[]): VisibleTodos {
  if (todos.length <= MAX_VISIBLE) {
    return {
      rows: [...todos],
      hidden: 0,
      hiddenCounts: { done: 0, in_progress: 0, pending: 0 },
    };
  }

  const inProgress: number[] = [];
  const pending: number[] = [];
  const done: number[] = [];
  for (const [i, todo] of todos.entries()) {
    if (todo.status === 'in_progress') inProgress.push(i);
    else if (todo.status === 'pending') pending.push(i);
    else done.push(i);
  }

  const picked = new Set<number>();
  for (const i of inProgress.slice(0, MAX_VISIBLE)) picked.add(i);

  if (picked.size < MAX_VISIBLE) {
    // Most recent done first; earliest pending first.
    const doneCandidates = done.toReversed();
    const pendingCandidates = pending;

    const remaining = MAX_VISIBLE - picked.size;
    let doneCount: number;
    let pendingCount: number;
    if (doneCandidates.length === 0) {
      doneCount = 0;
      pendingCount = Math.min(remaining, pendingCandidates.length);
    } else if (pendingCandidates.length === 0) {
      pendingCount = 0;
      doneCount = Math.min(remaining, doneCandidates.length);
    } else {
      doneCount = 1;
      pendingCount = Math.min(remaining - 1, pendingCandidates.length);
      if (pendingCount < remaining - 1) {
        doneCount = Math.min(doneCandidates.length, remaining - pendingCount);
      }
    }

    for (let i = 0; i < doneCount; i++) picked.add(doneCandidates[i] as number);
    for (let i = 0; i < pendingCount; i++) picked.add(pendingCandidates[i] as number);
  }

  const sortedIdx = [...picked].toSorted((a, b) => a - b);

  const hiddenCounts: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  for (const [i, todo] of todos.entries()) {
    if (!picked.has(i)) {
      hiddenCounts[todo.status] += 1;
    }
  }

  return {
    rows: sortedIdx.map((i) => todos[i] as TodoItem),
    hidden: todos.length - sortedIdx.length,
    hiddenCounts,
  };
}

export class TodoPanelComponent implements Component {
  private todos: readonly TodoItem[] = [];
  private expanded = false;

  setTodos(todos: readonly TodoItem[]): void {
    this.todos = todos.map((t) => ({ title: t.title, status: t.status }));
  }

  getTodos(): readonly TodoItem[] {
    return this.todos;
  }

  clear(): void {
    this.todos = [];
    this.expanded = false;
  }

  isEmpty(): boolean {
    return this.todos.length === 0;
  }

  /** True when the list exceeds the collapsed cap, i.e. there is something to expand. */
  hasOverflow(): boolean {
    return this.todos.length > MAX_VISIBLE;
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
  }

  toggleExpanded(): void {
    this.expanded = !this.expanded;
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (this.todos.length === 0) return [];
    const c = currentTheme.palette;
    const lines: string[] = [
      chalk.hex(c.border)('─'.repeat(width)),
      chalk.hex(c.primary).bold('  Todo Board'),
    ];

    if (this.expanded) {
      lines.push(...renderTodos(this.todos, c, width));
      if (this.todos.length > MAX_VISIBLE) {
        lines.push(
          chalk.hex(c.textDim)(`  all ${String(this.todos.length)} items · ctrl+t to collapse`),
        );
      }
    } else {
      const { rows, hidden, hiddenCounts } = selectVisibleTodos(this.todos);
      lines.push(...renderTodos(rows, c, width));
      if (hidden > 0) {
        const distribution = formatHiddenCounts(hiddenCounts);
        const suffix = distribution.length > 0 ? ` (${distribution})` : '';
        lines.push(
          chalk.hex(c.textDim)(`  … +${hidden} more${suffix} · ctrl+t to expand`),
        );
      }
    }

    return lines.map((line) => truncateToWidth(line, width));
  }
}

function renderTodos(todos: readonly TodoItem[], colors: ColorPalette, width: number): string[] {
  return width >= BOARD_MIN_WIDTH ? renderBoard(todos, colors, width) : renderLanes(todos, colors);
}

function renderBoard(todos: readonly TodoItem[], colors: ColorPalette, width: number): string[] {
  const availableWidth = Math.max(1, width - visibleWidth(BOARD_INDENT));
  const columnWidth = Math.floor(
    (availableWidth - visibleWidth(BOARD_SEPARATOR) * (TODO_LANES.length - 1)) /
      TODO_LANES.length,
  );
  if (columnWidth < BOARD_COLUMN_MIN_WIDTH) return renderLanes(todos, colors);

  const lanes = TODO_LANES.map((lane) => ({
    ...lane,
    todos: todos.filter((todo) => todo.status === lane.status),
  }));
  const maxRows = Math.max(1, ...lanes.map((lane) => lane.todos.length));
  const separator = chalk.hex(colors.border)(BOARD_SEPARATOR);
  const lines = [
    BOARD_INDENT + lanes
      .map((lane) => padCell(renderLaneHeader(lane.label, lane.todos.length, lane.status, colors), columnWidth))
      .join(separator),
    BOARD_INDENT + lanes
      .map(() => chalk.hex(colors.border)('─'.repeat(columnWidth)))
      .join(separator),
  ];

  for (let row = 0; row < maxRows; row++) {
    lines.push(
      BOARD_INDENT + lanes
        .map((lane) => {
          const todo = lane.todos[row];
          return padCell(
            todo === undefined ? chalk.hex(colors.textMuted)('No cards') : renderCell(todo, colors),
            columnWidth,
          );
        })
        .join(separator),
    );
  }
  return lines;
}

function renderLanes(todos: readonly TodoItem[], colors: ColorPalette): string[] {
  const lines: string[] = [];
  for (const lane of TODO_LANES) {
    const laneTodos = todos.filter((todo) => todo.status === lane.status);
    if (laneTodos.length === 0) continue;
    lines.push(chalk.hex(colors.textDim)(`  ${lane.label}`));
    for (const todo of laneTodos) {
      lines.push(renderRow(todo, colors));
    }
  }
  return lines;
}

function renderLaneHeader(
  label: string,
  count: number,
  status: TodoStatus,
  colors: ColorPalette,
): string {
  const text = `${label} (${String(count)})`;
  switch (status) {
    case 'in_progress':
      return chalk.hex(colors.primary).bold(text);
    case 'done':
      return chalk.hex(colors.success).bold(text);
    case 'pending':
      return chalk.hex(colors.textStrong).bold(text);
  }
}

function renderRow(todo: TodoItem, colors: ColorPalette): string {
  return `  ${renderCell(todo, colors)}`;
}

function renderCell(todo: TodoItem, colors: ColorPalette): string {
  const marker = statusMarker(todo.status, colors);
  const titleStyled = styleTitle(todo.title, todo.status, colors);
  return `${marker} ${titleStyled}`;
}

function padCell(content: string, width: number): string {
  const truncated = truncateToWidth(content, width, '…');
  return truncated + ' '.repeat(Math.max(0, width - visibleWidth(truncated)));
}

function statusMarker(status: TodoStatus, colors: ColorPalette): string {
  switch (status) {
    case 'in_progress':
      return chalk.hex(colors.primary).bold('●');
    case 'done':
      return chalk.hex(colors.success)('✓');
    case 'pending':
      return chalk.hex(colors.textDim)('○');
  }
}

function styleTitle(title: string, status: TodoStatus, colors: ColorPalette): string {
  switch (status) {
    case 'in_progress':
      return chalk.hex(colors.text).bold(title);
    case 'done':
      return chalk.hex(colors.textDim).strikethrough(title);
    case 'pending':
      return chalk.hex(colors.text)(title);
  }
}

const STATUS_LABELS: readonly { status: TodoStatus; label: string }[] = [
  { status: 'done', label: 'done' },
  { status: 'in_progress', label: 'in progress' },
  { status: 'pending', label: 'pending' },
];

const TODO_LANES: readonly { status: TodoStatus; label: string }[] = [
  { status: 'in_progress', label: 'Doing' },
  { status: 'pending', label: 'Next' },
  { status: 'done', label: 'Done' },
];

export function formatHiddenCounts(counts: Record<TodoStatus, number>): string {
  return STATUS_LABELS.filter(({ status }) => counts[status] > 0)
    .map(({ status, label }) => `${counts[status]} ${label}`)
    .join(' · ');
}
