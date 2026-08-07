import { describe, expect, it } from 'vitest';

import {
  COMPAT_BRANDING_TOOL_HELP,
  filterToolsForPublicHelp,
  formatCompatToolHelpHint,
  resolveToolHelpVisibility,
  shouldIncludeToolInPublicHelp,
} from '../../../src/agent/tool/help-visibility';
import type { ToolInfo } from '../../../src/agent/tool';

function tool(name: string, active = true): ToolInfo {
  return {
    name,
    description: `${name} tool`,
    active,
    source: 'builtin',
    helpVisibility: resolveToolHelpVisibility(name),
  };
}

const PRIMARY_SOVEREIGN_TOOLS = ['Review', 'Expand', 'CreateGoal', 'RepoQuery', 'TaskGraph'] as const;
const PRIMARY_CORE_FILE_TOOLS = ['ApplyPatch'] as const;
const PRIMARY_SEARCH_TOOLS = ['WebSearch', 'DeepResearch'] as const;
const LIORA_COMPAT_TOOLS = ['LioraReview'] as const;

describe('tool help visibility', () => {
  it('marks sovereign public tools as primary', () => {
    for (const name of PRIMARY_SOVEREIGN_TOOLS) {
      expect(resolveToolHelpVisibility(name)).toBe('primary');
    }
  });

  it('marks ApplyPatch as primary when listed', () => {
    for (const name of PRIMARY_CORE_FILE_TOOLS) {
      expect(resolveToolHelpVisibility(name)).toBe('primary');
    }
    const catalog = [tool('ApplyPatch'), tool('Edit'), tool('Read')];
    const publicNames = filterToolsForPublicHelp(catalog).map((entry) => entry.name);
    expect(publicNames).toContain('ApplyPatch');
  });

  it('marks session search tools as primary (not WebSearch compat aliases)', () => {
    for (const name of PRIMARY_SEARCH_TOOLS) {
      expect(resolveToolHelpVisibility(name)).toBe('primary');
    }
    expect(COMPAT_BRANDING_TOOL_HELP).not.toHaveProperty('DeepResearch');
    expect(COMPAT_BRANDING_TOOL_HELP).not.toHaveProperty('WebSearch');
  });

  it('keeps DeepResearch in primary help when WebSearch is also registered', () => {
    const catalog = [tool('WebSearch'), tool('DeepResearch'), tool('Read')];
    const publicNames = filterToolsForPublicHelp(catalog).map((entry) => entry.name);
    expect(publicNames).toEqual(expect.arrayContaining(['WebSearch', 'DeepResearch']));
  });

  it('keeps LioraReview as the only branding-debt compat tool, marked advanced', () => {
    expect(Object.keys(COMPAT_BRANDING_TOOL_HELP).toSorted()).toEqual([...LIORA_COMPAT_TOOLS]);
    for (const name of Object.keys(COMPAT_BRANDING_TOOL_HELP)) {
      expect(resolveToolHelpVisibility(name)).toBe('advanced');
    }
  });

  it('hides compat aliases from primary help when preferred tools exist', () => {
    const catalog = [
      tool('Expand'),
      tool('Review'),
      tool('LioraReview'),
      tool('CreateGoal'),
      tool('RepoQuery'),
      tool('TodoList'),
      tool('TaskGraph'),
      tool('Fleet'),
      tool('Read'),
    ];
    const publicNames = filterToolsForPublicHelp(catalog).map((entry) => entry.name);
    expect(publicNames).toEqual(
      expect.arrayContaining([
        'Expand',
        'Review',
        'CreateGoal',
        'RepoQuery',
        'TodoList',
        'TaskGraph',
        'Read',
      ]),
    );
    for (const name of PRIMARY_SOVEREIGN_TOOLS) {
      expect(publicNames).toContain(name);
    }
    for (const name of LIORA_COMPAT_TOOLS) {
      expect(publicNames).not.toContain(name);
    }
    expect(publicNames).toContain('Fleet');
  });

  it('keeps compat tools in advanced help mode', () => {
    const catalog = [tool('Review'), tool('LioraReview')];
    expect(shouldIncludeToolInPublicHelp(tool('LioraReview'), catalog, 'advanced')).toBe(true);
  });

  it('surfaces compat hint for SearchTools hits', () => {
    expect(formatCompatToolHelpHint('LioraReview')).toBe('compat alias — prefer Review');
    expect(formatCompatToolHelpHint('TaskGraph')).toBeUndefined();
  });
});
