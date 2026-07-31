import { describe, expect, it } from 'vitest';

import type { ToolInfo } from '@superliora/sdk';

import {
  filterToolsForPrimaryHelp,
  listHiddenCompatAliases,
} from '#/tui/utils/tool/tool-help-filter';

function tool(name: string, helpVisibility: ToolInfo['helpVisibility'] = 'primary'): ToolInfo {
  return {
    name,
    description: `${name} desc`,
    active: true,
    source: 'builtin',
    helpVisibility,
  };
}

describe('tool-help-filter', () => {
  it('hides advanced compat tools when preferred names are present', () => {
    const catalog: ToolInfo[] = [
      tool('Expand'),
      tool('LioraExpand', 'advanced'),
      tool('Review'),
      tool('LioraReview', 'advanced'),
      tool('CreateGoal'),
      tool('CreateUltraGoal', 'advanced'),
    ];
    expect(filterToolsForPrimaryHelp(catalog).map((entry) => entry.name)).toEqual([
      'Expand',
      'Review',
      'CreateGoal',
    ]);
    expect(listHiddenCompatAliases(catalog)).toEqual([
      'CreateUltraGoal→CreateGoal',
      'LioraExpand→Expand',
      'LioraReview→Review',
    ]);
  });

  it('hides UltraSwarm from primary /tools when Fleet is registered', () => {
    const catalog: ToolInfo[] = [tool('Fleet'), tool('UltraSwarm', 'advanced')];
    expect(filterToolsForPrimaryHelp(catalog).map((entry) => entry.name)).toEqual(['Fleet']);
    expect(listHiddenCompatAliases(catalog)).toEqual(['UltraSwarm→Fleet']);
  });

  it('hides AgentSwarm from primary /tools when Fleet is registered', () => {
    const catalog: ToolInfo[] = [tool('Fleet'), tool('AgentSwarm', 'advanced')];
    expect(filterToolsForPrimaryHelp(catalog).map((entry) => entry.name)).toEqual(['Fleet']);
    expect(listHiddenCompatAliases(catalog)).toEqual(['AgentSwarm→Fleet']);
  });

  it('hides UltraworkGraph from primary /tools when TaskGraph is registered', () => {
    const catalog: ToolInfo[] = [tool('TaskGraph'), tool('UltraworkGraph', 'advanced')];
    expect(filterToolsForPrimaryHelp(catalog).map((entry) => entry.name)).toEqual(['TaskGraph']);
    expect(listHiddenCompatAliases(catalog)).toEqual(['UltraworkGraph→TaskGraph']);
  });
});
