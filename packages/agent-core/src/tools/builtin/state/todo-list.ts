/**
 * TodoListTool — structured TODO list management tool.
 *
 * The LLM uses this tool to maintain a visible plan of sub-tasks during
 * plan-mode workflows and multi-step operations. A single tool serves
 * both reads and writes:
 *
 *   - `resolveExecution({ todos: [...] })` — replace the full list
 *   - `resolveExecution({ todos: [] })`    — clear the list
 *   - `resolveExecution({})`               — query current list (no mutation)
 *
 * Storage: todos live in the agent-level tool store. Writes go through
 * `tools.update_store`, so the store update is visible on wire replay.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import DESCRIPTION from './todo-list.md?raw';

// ── TODO state shape ─────────────────────────────────────────────────

export const TODO_LIST_TOOL_NAME = 'TodoList' as const;
export const TODO_STORE_KEY = 'todo';
const TODO_LIST_WRITE_REMINDER =
  'Keep this Kanban live: split vague cards, add discovered work, move in_progress after each batch of 3+ tool calls, mark done only after verification, and keep exactly one in_progress unless real parallel tracks exist.';

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  readonly title: string;
  readonly status: TodoStatus;
}

declare module '../../store' {
  interface ToolStoreData {
    todo: readonly TodoItem[];
  }
}

// ── Schema ───────────────────────────────────────────────────────────

const TodoItemSchema = z.object({
  title: z.string().min(1).describe('Short, actionable title for the todo.'),
  status: z.enum(['pending', 'in_progress', 'done']).describe('Current status of the todo.'),
});

export interface TodoListInput {
  todos?: Array<{ title: string; status: TodoStatus }>;
}

export const TodoListInputSchema: z.ZodType<TodoListInput> = z.object({
  todos: z
    .array(TodoItemSchema)
    .optional()
    .describe(
      'The updated todo list. Omit to read the current todo list without making changes. Pass an empty array to clear the list.',
    ),
});

// ── Implementation ───────────────────────────────────────────────────

export function renderTodoList(todos: readonly TodoItem[], title = 'Current todo list:'): string {
  if (todos.length === 0) {
    return 'Todo list is empty.';
  }
  const lines = todos.map((t) => {
    const marker = statusMarker(t.status);
    return `  ${marker} ${t.title}`;
  });
  return [title, ...lines].join('\n');
}

function statusMarker(status: TodoStatus): string {
  switch (status) {
    case 'pending':
      return '[pending]';
    case 'in_progress':
      return '[in_progress]';
    case 'done':
      return '[done]';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export class TodoListTool implements BuiltinTool<TodoListInput> {
  readonly name = TODO_LIST_TOOL_NAME;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TodoListInputSchema);

  constructor(private readonly store: ToolStore) {}

  resolveExecution(args: TodoListInput): ToolExecution {
    const description =
      args.todos === undefined
        ? 'Reading todo list'
        : args.todos.length === 0
          ? 'Clearing todo list'
          : 'Updating todo list';
    return {
      description,
      approvalRule: this.name,
      execute: async () => {
        // Query mode — return the current list without mutation.
        if (args.todos === undefined) {
          const current = this.getTodos();
          return { isError: false, output: renderTodoList(current) };
        }

        // Write mode — replace the full list and return the new state.
        const previous = this.getTodos();
        this.setTodos(args.todos);
        const stored = this.getTodos();
        const changes = renderTodoListChangeSummary(previous, stored);
        const output =
          stored.length === 0
            ? 'Todo list cleared.'
            : `Todo list updated.\n${renderTodoList(stored)}${changes}\n\n${TODO_LIST_WRITE_REMINDER}`;
        return { isError: false, output };
      },
    };
  }

  private getTodos(): readonly TodoItem[] {
    const todos = this.store.get(TODO_STORE_KEY);
    return todos ?? [];
  }

  private setTodos(todos: readonly TodoItem[]): void {
    this.store.set(
      TODO_STORE_KEY,
      todos.map((todo) => ({ title: todo.title, status: todo.status })),
    );
  }
}

function renderTodoListChangeSummary(
  previous: readonly TodoItem[],
  next: readonly TodoItem[],
): string {
  const summary = todoListChangeSummary(previous, next);
  const parts: string[] = [];
  if (summary.added > 0) parts.push(`${summary.added} added`);
  if (summary.completed > 0) parts.push(`${summary.completed} completed`);
  if (summary.moved > 0) parts.push(`${summary.moved} moved`);
  if (summary.reopened > 0) parts.push(`${summary.reopened} reopened`);
  if (summary.removed > 0) parts.push(`${summary.removed} removed`);
  if (summary.reordered) parts.push('reordered');
  const hygiene = todoListHygieneNote(next);
  if (parts.length === 0 && hygiene.length === 0) return '';

  const lines: string[] = [];
  if (parts.length > 0) lines.push(`Changes: ${parts.join(', ')}.`);
  if (hygiene.length > 0) lines.push(`Kanban hygiene: ${hygiene}`);
  return `\n${lines.join('\n')}`;
}

function todoListChangeSummary(
  previous: readonly TodoItem[],
  next: readonly TodoItem[],
): {
  readonly added: number;
  readonly completed: number;
  readonly moved: number;
  readonly reopened: number;
  readonly removed: number;
  readonly reordered: boolean;
} {
  const previousByTitle = todoMap(previous);
  const nextByTitle = todoMap(next);
  let added = 0;
  let completed = 0;
  let moved = 0;
  let reopened = 0;
  let removed = 0;

  for (const todo of next) {
    const before = previousByTitle.get(todo.title);
    if (before === undefined) {
      added += 1;
      continue;
    }
    if (before.status === todo.status) continue;
    if (todo.status === 'done') completed += 1;
    else if (before.status === 'done') reopened += 1;
    else moved += 1;
  }

  for (const todo of previous) {
    if (!nextByTitle.has(todo.title)) removed += 1;
  }

  const reordered =
    added === 0 &&
    removed === 0 &&
    previous.length === next.length &&
    previous.some((todo, index) => next[index]?.title !== todo.title);

  return { added, completed, moved, reopened, removed, reordered };
}

function todoMap(todos: readonly TodoItem[]): Map<string, TodoItem> {
  return new Map(todos.map((todo) => [todo.title, todo]));
}

function todoListHygieneNote(todos: readonly TodoItem[]): string {
  const inProgress = todos.filter((todo) => todo.status === 'in_progress').length;
  if (inProgress > 1) {
    return 'more than one card is in_progress; collapse WIP unless real parallel work is active.';
  }
  if (todos.length > 9) {
    return 'the board is getting large; prune obsolete cards or group low-value pending work.';
  }
  return '';
}

const SWARM_ORCHESTRATION_PREFIX = '[swarm] ';

export function swarmOrchestrationCardTitle(item: string): string {
  return `${SWARM_ORCHESTRATION_PREFIX}${item}`;
}

export function seedSwarmOrchestrationTodos(
  store: ToolStore,
  items: readonly string[],
): void {
  const existing = store.get(TODO_STORE_KEY) ?? [];
  const existingTitles = new Set(existing.map((todo) => todo.title));
  const newCards = items
    .filter((item) => !existingTitles.has(swarmOrchestrationCardTitle(item)))
    .map((item) => ({ title: swarmOrchestrationCardTitle(item), status: 'pending' as const }));
  if (newCards.length === 0) return;
  store.set(TODO_STORE_KEY, [...existing, ...newCards]);
}

export function updateSwarmOrchestrationTodoStatus(
  store: ToolStore,
  item: string,
  status: TodoStatus,
): void {
  const title = swarmOrchestrationCardTitle(item);
  const todos = store.get(TODO_STORE_KEY) ?? [];
  const index = todos.findIndex((todo) => todo.title === title);
  if (index === -1) return;
  store.set(
    TODO_STORE_KEY,
    todos.map((todo, i) => (i === index ? { title: todo.title, status } : todo)),
  );
}
