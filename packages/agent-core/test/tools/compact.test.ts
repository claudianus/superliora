import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent/index';
import { CompactTool } from '../../src/tools/builtin/context/compact';

function makeAgent(compaction: { isCompacting: boolean; begin: ReturnType<typeof vi.fn> }): Agent {
  return {
    fullCompaction: Object.assign(compaction, {
      getEffectiveMaxContextTokens: () => 200_000,
    }),
    context: {
      tokenCountWithPending: 96_000,
      history: [],
    },
  } as unknown as Agent;
}

describe('CompactTool', () => {
  it('starts background compaction with the agent source', async () => {
    const compaction = {
      isCompacting: false,
      begin: vi.fn((_: { source: string; instruction?: string }) => {
        compaction.isCompacting = true;
      }),
    };
    const tool = new CompactTool(makeAgent(compaction));

    const result = await tool
      .resolveExecution({ instruction: 'keep the fix plan' })
      .execute();

    expect(compaction.begin).toHaveBeenCalledWith({
      source: 'agent',
      instruction: 'keep the fix plan',
    });
    expect(result.isError !== true).toBe(true);
    expect(result.output).toMatch(/started in the background/i);
  });

  it('reports when compaction is already in progress', async () => {
    const compaction = { isCompacting: true, begin: vi.fn() };
    const tool = new CompactTool(makeAgent(compaction));

    const result = await tool.resolveExecution({}).execute();

    expect(compaction.begin).not.toHaveBeenCalled();
    expect(result.output).toMatch(/already in progress/i);
  });

  it('reports when there is nothing compactable', async () => {
    // begin() no-ops when the history has no compactable prefix.
    const compaction = { isCompacting: false, begin: vi.fn() };
    const tool = new CompactTool(makeAgent(compaction));

    const result = await tool.resolveExecution({}).execute();

    expect(result.output).toMatch(/Nothing to compact/i);
  });

  it('status reports token usage vs the context limit', async () => {
    const compaction = { isCompacting: false, begin: vi.fn() };
    const tool = new CompactTool(makeAgent(compaction));

    const result = await tool.resolveExecution({ action: 'status' }).execute();

    expect(compaction.begin).not.toHaveBeenCalled();
    expect(result.output).toContain('96000 / 200000 (48%)');
    expect(result.output).toMatch(/Compaction in progress: no/);
    expect(result.output).toMatch(/Compacted before: no/);
  });

  it('status reflects an in-progress compaction and a prior summary', async () => {
    const compaction = { isCompacting: true, begin: vi.fn() };
    const agent = makeAgent(compaction);
    (agent.context.history as unknown[]).push({ origin: { kind: 'compaction_summary' } });
    const tool = new CompactTool(agent);

    const result = await tool.resolveExecution({ action: 'status' }).execute();

    expect(result.output).toMatch(/Compaction in progress: yes/);
    expect(result.output).toMatch(/Compacted before: yes/);
  });
});
