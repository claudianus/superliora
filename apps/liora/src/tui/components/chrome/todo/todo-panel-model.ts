/**
 * Pure todo-list data helpers for the TodoPanel: overflow selection, change
 * diffing, board-position tracking, and small formatting utilities. Shared by
 * the coordinator (`todo-panel.ts`) and the board renderer
 * (`todo-panel-render.ts`); nothing here touches the theme or terminal
 * renderer.
 */
import { appearanceAnimationNow } from '#/tui/features/appearance/appearance-effects';

import type { TodoItem, TodoStatus } from './todo-panel-types';

export const MAX_VISIBLE = 5;

export type TodoChangeKind = 'added' | 'moved' | 'completed' | 'reopened';

export interface TodoPanelChangeSummary {
  readonly added: number;
  readonly completed: number;
  readonly moved: number;
  readonly reopened: number;
  readonly removed: number;
  readonly reordered: boolean;
  readonly changedAtMs: number;
}

export interface VisibleTodos {
  readonly rows: readonly TodoItem[];
  readonly hidden: number;
  readonly hiddenCounts: Record<TodoStatus, number>;
}

export interface CardPosition {
  readonly lane: TodoStatus;
  readonly row: number;
}

/** Lane row of each rendered card, keyed by title (same identity as diffTodos). */
export function cardPositions(todos: readonly TodoItem[]): Map<string, CardPosition> {
  const laneRows: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  const positions = new Map<string, CardPosition>();
  for (const todo of todos) {
    const row = laneRows[todo.status];
    laneRows[todo.status] = row + 1;
    positions.set(todo.title, { lane: todo.status, row });
  }
  return positions;
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

export function countTodos(todos: readonly TodoItem[]): Record<TodoStatus, number> {
  const counts: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  for (const todo of todos) counts[todo.status] += 1;
  return counts;
}

export function diffTodos(
  previous: readonly TodoItem[],
  next: readonly TodoItem[],
): {
  readonly highlights: Map<string, TodoChangeKind>;
  readonly summary: TodoPanelChangeSummary | undefined;
} {
  const previousByTitle = new Map(previous.map((todo) => [todo.title, todo]));
  const nextByTitle = new Map(next.map((todo) => [todo.title, todo]));
  const highlights = new Map<string, TodoChangeKind>();
  let added = 0;
  let completed = 0;
  let moved = 0;
  let reopened = 0;
  let removed = 0;

  for (const todo of next) {
    const before = previousByTitle.get(todo.title);
    if (before === undefined) {
      added += 1;
      highlights.set(todo.title, 'added');
      continue;
    }
    if (before.status === todo.status) continue;
    if (todo.status === 'done') {
      completed += 1;
      highlights.set(todo.title, 'completed');
    } else if (before.status === 'done') {
      reopened += 1;
      highlights.set(todo.title, 'reopened');
    } else {
      moved += 1;
      highlights.set(todo.title, 'moved');
    }
  }

  for (const todo of previous) {
    if (!nextByTitle.has(todo.title)) removed += 1;
  }

  const reordered =
    added === 0 &&
    removed === 0 &&
    previous.length === next.length &&
    previous.some((todo, index) => next[index]?.title !== todo.title);

  const changed = added + completed + moved + reopened + removed > 0 || reordered;
  return {
    highlights,
    summary: changed
      ? {
          added,
          completed,
          moved,
          reopened,
          removed,
          reordered,
          changedAtMs: appearanceAnimationNow(),
        }
      : undefined,
  };
}

export function formatChangeSummary(summary: TodoPanelChangeSummary): string | undefined {
  const parts: string[] = [];
  if (summary.added > 0) parts.push(`+${String(summary.added)}`);
  if (summary.completed > 0) parts.push(`${String(summary.completed)} done`);
  if (summary.moved > 0) parts.push(`${String(summary.moved)} moved`);
  if (summary.reopened > 0) parts.push(`${String(summary.reopened)} reopened`);
  if (summary.removed > 0) parts.push(`${String(summary.removed)} pruned`);
  if (summary.reordered) parts.push('reordered');
  return parts.length === 0 ? undefined : parts.join(' · ');
}

const STATUS_LABELS: readonly { status: TodoStatus; label: string }[] = [
  { status: 'done', label: 'done' },
  { status: 'in_progress', label: 'in progress' },
  { status: 'pending', label: 'pending' },
];

export function formatHiddenCounts(counts: Record<TodoStatus, number>): string {
  return STATUS_LABELS.filter(({ status }) => counts[status] > 0)
    .map(({ status, label }) => `${counts[status]} ${label}`)
    .join(' · ');
}

/**
 * Slice every lane to its own `[offset, offset + viewport)` row range.
 * Original order is preserved so renderBoard / renderLanes regroup the
 * window exactly like the full list; lanes shorter than the offset simply
 * contribute no cards.
 */
export function windowTodos(
  todos: readonly TodoItem[],
  offset: number,
  viewport: number,
): readonly TodoItem[] {
  const laneSeen: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  const rows: TodoItem[] = [];
  for (const todo of todos) {
    const index = laneSeen[todo.status];
    laneSeen[todo.status] = index + 1;
    if (index >= offset && index < offset + viewport) rows.push(todo);
  }
  return rows;
}
