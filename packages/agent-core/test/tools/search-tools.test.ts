import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import type { ToolInfo } from '../../src/agent/tool';
import {
  rankToolsBm25Lite,
  SearchToolsTool,
} from '../../src/tools/builtin/fleet/search-tools';

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

  it('hides advanced compat aliases from the default list when preferred tools exist', async () => {
    const compat: ToolInfo[] = [
      { name: 'Review', description: 'Review diff', active: true, source: 'builtin', helpVisibility: 'primary' },
      {
        name: 'LioraReview',
        description: 'Legacy review',
        active: true,
        source: 'builtin',
        helpVisibility: 'advanced',
      },
      { name: 'CreateGoal', description: 'Create goal', active: true, source: 'builtin', helpVisibility: 'primary' },
      {
        name: 'CreateUltraGoal',
        description: 'Legacy ultra goal',
        active: true,
        source: 'builtin',
        helpVisibility: 'advanced',
      },
    ];
    const tool = new SearchToolsTool(agentWithTools(compat));
    const exec = tool.resolveExecution({});
    if (exec.isError) throw new Error('unexpected parse error');
    const result = await exec.execute();
    expect(result.output).toContain('Review');
    expect(result.output).toContain('CreateGoal');
    expect(result.output).not.toContain('LioraReview');
    expect(result.output).not.toContain('CreateUltraGoal');
  });

  it('lists ApplyPatch in the primary default catalog when registered', async () => {
    const patchSurface: ToolInfo[] = [
      {
        name: 'ApplyPatch',
        description: 'Apply multi-file patches',
        active: true,
        source: 'builtin',
        helpVisibility: 'primary',
      },
      { name: 'Edit', description: 'Edit a file', active: true, source: 'builtin', helpVisibility: 'primary' },
      { name: 'Read', description: 'Read a file', active: true, source: 'builtin', helpVisibility: 'primary' },
    ];
    const tool = new SearchToolsTool(agentWithTools(patchSurface));
    const exec = tool.resolveExecution({});
    if (exec.isError) throw new Error('unexpected parse error');
    const result = await exec.execute();
    expect(result.output).toContain('ApplyPatch');
    expect(result.output).toContain('Edit');
  });

  it('lists DeepResearch in the primary default catalog when registered', async () => {
    const searchSurface: ToolInfo[] = [
      { name: 'WebSearch', description: 'Search the web', active: true, source: 'builtin', helpVisibility: 'primary' },
      {
        name: 'DeepResearch',
        description: 'Multi-hop web research',
        active: true,
        source: 'builtin',
        helpVisibility: 'primary',
      },
      { name: 'Read', description: 'Read a file', active: true, source: 'builtin', helpVisibility: 'primary' },
    ];
    const tool = new SearchToolsTool(agentWithTools(searchSurface));
    const exec = tool.resolveExecution({});
    if (exec.isError) throw new Error('unexpected parse error');
    const result = await exec.execute();
    expect(result.output).toContain('DeepResearch');
    expect(result.output).toContain('WebSearch');
  });

  it('still finds compat aliases when queried explicitly', async () => {
    const compat: ToolInfo[] = [
      { name: 'Review', description: 'Review diff', active: true, source: 'builtin', helpVisibility: 'primary' },
      {
        name: 'LioraReview',
        description: 'Legacy review',
        active: true,
        source: 'builtin',
        helpVisibility: 'advanced',
      },
    ];
    const tool = new SearchToolsTool(agentWithTools(compat));
    const exec = tool.resolveExecution({ query: 'LioraReview' });
    if (exec.isError) throw new Error('unexpected parse error');
    const result = await exec.execute();
    expect(result.output).toContain('LioraReview');
    expect(result.output).toContain('compat alias — prefer Review');
  });

  it('ranks multi-token semantic queries with BM25-lite over name+description', () => {
    const catalog: ToolInfo[] = [
      {
        name: 'Bash',
        description: 'Execute a bash command for shell semantics',
        active: true,
        source: 'builtin',
      },
      {
        name: 'WebSearch',
        description: 'Search the web for current facts via multi-provider research',
        active: true,
        source: 'builtin',
      },
      {
        name: 'ReadMediaFile',
        description: 'Read a UTF-8 text file? No — inspect image/video media bytes',
        active: true,
        source: 'builtin',
      },
      {
        name: 'RunProjectChecks',
        description: 'Discover and run project checks test typecheck build smoke lint',
        active: true,
        source: 'builtin',
      },
    ];
    const ranked = rankToolsBm25Lite(catalog, 'project typecheck lint');
    expect(ranked[0]?.name).toBe('RunProjectChecks');
    const mediaRanked = rankToolsBm25Lite(catalog, 'image media');
    expect(mediaRanked[0]?.name).toBe('ReadMediaFile');
  });

  it('still prefers exact tool name matches over description hits', () => {
    const catalog: ToolInfo[] = [
      {
        name: 'SearchSkill',
        description: 'Search skill catalog metadata',
        active: true,
        source: 'builtin',
      },
      {
        name: 'WebSearch',
        description: 'Search the web for current facts',
        active: true,
        source: 'builtin',
      },
      {
        name: 'Grep',
        description: 'Search file contents with ripgrep',
        active: true,
        source: 'builtin',
      },
    ];
    const ranked = rankToolsBm25Lite(catalog, 'websearch');
    expect(ranked[0]?.name).toBe('WebSearch');
  });
});
