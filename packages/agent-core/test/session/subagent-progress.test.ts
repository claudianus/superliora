import { describe, expect, it } from 'vitest';

import { collectSubagentProgressStats } from '../../src/session/subagent/subagent-host';

const emptyUsage = { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 };

function fakeChild(history: unknown[], usage = emptyUsage) {
  return {
    context: { history },
    usage: { data: () => ({ total: usage }) },
  } as never;
}

describe('collectSubagentProgressStats', () => {
  it('counts tool calls and captures the last tool and target', () => {
    const child = fakeChild([
      { role: 'user', toolCalls: [] },
      {
        role: 'assistant',
        toolCalls: [
          { name: 'Read', arguments: JSON.stringify({ path: 'src/a.ts' }) },
          { name: 'Bash', arguments: JSON.stringify({ command: 'pnpm test' }) },
        ],
      },
    ]);
    const stats = collectSubagentProgressStats(child);
    expect(stats.toolCount).toBe(2);
    expect(stats.lastTool).toBe('Bash');
    expect(stats.lastTarget).toBe('pnpm test');
  });

  it('sums token usage across all buckets', () => {
    const child = fakeChild([], {
      inputOther: 1,
      output: 2,
      inputCacheRead: 3,
      inputCacheCreation: 4,
    });
    expect(collectSubagentProgressStats(child).tokens).toBe(10);
  });

  it('truncates long targets to 80 chars with an ellipsis', () => {
    const longPath = `${'x'.repeat(120)}.ts`;
    const child = fakeChild([
      {
        role: 'assistant',
        toolCalls: [{ name: 'Read', arguments: JSON.stringify({ path: longPath }) }],
      },
    ]);
    expect(collectSubagentProgressStats(child).lastTarget).toBe(`${'x'.repeat(80)}…`);
  });

  it('falls back to the raw argument snippet for invalid JSON', () => {
    const child = fakeChild([
      { role: 'assistant', toolCalls: [{ name: 'X', arguments: 'not-json' }] },
    ]);
    expect(collectSubagentProgressStats(child).lastTarget).toBe('not-json');
  });
});
