import type { ToolInfo } from '@superliora/sdk';

/** Mirrors agent-core COMPAT_BRANDING_TOOL_HELP — TUI cannot import agent-core. */
const COMPAT_PREFERRED: Readonly<Record<string, string>> = {
  LioraReview: 'Review',
};

/** Primary /tools inventory — hide advanced compat when the public tool is registered. */
export function filterToolsForPrimaryHelp(tools: readonly ToolInfo[]): ToolInfo[] {
  return tools.filter((tool) => {
    if (tool.helpVisibility !== 'advanced') return true;
    const preferred = COMPAT_PREFERRED[tool.name];
    if (preferred === undefined) return false;
    return !tools.some((entry) => entry.name === preferred);
  });
}

export function listHiddenCompatAliases(tools: readonly ToolInfo[]): string[] {
  const visible = new Set(filterToolsForPrimaryHelp(tools).map((tool) => tool.name));
  return tools
    .filter((tool) => !visible.has(tool.name) && tool.helpVisibility === 'advanced')
    .map((tool) => {
      const preferred = COMPAT_PREFERRED[tool.name];
      return preferred !== undefined ? `${tool.name}→${preferred}` : tool.name;
    })
    .toSorted((a, b) => a.localeCompare(b));
}
