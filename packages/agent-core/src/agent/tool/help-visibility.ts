import type { ToolHelpVisibility, ToolInfo } from './types';

/** Legacy Ultra/Liora compat tools still registered; prefer sovereign public names. */
export const COMPAT_BRANDING_TOOL_HELP = {
  LioraExpand: { preferred: 'Expand', visibility: 'advanced' },
  LioraReview: { preferred: 'Review', visibility: 'advanced' },
  CreateUltraGoal: { preferred: 'CreateGoal', visibility: 'advanced' },
  UltraworkGraph: { preferred: 'TaskGraph', visibility: 'advanced' },
  UltraSwarm: { preferred: 'AgentSwarm', visibility: 'advanced' },
} as const satisfies Record<
  string,
  { readonly preferred: string; readonly visibility: ToolHelpVisibility }
>;

export type CompatBrandingToolName = keyof typeof COMPAT_BRANDING_TOOL_HELP;

export function resolveToolHelpVisibility(name: string): ToolHelpVisibility {
  return COMPAT_BRANDING_TOOL_HELP[name as CompatBrandingToolName]?.visibility ?? 'primary';
}

export function preferredPublicToolName(name: string): string | undefined {
  return COMPAT_BRANDING_TOOL_HELP[name as CompatBrandingToolName]?.preferred;
}

export function isCompatBrandingTool(name: string): name is CompatBrandingToolName {
  return name in COMPAT_BRANDING_TOOL_HELP;
}

/**
 * Primary help surfaces (/tools inventory, SearchTools default list) hide
 * advanced compat aliases when the preferred public tool is also registered.
 * Explicit SearchTools queries still surface compat names for discovery.
 */
export function shouldIncludeToolInPublicHelp(
  tool: Pick<ToolInfo, 'name' | 'active' | 'helpVisibility'>,
  allTools: readonly Pick<ToolInfo, 'name' | 'active' | 'helpVisibility'>[],
  mode: 'primary' | 'advanced' = 'primary',
): boolean {
  if (mode === 'advanced') return true;
  const visibility = tool.helpVisibility ?? resolveToolHelpVisibility(tool.name);
  if (visibility !== 'advanced') return true;
  const preferred = preferredPublicToolName(tool.name);
  if (preferred !== undefined) {
    const preferredActive = allTools.some((entry) => entry.name === preferred && entry.active);
    if (preferredActive) return false;
    const preferredRegistered = allTools.some((entry) => entry.name === preferred);
    if (preferredRegistered) return false;
  }
  return false;
}

export function filterToolsForPublicHelp<T extends Pick<ToolInfo, 'name' | 'active' | 'helpVisibility'>>(
  tools: readonly T[],
  mode: 'primary' | 'advanced' = 'primary',
): T[] {
  return tools.filter((tool) => shouldIncludeToolInPublicHelp(tool, tools, mode));
}

export function formatCompatToolHelpHint(name: string): string | undefined {
  const preferred = preferredPublicToolName(name);
  if (preferred === undefined) return undefined;
  return `compat alias — prefer ${preferred}`;
}
