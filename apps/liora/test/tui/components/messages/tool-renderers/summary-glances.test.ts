import { describe, expect, it } from 'vitest';

import {
  grepGlance,
  webSearchGlance,
} from '#/tui/components/messages/tool-renderers/summary-glances';
import type { ToolCallBlockData, ToolResultBlockData } from '#/tui/types';

function call(name: string, args: Record<string, unknown> = {}): ToolCallBlockData {
  return { id: 'tc', name, args };
}

function toolResult(output: string): ToolResultBlockData {
  return { tool_call_id: 'tc', output, is_error: false };
}

describe('summary glances', () => {
  it('grepGlance strips line:col suffixes from sample paths', () => {
    const line = grepGlance(
      call('Grep', { pattern: 'foo' }),
      toolResult('src/a.ts:12:3:const foo = 1\nsrc/b.ts:4:1:foo()'),
    );
    expect(line).toContain('src/a.ts');
    expect(line).not.toContain(':12:');
  });

  it('webSearchGlance reports no results for empty search output', () => {
    expect(
      webSearchGlance(call('WebSearch'), toolResult('No search results found.')),
    ).toBe('no results');
  });
});
