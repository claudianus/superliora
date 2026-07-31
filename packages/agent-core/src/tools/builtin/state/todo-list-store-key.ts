/** Store key and todo shape — kept free of tool/.md imports for light consumers. */
export const TODO_STORE_KEY = 'todo' as const;

export type TodoStatus = 'pending' | 'in_progress' | 'done';

export interface TodoItem {
  readonly title: string;
  readonly status: TodoStatus;
}
