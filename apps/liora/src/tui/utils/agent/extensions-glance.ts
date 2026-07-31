/**
 * Extensions settings glance — live plugins / skills / MCP counts (SSOT §9.2 / §19).
 */

import type { McpServerInfo, PluginSummary, SkillSummary } from '@superliora/sdk';

/** Compact audit tip — tabbed modal and focused glances. */
export const EXTENSIONS_AUDIT_TIP =
  'Audit extensions: /extensions tabbed modal (plugins · hooks · skills · MCP) · Settings → Hooks / Skills / MCP for focused glances · footer ext↻ badge after install/toggle/import (~45s).';

/** Compact manage tip — install/toggle paths without opening the hub. */
export const EXTENSIONS_MANAGE_TIP =
  'Manage extensions: /plugins /skills /mcp · Plugins (install/enable/marketplace) · Skills (slash enable/disable · Claude import) · MCP (mcp.json install/toggle/reload) · Import from Claude (~/.claude skills + MCP + plugins).';

/** Compact hot-reload tip — session reload and recovery. */
export const EXTENSIONS_HOT_RELOAD_TIP =
  'Hot-reload: install/toggle/import reloads session when possible; otherwise Never-Halt + ext↻ · stuck? Manage → MCP → Reload session or /reload.';

import { formatMcpLiveSessionLine } from '../mcp/mcp-glance';
import { summarizeSkillsCatalog } from '../skills/skills-glance';

export interface ExtensionsSessionLiveGlance {
  readonly plugins?: readonly PluginSummary[];
  readonly skills?: readonly SkillSummary[];
  readonly mcpServers?: readonly McpServerInfo[];
  readonly skillsDisabled?: readonly string[];
  readonly loadError?: string;
  readonly sessionUnavailable?: boolean;
}

function formatPluginsLiveLine(plugins: readonly PluginSummary[]): string {
  if (plugins.length === 0) {
    return 'Plugins: 0 installed';
  }
  const enabled = plugins.filter((plugin) => plugin.enabled).length;
  const errors = plugins.filter((plugin) => plugin.hasErrors).length;
  const parts = [
    `${String(plugins.length)} installed`,
    `${String(enabled)} enabled`,
  ];
  if (errors > 0) {
    parts.push(`${String(errors)} with errors`);
  }
  return `Plugins: ${parts.join(' · ')}`;
}

function formatSkillsLiveLine(
  skills: readonly SkillSummary[],
  disabledNames: readonly string[],
): string {
  if (skills.length === 0) {
    return 'Skills: 0 in catalog';
  }
  const catalog = summarizeSkillsCatalog(skills, disabledNames);
  return `Skills: ${String(catalog.installedCount)} in catalog · ${String(catalog.enabledCount)} slash-enabled · ${String(catalog.disabledCount)} disabled`;
}

function formatHooksLiveLine(plugins: readonly PluginSummary[]): string {
  const enabled = plugins.filter((plugin) => plugin.enabled);
  const hookCount = enabled.reduce((sum, plugin) => sum + plugin.hookCount, 0);
  if (hookCount === 0) {
    return 'Hooks: 0 from enabled plugins';
  }
  return `Hooks: ${String(hookCount)} from ${String(enabled.length)} enabled plugin(s)`;
}

function formatMcpLiveBlock(servers: readonly McpServerInfo[]): string {
  return formatMcpLiveSessionLine(servers).replace(/^Live session: /, 'MCP: ');
}

/** Session live block — installed plugins/skills/MCP counts when session is wired. */
export function buildExtensionsSessionLiveLines(
  glance: ExtensionsSessionLiveGlance,
): readonly string[] {
  if (glance.sessionUnavailable) {
    return [
      '── Session (live) ───────────────────────────',
      'Plugins: (session unavailable)',
      'Skills: (session unavailable)',
      'MCP: (session unavailable)',
      'Hooks: (session unavailable)',
      '',
    ];
  }

  if (glance.loadError !== undefined) {
    return [
      '── Session (live) ───────────────────────────',
      `Load failed: ${glance.loadError}`,
      '',
    ];
  }

  const plugins = glance.plugins;
  const skills = glance.skills;
  const mcpServers = glance.mcpServers;

  if (plugins === undefined && skills === undefined && mcpServers === undefined) {
    return [
      '── Session (live) ───────────────────────────',
      'Plugins: open a session to count installed plugins',
      'Skills: open a session to count catalog + user/project skills',
      'MCP: open a session to inspect MCP connection status',
      'Hooks: open a session to count plugin hooks',
      '',
    ];
  }

  return [
    '── Session (live) ───────────────────────────',
    plugins !== undefined ? formatPluginsLiveLine(plugins) : 'Plugins: (not loaded)',
    skills !== undefined
      ? formatSkillsLiveLine(skills, glance.skillsDisabled ?? [])
      : 'Skills: (not loaded)',
    mcpServers !== undefined
      ? formatMcpLiveBlock(mcpServers)
      : 'MCP: (not loaded)',
    plugins !== undefined ? formatHooksLiveLine(plugins) : 'Hooks: (not loaded)',
    '',
  ];
}

export function buildExtensionsSettingsLines(glance: ExtensionsSessionLiveGlance): readonly string[] {
  return [
    '── Extensions (read-only) ───────────────────',
    'Plugins, skills, MCP — Claude-compatible control plane (§9.2 / §19).',
    '',
    ...buildExtensionsSessionLiveLines(glance),
    '── Audit surfaces ───────────────────────────',
    '· /extensions — tabbed modal (plugins · hooks · skills · MCP)',
    '· Settings → Hooks / Skills / MCP — focused read-only glances',
    '· Footer ext↻ badge after install/toggle/import (~45s)',
    '',
    '── Manage ──────────────────────────────────',
    '· Manage → Plugins — install, enable, disable, remove, marketplace',
    '· Manage → Skills — slash enable/disable · Import from Claude Code',
    '· Manage → MCP — install, toggle, remove, reload (mcp.json)',
    '· Manage → Import from Claude — ~/.claude skills + MCP + plugins',
    '· /plugins · /skills · /mcp — same manage pickers',
    '',
    '── Hot-reload ───────────────────────────────',
    'Install/toggle/import reloads session when possible; otherwise Never-Halt + ext↻.',
    'Stuck? Manage → MCP → Reload session · or /reload',
    '',
    'No bulk enable/disable toggles here — use Manage hub or /extensions modal.',
  ];
}
