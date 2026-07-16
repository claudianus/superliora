/**
 * Covers the current TodoListTool contract.
 *
 * The todo state now lives in the agent tool store. The tool returns a
 * user-readable string in `output` and persists structured todos through
 * the injected store.
 */

import { describe, expect, it } from 'vitest';

import {
  TODO_LIST_TOOL_NAME,
  TODO_STORE_KEY,
  TodoListInputSchema,
  TodoListTool,
  seedSwarmOrchestrationTodos,
  updateSwarmOrchestrationTodoStatus,
  type TodoItem,
} from '../../src/tools/builtin/state/todo-list';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../src/tools/store';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function makeStore(initial: readonly TodoItem[] = []): {
  store: ToolStore;
  getTodos(): readonly TodoItem[];
} {
  let todos = [...initial];
  return {
    store: {
      get<K extends ToolStoreKey>(key: K): ToolStoreData[K] | undefined {
        return key === TODO_STORE_KEY ? (todos as unknown as ToolStoreData[K]) : undefined;
      },
      set<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
        if (key === TODO_STORE_KEY) {
          todos = [...(value as readonly TodoItem[])];
        }
      },
    },
    getTodos: () => todos,
  };
}

function makeTool(initial: readonly TodoItem[] = []): {
  tool: TodoListTool;
  getTodos(): readonly TodoItem[];
} {
  const { store, getTodos } = makeStore(initial);
  return { tool: new TodoListTool(store), getTodos };
}

describe('TodoListTool', () => {
  it('has name, description, and parameters from the current schema', () => {
    const { tool } = makeTool();

    expect(TODO_LIST_TOOL_NAME).toBe('TodoList');
    expect(TODO_STORE_KEY).toBe('todo');
    expect(tool.name).toBe(TODO_LIST_TOOL_NAME);
    expect(tool.description.length).toBeGreaterThan(0);
    // Plan-mode planning goes to the plan file, not the TodoList — the description
    // must not present TodoList as the plan-mode mechanism.
    expect(tool.description).toContain('plan file');
    // Query mode triggers on `args.todos === undefined`, not on zero args.
    expect(tool.description).toContain('no `todos` argument');
    // Heavy in plan/ultrawork — keep description under a hard size budget.
    expect(tool.description.length).toBeLessThan(1650);
    expect(TodoListInputSchema.safeParse({}).success).toBe(true);
    expect(
      TodoListInputSchema.safeParse({ todos: [{ title: 'x', status: 'wip' }] }).success,
    ).toBe(false);
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: {
        todos: { type: 'array' },
      },
    });
  });

  it('description includes an Avoid churn section with the anti-spin guardrails', () => {
    const { tool } = makeTool();
    const { description } = tool;

    expect(description).toContain('**Avoid churn:**');
    // (1) do not re-call the tool when nothing meaningful changed between calls.
    expect(description).toMatch(/nothing meaningful changed/i);
    expect(description).toMatch(/scope or priority change/i);
    // (2) when unsure of the current state, use query mode first.
    expect(description).toMatch(/query mode/i);
    // (3) when stuck, tell the user instead of repeatedly re-ordering todos.
    expect(description).toMatch(/tell the user/i);
  });

  it('description encourages proactive progress updates without allowing churn', () => {
    const { tool } = makeTool();
    const { description } = tool;

    expect(description).toMatch(/proactively/i);
    expect(description).toMatch(/immediately after finishing/i);
    expect(description).toMatch(/exactly one/i);
    expect(description).toMatch(/in_progress/i);
    expect(description).toMatch(/tests are failing/i);
    expect(description).toContain('**Avoid churn:**');
  });

  it('query mode renders the current list without mutating it', async () => {
    const { tool, getTodos } = makeTool([{ title: 'existing', status: 'in_progress' }]);

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_1',
      args: {},
      signal,
    });

    expect(result).toMatchObject({ isError: false });
    expect(result.output).toContain('Current todo list');
    expect(result.output).toContain('[in_progress] existing');
    expect(getTodos()).toEqual([{ title: 'existing', status: 'in_progress' }]);
  });

  it('write mode replaces the list and defensively copies todos into the store', async () => {
    const { tool, getTodos } = makeTool();
    const todos: TodoItem[] = [
      { title: 'first', status: 'pending' },
      { title: 'second', status: 'in_progress' },
    ];

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_1',
      args: { todos },
      signal,
    });
    todos[0] = { title: 'leaked', status: 'done' };

    expect(result).toMatchObject({ isError: false });
    expect(result.output).toContain('Todo list updated');
    expect(result.output).toContain('[pending] first');
    expect(result.output).toContain('[in_progress] second');
    expect(result.output).toContain('Changes: 2 added.');
    expect(result.output).toContain('Keep this Kanban live');
    expect(result.output).toContain('one in_progress');
    expect(getTodos()).toEqual([
      { title: 'first', status: 'pending' },
      { title: 'second', status: 'in_progress' },
    ]);
  });

  it('summarizes live Kanban changes on replacement writes', async () => {
    const { tool } = makeTool([
      { title: 'Read code', status: 'in_progress' },
      { title: 'Patch parser', status: 'pending' },
      { title: 'Remove stale branch', status: 'pending' },
    ]);

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_1',
      args: {
        todos: [
          { title: 'Read code', status: 'done' },
          { title: 'Patch parser', status: 'in_progress' },
          { title: 'Add regression test', status: 'pending' },
        ],
      },
      signal,
    });

    expect(result).toMatchObject({ isError: false });
    expect(result.output).toContain('Changes: 1 added, 1 completed, 1 moved, 1 removed.');
  });

  it('warns when replacement writes exceed the in-progress WIP limit', async () => {
    const { tool } = makeTool();

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_1',
      args: {
        todos: [
          { title: 'Patch parser', status: 'in_progress' },
          { title: 'Run tests', status: 'in_progress' },
        ],
      },
      signal,
    });

    expect(result).toMatchObject({ isError: false });
    expect(result.output).toContain('Kanban hygiene: more than one card is in_progress');
  });

  it('renders a done todo with a marker matching the status enum value', async () => {
    const { tool } = makeTool([{ title: 'shipped', status: 'done' }]);

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_1',
      args: {},
      signal,
    });

    expect(result).toMatchObject({ isError: false });
    expect(result.output).toContain('[done] shipped');
    expect(result.output).not.toContain('[completed]');
  });

  it('clear mode empties the list', async () => {
    const { tool, getTodos } = makeTool([{ title: 'x', status: 'pending' }]);

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_1',
      args: { todos: [] },
      signal,
    });

    expect(result).toMatchObject({ isError: false, output: 'Todo list cleared.' });
    expect(getTodos()).toEqual([]);
  });

  it('clear mode does not add the progress-tracking reminder', async () => {
    const { tool } = makeTool([{ title: 'x', status: 'pending' }]);

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_1',
      args: { todos: [] },
      signal,
    });

    expect(result).toMatchObject({ isError: false, output: 'Todo list cleared.' });
  });

  it('resolveExecution description reflects the mode', () => {
    const { tool } = makeTool();
    const readExecution = tool.resolveExecution({});
    const clearExecution = tool.resolveExecution({ todos: [] });
    const updateExecution = tool.resolveExecution({ todos: [{ title: 'x', status: 'pending' }] });

    expect(readExecution.isError).toBeFalsy();
    expect(clearExecution.isError).toBeFalsy();
    expect(updateExecution.isError).toBeFalsy();
    if (
      readExecution.isError === true ||
      clearExecution.isError === true ||
      updateExecution.isError === true
    ) {
      throw new TypeError('expected runnable executions');
    }
    expect(readExecution.description).toBe('Reading todo list');
    expect(clearExecution.description).toBe('Clearing todo list');
    expect(updateExecution.description).toBe('Updating todo list');
  });

  it('rejects malformed args with a self-correcting message instead of crashing', () => {
    // Regression: the model sometimes emits items missing `title`, carrying an
    // invalid `status` (e.g. "default"/"wip"), or smuggling extra fields. The
    // AJV preflight rejects these, but a friendly runtime guard stops the model
    // from looping on the same shape mistake if it ever reaches resolveExecution.
    const { tool, getTodos } = makeTool([{ title: 'existing', status: 'pending' }]);

    // (1) invalid status value — "default" / "wip" / "completed" are not accepted.
    const badStatus = tool.resolveExecution({
      todos: [{ title: 'x', status: 'default' as unknown as 'pending' }],
    });
    expect(badStatus.isError).toBe(true);
    if (badStatus.isError !== true) throw new TypeError('expected error result');
    expect(badStatus.output).toContain('Invalid TodoList args');
    // The message must teach the correct shape so the model can self-correct.
    expect(badStatus.output).toContain('"pending" | "in_progress" | "done"');

    // (2) item missing `title`.
    const missingTitle = tool.resolveExecution({
      todos: [{ status: 'pending' } as unknown as { title: string; status: 'pending' }],
    });
    expect(missingTitle.isError).toBe(true);
    if (missingTitle.isError !== true) throw new TypeError('expected error result');
    expect(missingTitle.output).toContain('"title"');

    // (3) extra field smuggled in (e.g. a hallucinated `priority`).
    const extraField = tool.resolveExecution({
      todos: [
        { title: 'x', status: 'pending', priority: 'high' } as unknown as {
          title: string;
          status: 'pending';
        },
      ],
    });
    expect(extraField.isError).toBe(true);
    if (extraField.isError !== true) throw new TypeError('expected error result');
    expect(extraField.output).toContain('no other fields');

    // The store must be untouched on rejection — no partial clobbering.
    expect(getTodos()).toEqual([{ title: 'existing', status: 'pending' }]);
  });

  it('seeds swarm orchestration cards without duplicating existing titles', () => {
    const { store, getTodos } = makeStore([
      { title: '[swarm] auth module', status: 'done' },
    ]);
    seedSwarmOrchestrationTodos(store, ['auth module', 'ui polish']);

    expect(getTodos()).toEqual([
      { title: '[swarm] auth module', status: 'done' },
      { title: '[swarm] ui polish', status: 'pending' },
    ]);
  });

  it('updates swarm orchestration card status by item text', () => {
    const { store, getTodos } = makeStore([
      { title: '[swarm] auth module', status: 'pending' },
    ]);
    updateSwarmOrchestrationTodoStatus(store, 'auth module', 'in_progress');
    updateSwarmOrchestrationTodoStatus(store, 'auth module', 'done');

    expect(getTodos()).toEqual([{ title: '[swarm] auth module', status: 'done' }]);
  });
});
