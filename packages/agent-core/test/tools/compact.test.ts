import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent/index';
import { CompactTool } from '../../src/tools/builtin/context/compact';

function makeAgent(compaction: {
  isCompacting: boolean;
  begin: ReturnType<typeof vi.fn>;
  waitUntilSettled?: ReturnType<typeof vi.fn>;
  tokenCount?: number;
}): Agent {
  let tokens = compaction.tokenCount ?? 96_000;
  const full = Object.assign(compaction, {
    getEffectiveMaxContextTokens: () => 200_000,
    waitUntilSettled:
      compaction.waitUntilSettled ??
      vi.fn(async () => {
        compaction.isCompacting = false;
        return true;
      }),
  });
  return {
    fullCompaction: full,
    context: {
      get tokenCountWithPending() {
        return tokens;
      },
      set tokenCountWithPending(value: number) {
        tokens = value;
      },
      history: [],
    },
  } as unknown as Agent;
}

describe('CompactTool', () => {
  it('awaits apply then reports reclaimed tokens', async () => {
    const compaction = {
      isCompacting: false,
      begin: vi.fn((_: { source: string; instruction?: string }) => {
        compaction.isCompacting = true;
      }),
      waitUntilSettled: vi.fn(async () => {
        compaction.isCompacting = false;
        return true;
      }),
    };
    const agent = makeAgent(compaction);
    compaction.waitUntilSettled = vi.fn(async () => {
      compaction.isCompacting = false;
      (agent.context as { tokenCountWithPending: number }).tokenCountWithPending = 40_000;
      return true;
    });
    // Re-bind after reassignment — makeAgent captured the first stub on fullCompaction.
    (agent.fullCompaction as { waitUntilSettled: typeof compaction.waitUntilSettled }).waitUntilSettled =
      compaction.waitUntilSettled;

    const tool = new CompactTool(agent);
    const result = await tool
      .resolveExecution({ instruction: 'keep the fix plan' })
      .execute();

    expect(compaction.begin).toHaveBeenCalledWith({
      source: 'agent',
      instruction: 'keep the fix plan',
    });
    expect(compaction.waitUntilSettled).toHaveBeenCalled();
    expect(result.isError !== true).toBe(true);
    expect(result.output).toMatch(/Compaction applied/i);
    expect(result.output).toMatch(/pendingApply=no/);
    expect(result.output).toContain('40000 / 200000');
  });

  it('awaits an already in-progress compaction', async () => {
    const compaction = {
      isCompacting: true,
      begin: vi.fn(),
      waitUntilSettled: vi.fn(async () => {
        compaction.isCompacting = false;
        return true;
      }),
    };
    const tool = new CompactTool(makeAgent(compaction));

    const result = await tool.resolveExecution({}).execute();

    expect(compaction.begin).not.toHaveBeenCalled();
    expect(compaction.waitUntilSettled).toHaveBeenCalled();
    expect(result.output).toMatch(/already in progress/i);
    expect(result.output).toMatch(/Compaction applied/i);
  });

  it('reports when there is nothing compactable', async () => {
    const compaction = { isCompacting: false, begin: vi.fn() };
    const tool = new CompactTool(makeAgent(compaction));

    const result = await tool.resolveExecution({}).execute();

    expect(result.output).toMatch(/Nothing to compact/i);
  });

  it('status reports token usage and pendingApply', async () => {
    const compaction = { isCompacting: false, begin: vi.fn() };
    const tool = new CompactTool(makeAgent(compaction));

    const result = await tool.resolveExecution({ action: 'status' }).execute();

    expect(compaction.begin).not.toHaveBeenCalled();
    expect(result.output).toContain('96000 / 200000 (48%)');
    expect(result.output).toMatch(/Compaction in progress: no/);
    expect(result.output).toMatch(/pendingApply: no/);
    expect(result.output).toMatch(/Compacted before: no/);
  });

  it('status reflects an in-progress compaction and a prior summary', async () => {
    const compaction = { isCompacting: true, begin: vi.fn() };
    const agent = makeAgent(compaction);
    (agent.context.history as unknown[]).push({ origin: { kind: 'compaction_summary' } });
    const tool = new CompactTool(agent);

    const result = await tool.resolveExecution({ action: 'status' }).execute();

    expect(result.output).toMatch(/Compaction in progress: yes/);
    expect(result.output).toMatch(/pendingApply: yes/);
    expect(result.output).toMatch(/Compacted before: yes/);
  });
});
