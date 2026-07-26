import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import type { ToolInfo } from '../../src/agent/tool';
import { SearchToolsTool } from '../../src/tools/builtin/collaboration/search-tools';

function agentWithTools(tools: readonly ToolInfo[]): Agent {
  return {
    tools: {
      data: () => tools,
    },
  } as unknown as Agent;
}

describe('SearchToolsTool', () => {
  const sample: ToolInfo[] = [
    { name: 'Read', description: 'Read a file', active: true, source: 'builtin' },
    { name: 'WebSearch', description: 'Search the web for current facts', active: true, source: 'builtin' },
    { name: 'SearchSkill', description: 'Search skill catalog', active: true, source: 'builtin' },
    { name: 'InactiveThing', description: 'Not active', active: false, source: 'user' },
  ];

  it('lists active tools when query is empty', async () => {
    const tool = new SearchToolsTool(agentWithTools(sample));
    const exec = tool.resolveExecution({});
    expect(exec.isError).toBeUndefined();
    if (exec.isError) return;
    const result = await exec.execute();
    expect(result.isError).toBeUndefined();
    expect(result.output).toContain('WebSearch');
    expect(result.output).toContain('active_total="3"');
    expect(result.output).not.toContain('InactiveThing');
  });

  it('filters by query and ranks exact name first', async () => {
    const tool = new SearchToolsTool(agentWithTools(sample));
    const exec = tool.resolveExecution({ query: 'search' });
    if (exec.isError) throw new Error('unexpected parse error');
    const result = await exec.execute();
    expect(result.output).toContain('WebSearch');
    expect(result.output).toContain('SearchSkill');
    expect(result.output).not.toContain('Read');
  });

  it('includes inactive when active_only=false', async () => {
    const tool = new SearchToolsTool(agentWithTools(sample));
    const exec = tool.resolveExecution({ query: 'Inactive', active_only: false });
    if (exec.isError) throw new Error('unexpected parse error');
    const result = await exec.execute();
    expect(result.output).toContain('InactiveThing');
  });
});
