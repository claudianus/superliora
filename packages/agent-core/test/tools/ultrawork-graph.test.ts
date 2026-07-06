import type { WorkGraph } from '@superliora/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import { parseWorkGraphNodesFromPlan } from '../../src/agent/plan/work-graph-from-plan';
import {
  TODO_STORE_KEY,
  type TodoItem,
} from '../../src/tools/builtin/state/todo-list';
import {
  ULTRAWORK_GRAPH_STORE_KEY,
  type UltraworkGraphInput,
  UltraworkGraphInputSchema,
  UltraworkGraphTool,
} from '../../src/tools/builtin/state/ultrawork-graph';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../src/tools/store';
import { executeTool } from './fixtures/execute-tool';

const signal = new AbortController().signal;

function makeStore(): {
  store: ToolStore;
  data: Partial<ToolStoreData>;
} {
  const data: Partial<ToolStoreData> = {};
  return {
    data,
    store: {
      get<K extends ToolStoreKey>(key: K): ToolStoreData[K] | undefined {
        return data[key];
      },
      set<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
        data[key] = value;
      },
    },
  };
}

function makeTool(): {
  tool: UltraworkGraphTool;
  data: Partial<ToolStoreData>;
  emitEvent: ReturnType<typeof vi.fn>;
} {
  const { store, data } = makeStore();
  const emitEvent = vi.fn();
  const agent = {
    emitEvent,
    ultrawork: {
      getRun: () => null,
      syncWorkGraphFromStore: vi.fn(),
    },
  } as unknown as Agent;
  return { tool: new UltraworkGraphTool(store, agent), data, emitEvent };
}

type WorkGraphInputNode = NonNullable<UltraworkGraphInput['nodes']>[number];

function node(overrides: Partial<WorkGraphInputNode> = {}): WorkGraphInputNode {
  return {
    id: 'ac_1',
    title: 'Implement WorkGraph',
    stage: 'swarm',
    status: 'queued',
    ...overrides,
  };
}

describe('UltraworkGraphTool', () => {
  it('has the current schema and supports query mode', async () => {
    const { tool } = makeTool();

    expect(tool.name).toBe('UltraworkGraph');
    expect(tool.description).toContain('WorkGraph');
    expect(UltraworkGraphInputSchema.safeParse({}).success).toBe(true);

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_1',
      args: {},
      signal,
    });

    expect(result).toEqual({ isError: false, output: 'Ultrawork graph is empty.' });
  });

  it('writes the graph, syncs TodoList, emits changed node events, and defensively copies', async () => {
    const { tool, data, emitEvent } = makeTool();
    const first = node({
      kind: 'implementation',
      acceptanceCriterionId: 'AC-1',
      laneId: 'implementation',
      requiredEvidence: ['unit test'],
    });
    const nodes = [first];

    const result = await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_1',
      args: {
        run_id: 'uw_1',
        graph_id: 'wg_1',
        root_goal: 'Ship the harness',
        nodes,
      },
      signal,
    });
    nodes[0] = node({ id: 'mutated', title: 'mutated' });

    expect(result).toMatchObject({ isError: false });
    expect(result.output).toContain('Ultrawork graph updated: 1 nodes, 1 task events.');
    expect((data[ULTRAWORK_GRAPH_STORE_KEY] as WorkGraph).nodes[0]?.id).toBe('ac_1');
    expect(data[TODO_STORE_KEY] as readonly TodoItem[]).toEqual([
      { title: '[ac_1] Implement WorkGraph', status: 'pending' },
    ]);
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'ultrawork.task.assigned',
      runId: 'uw_1',
      task: expect.objectContaining({ id: 'ac_1', status: 'queued' }),
    });
  });

  it('rejects duplicate ids, self dependencies, and missing dependencies', async () => {
    const { tool } = makeTool();

    await expect(
      executeTool(tool, {
        turnId: 't1',
        toolCallId: 'call_1',
        args: { run_id: 'uw_1', nodes: [node(), node({ title: 'Duplicate' })] },
        signal,
      }),
    ).resolves.toMatchObject({ isError: true, output: 'Duplicate WorkGraph node id: ac_1' });

    await expect(
      executeTool(tool, {
        turnId: 't1',
        toolCallId: 'call_2',
        args: { run_id: 'uw_1', nodes: [node({ dependsOn: ['ac_1'] })] },
        signal,
      }),
    ).resolves.toMatchObject({
      isError: true,
      output: 'WorkGraph node ac_1 cannot depend on itself.',
    });

    await expect(
      executeTool(tool, {
        turnId: 't1',
        toolCallId: 'call_3',
        args: { run_id: 'uw_1', nodes: [node({ dependsOn: ['missing'] })] },
        signal,
      }),
    ).resolves.toMatchObject({
      isError: true,
      output: 'WorkGraph node ac_1 depends on missing node missing.',
    });
  });

  it('emits events only for new nodes or task-relevant changes', async () => {
    const { tool, emitEvent } = makeTool();

    await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_1',
      args: { run_id: 'uw_1', nodes: [node()] },
      signal,
    });
    emitEvent.mockClear();

    await executeTool(tool, {
      turnId: 't1',
      toolCallId: 'call_2',
      args: {
        run_id: 'uw_1',
        nodes: [node({ status: 'running', evidenceIds: ['evidence_1'] })],
      },
      signal,
    });

    expect(emitEvent).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith({
      type: 'ultrawork.task.assigned',
      runId: 'uw_1',
      task: expect.objectContaining({
        id: 'ac_1',
        status: 'running',
        evidenceIds: ['evidence_1'],
      }),
    });
  });
});

describe('parseWorkGraphNodesFromPlan', () => {
  it('parses markdown table rows from the WorkGraph section', () => {
    const plan = [
      '## WorkGraph',
      '| Node ID | AC ID | Stage | Owner/Lane | Dependencies | Required Evidence |',
      '| ac_1 | AC-1 | swarm | main/implementation | none | focused test evidence |',
      '| ac_2 | AC-2 | verify | qa/review | ac_1 | screenshot evidence |',
      '',
      '## Swarm Decision',
    ].join('\n');

    expect(parseWorkGraphNodesFromPlan(plan)).toEqual([
      expect.objectContaining({
        id: 'ac_1',
        acceptanceCriterionId: 'AC-1',
        stage: 'swarm',
        laneId: 'implementation',
        requiredEvidence: ['focused test evidence'],
      }),
      expect.objectContaining({
        id: 'ac_2',
        acceptanceCriterionId: 'AC-2',
        stage: 'verify',
        laneId: 'review',
        dependsOn: ['ac_1'],
        requiredEvidence: ['screenshot evidence'],
      }),
    ]);
  });

  it('returns undefined when the WorkGraph section has no parseable nodes', () => {
    expect(parseWorkGraphNodesFromPlan('## WorkGraph\nNo nodes yet.')).toBeUndefined();
  });
});
