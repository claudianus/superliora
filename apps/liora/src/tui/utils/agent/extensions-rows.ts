/**
 * Extensions modal row builders — one audit surface for plugins / hooks /
 * skills / MCP (AC6). Pure data shaping; no I/O.
 */

import type { McpServerInfo, PluginSummary, SkillSummary } from '@superliora/sdk';

import { ttui } from '#/tui/utils/tui-i18n';

export type ExtensionsTabId = 'plugins' | 'hooks' | 'skills' | 'mcp';

export const EXTENSIONS_TAB_ORDER = ['plugins', 'hooks', 'skills', 'mcp'] as const satisfies readonly ExtensionsTabId[];

const EXTENSIONS_TAB_LABEL_KEYS: Readonly<Record<ExtensionsTabId, string>> = {
  plugins: 'tui.extensions.tab.plugins',
  hooks: 'tui.extensions.tab.hooks',
  skills: 'tui.extensions.tab.skills',
  mcp: 'tui.extensions.tab.mcp',
};

export function extensionsTabLabel(tab: ExtensionsTabId): string {
  return ttui(EXTENSIONS_TAB_LABEL_KEYS[tab]);
}

export interface ExtensionsRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly detail: string;
}

export interface ExtensionsSnapshot {
  readonly plugins: readonly PluginSummary[];
  readonly skills: readonly SkillSummary[];
  readonly mcpServers: readonly McpServerInfo[];
}

function pluginStatus(plugin: PluginSummary): string {
  if (plugin.hasErrors) return ttui('tui.extensions.status.error');
  return plugin.enabled
    ? ttui('tui.extensions.status.active')
    : ttui('tui.extensions.status.inactive');
}

export function buildPluginRows(plugins: readonly PluginSummary[]): readonly ExtensionsRow[] {
  return plugins.map((plugin) => ({
    id: `plugin:${plugin.id}`,
    title: plugin.displayName || plugin.id,
    status: pluginStatus(plugin),
    detail: [
      plugin.version !== undefined && plugin.version.length > 0 ? `v${plugin.version}` : undefined,
      ttui('tui.extensions.plugin.skills', { count: String(plugin.skillCount) }),
      ttui('tui.extensions.plugin.mcp', {
        enabled: String(plugin.enabledMcpServerCount),
        total: String(plugin.mcpServerCount),
      }),
      ttui('tui.extensions.plugin.hooks', { count: String(plugin.hookCount) }),
      ttui('tui.extensions.plugin.commands', { count: String(plugin.commandCount) }),
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · '),
  }));
}

export function buildHookRows(plugins: readonly PluginSummary[]): readonly ExtensionsRow[] {
  const withHooks = plugins.filter((plugin) => plugin.hookCount > 0);
  if (withHooks.length === 0) {
    return [
      {
        id: 'hooks:empty',
        title: ttui('tui.extensions.hooks.emptyTitle'),
        status: '—',
        detail: ttui('tui.extensions.hooks.emptyDetail'),
      },
    ];
  }
  return withHooks.map((plugin) => ({
    id: `hooks:${plugin.id}`,
    title: plugin.displayName || plugin.id,
    status: plugin.enabled
      ? ttui('tui.extensions.status.active')
      : ttui('tui.extensions.status.inactive'),
    detail: ttui('tui.extensions.hooks.rowDetail', { count: String(plugin.hookCount) }),
  }));
}

export function buildSkillRows(skills: readonly SkillSummary[]): readonly ExtensionsRow[] {
  if (skills.length === 0) {
    return [
      {
        id: 'skills:empty',
        title: ttui('tui.extensions.skills.emptyTitle'),
        status: '—',
        detail: ttui('tui.extensions.skills.emptyDetail'),
      },
    ];
  }
  return skills.map((skill) => ({
    id: `skill:${skill.name}`,
    title: skill.name,
    status: skill.source,
    detail: (skill.description ?? '').replaceAll(/\s+/g, ' ').trim() || skill.path,
  }));
}

function mcpStatusLabel(status: McpServerInfo['status']): string {
  switch (status) {
    case 'connected':
      return ttui('tui.extensions.mcp.connected');
    case 'pending':
      return ttui('tui.extensions.mcp.pending');
    case 'failed':
      return ttui('tui.extensions.mcp.failed');
    case 'disabled':
      return ttui('tui.extensions.status.inactive');
    case 'needs-auth':
      return ttui('tui.extensions.mcp.needsAuth');
    default:
      return status;
  }
}

export function buildMcpRows(servers: readonly McpServerInfo[]): readonly ExtensionsRow[] {
  if (servers.length === 0) {
    return [
      {
        id: 'mcp:empty',
        title: ttui('tui.extensions.mcp.emptyTitle'),
        status: '—',
        detail: ttui('tui.extensions.mcp.emptyDetail'),
      },
    ];
  }
  return servers.map((server) => ({
    id: `mcp:${server.name}`,
    title: server.name,
    status: mcpStatusLabel(server.status),
    detail: [
      server.transport,
      ttui('tui.extensions.mcp.tools', { count: String(server.toolCount) }),
      server.error !== undefined && server.error.length > 0
        ? ttui('tui.extensions.mcp.hasError')
        : undefined,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · '),
  }));
}

export function rowsForExtensionsTab(
  tab: ExtensionsTabId,
  snapshot: ExtensionsSnapshot,
): readonly ExtensionsRow[] {
  switch (tab) {
    case 'plugins':
      return buildPluginRows(snapshot.plugins);
    case 'hooks':
      return buildHookRows(snapshot.plugins);
    case 'skills':
      return buildSkillRows(snapshot.skills);
    case 'mcp':
      return buildMcpRows(snapshot.mcpServers);
  }
}

export function extensionsTabSummary(snapshot: ExtensionsSnapshot): string {
  const hooks = snapshot.plugins.reduce((sum, p) => sum + p.hookCount, 0);
  return ttui('tui.extensions.summary', {
    plugins: String(snapshot.plugins.length),
    hooks: String(hooks),
    skills: String(snapshot.skills.length),
    mcp: String(snapshot.mcpServers.length),
  });
}

export function resolveExtensionsTab(arg: string | undefined): ExtensionsTabId {
  const raw = (arg ?? '').trim().toLowerCase();
  if (raw === 'hooks' || raw === 'hook') return 'hooks';
  if (raw === 'skills' || raw === 'skill') return 'skills';
  if (raw === 'mcp') return 'mcp';
  if (raw === 'plugins' || raw === 'plugin') return 'plugins';
  return 'plugins';
}
