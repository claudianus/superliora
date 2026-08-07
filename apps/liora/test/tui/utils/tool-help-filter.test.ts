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
      tool('Review'),
      tool('LioraReview', 'advanced'),
      tool('CreateGoal'),
    ];
    expect(filterToolsForPrimaryHelp(catalog).map((entry) => entry.name)).toEqual([
      'Expand',
      'Review',
      'CreateGoal',
    ]);
    expect(listHiddenCompatAliases(catalog)).toEqual(['LioraReview→Review']);
  });

  it('drops an advanced tool with no preferred mapping and lists it unaliased', () => {
    const catalog: ToolInfo[] = [tool('TaskGraph'), tool('LegacyGraph', 'advanced')];
    expect(filterToolsForPrimaryHelp(catalog).map((entry) => entry.name)).toEqual(['TaskGraph']);
    expect(listHiddenCompatAliases(catalog)).toEqual(['LegacyGraph']);
  });

});
