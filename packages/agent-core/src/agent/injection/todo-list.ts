import type { ContextMessage } from '#/agent/context';
import {
  TODO_LIST_TOOL_NAME,
  TODO_STORE_KEY,
  type TodoItem,
  type TodoStatus,
} from '#/tools/builtin/state/todo-list';

import { DynamicInjector } from './injector';

const TODO_LIST_REMINDER_VARIANT = 'todo_list_reminder';
const TODO_LIST_REMINDER_TURNS_SINCE_WRITE = 2;
const TODO_LIST_REMINDER_CALLS_SINCE_WRITE = 3;
const TODO_LIST_REMINDER_TURNS_BETWEEN_REMINDERS = 3;
const TODO_LIST_REMINDER_CALLS_BETWEEN_REMINDERS = 5;

interface TodoListReminderCounts {
  readonly turnsSinceLastWrite: number;
  readonly callsSinceLastWrite: number;
  readonly turnsSinceLastReminder: number;
  readonly callsSinceLastReminder: number;
}

export class TodoListReminderInjector extends DynamicInjector {
  protected override readonly injectionVariant = TODO_LIST_REMINDER_VARIANT;

  protected override getInjection(): string | undefined {
    if (!this.isTodoListActive()) return undefined;

    const counts = getTodoListReminderCounts(this.agent.context.history);
    if (
      (counts.turnsSinceLastWrite < TODO_LIST_REMINDER_TURNS_SINCE_WRITE &&
        counts.callsSinceLastWrite < TODO_LIST_REMINDER_CALLS_SINCE_WRITE) ||
      (counts.turnsSinceLastReminder < TODO_LIST_REMINDER_TURNS_BETWEEN_REMINDERS &&
        counts.callsSinceLastReminder < TODO_LIST_REMINDER_CALLS_BETWEEN_REMINDERS)
    ) {
      return undefined;
    }

    return renderTodoListReminder(this.currentTodos());
  }

  private isTodoListActive(): boolean {
    return this.agent.tools.data().some((tool) => {
      return tool.name === TODO_LIST_TOOL_NAME && tool.active;
    });
  }

  private currentTodos(): readonly TodoItem[] {
    const raw = this.agent.tools.storeData()[TODO_STORE_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter(isTodoItem).map((todo) => ({
      title: todo.title,
      status: todo.status,
    }));
  }
}

function getTodoListReminderCounts(
  history: readonly ContextMessage[],
): TodoListReminderCounts {
  let foundWrite = false;
  let foundReminder = false;
  let turnsSinceLastWrite = 0;
  let callsSinceLastWrite = 0;
  let turnsSinceLastReminder = 0;
  let callsSinceLastReminder = 0;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message === undefined) continue;

    if (message.role === 'assistant') {
      const nonTodoCalls = countNonTodoToolCalls(message);
      if (!foundWrite) {
        if (hasTodoListWrite(message)) {
          foundWrite = true;
        } else {
          turnsSinceLastWrite += 1;
          callsSinceLastWrite += nonTodoCalls;
        }
      }
      if (!foundReminder) {
        turnsSinceLastReminder += 1;
        callsSinceLastReminder += nonTodoCalls;
      }
      continue;
    }

    if (!foundReminder && isTodoListReminder(message)) {
      foundReminder = true;
    }

    if (foundWrite && foundReminder) break;
  }

  return {
    turnsSinceLastWrite,
    callsSinceLastWrite,
    turnsSinceLastReminder: foundReminder ? turnsSinceLastReminder : Number.MAX_SAFE_INTEGER,
    callsSinceLastReminder: foundReminder ? callsSinceLastReminder : Number.MAX_SAFE_INTEGER,
  };
}

function countNonTodoToolCalls(message: ContextMessage): number {
  let count = 0;
  for (const toolCall of message.toolCalls) {
    if (toolCall.name !== TODO_LIST_TOOL_NAME) count += 1;
  }
  return count;
}

function hasTodoListWrite(message: ContextMessage): boolean {
  return message.toolCalls.some((toolCall) => {
    if (toolCall.name !== TODO_LIST_TOOL_NAME) return false;
    if (typeof toolCall.arguments !== 'string') return false;

    try {
      const args = JSON.parse(toolCall.arguments) as { todos?: unknown };
      return Array.isArray(args.todos);
    } catch {
      return false;
    }
  });
}

function isTodoListReminder(message: ContextMessage): boolean {
  return (
    message.origin?.kind === 'injection' && message.origin.variant === TODO_LIST_REMINDER_VARIANT
  );
}

function renderTodoListReminder(todos: readonly TodoItem[]): string {
  let message =
    'TodoList not updated recently. Live Kanban: add/split, drop obsolete pending, reorder next, mark done after verification. If 3+ tool calls since last write, update the board. Keep one in_progress unless true parallel work. If still accurate, do nothing. NEVER mention this reminder to the user.';

  const items = renderTodoItems(todos);
  if (items.length > 0) {
    message += `\n\nCurrent todo list:\n${items}`;
  }

  return message;
}

function renderTodoItems(todos: readonly TodoItem[]): string {
  return todos.map((todo, index) => `${index + 1}. [${todo.status}] ${todo.title}`).join('\n');
}

function isTodoItem(value: unknown): value is TodoItem {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['title'] === 'string' && isTodoStatus(record['status']);
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === 'pending' || value === 'in_progress' || value === 'done';
}
