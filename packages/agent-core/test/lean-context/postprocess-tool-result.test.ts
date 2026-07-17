import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import { postprocessLeanToolResult } from '../../src/lean-context/postprocess/tool-result';
import type { ToolStore, ToolStoreData, ToolStoreKey } from '../../src/tools/store';

function makeStore(): ToolStore {
  const data: Partial<ToolStoreData> = {};
  return {
    get<K extends ToolStoreKey>(key: K): ToolStoreData[K] | undefined {
      return data[key];
    },
    set<K extends ToolStoreKey>(key: K, value: ToolStoreData[K]): void {
      data[key] = value;
    },
  } as ToolStore;
}

function makeAgent(store: ToolStore): Agent {
  return {
    tools: { getStore: () => store },
    config: { modelCapabilities: { max_context_tokens: 200_000 } },
    context: { tokenCountWithPending: 10_000 },
  } as unknown as Agent;
}

describe('postprocessLeanToolResult', () => {
  it('archives Grep overflow above 25 lines while keeping head/tail', async () => {
    const store = makeStore();
    const agent = makeAgent(store);
    const lines = Array.from({ length: 40 }, (_, i) => `match-${String(i)}: ok`);
    const result = await postprocessLeanToolResult({
      agent,
      toolName: 'Grep',
      args: { pattern: 'ok' },
      result: { output: lines.join('\n') },
    });
    const output = String(result.output);
    expect(output).toContain('match-0: ok');
    expect(output).toContain('match-39: ok');
    expect(output).toContain('lines archived');
    expect(output).toContain('[liora-archived id=');
    expect(output).toContain('LioraExpand');
    expect(output).not.toContain('match-25: ok');
  });

  it('leaves short Grep output intact', async () => {
    const store = makeStore();
    const agent = makeAgent(store);
    const lines = Array.from({ length: 20 }, (_, i) => `match-${String(i)}`);
    const result = await postprocessLeanToolResult({
      agent,
      toolName: 'Grep',
      args: { pattern: 'm' },
      result: { output: lines.join('\n') },
    });
    expect(result.output).toBe(lines.join('\n'));
  });
});
