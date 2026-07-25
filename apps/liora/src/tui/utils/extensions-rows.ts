/**
 * Extensions modal row builders — one audit surface for plugins / hooks /
 * skills / MCP (AC6). Pure data shaping; no I/O.
 */

import type { McpServerInfo, PluginSummary, SkillSummary } from '@superliora/sdk';

export type ExtensionsTabId = 'plugins' | 'hooks' | 'skills' | 'mcp';

export const EXTENSIONS_TAB_ORDER = ['plugins', 'hooks', 'skills', 'mcp'] as const satisfies readonly ExtensionsTabId[];

export const EXTENSIONS_TAB_LABELS_KO: Readonly<Record<ExtensionsTabId, string>> = {
  plugins: '플러그인',
  hooks: '훅',
  skills: '스킬',
  mcp: 'MCP',
};

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
  if (plugin.hasErrors) return '오류';
  return plugin.enabled ? '활성' : '비활성';
}

export function buildPluginRows(plugins: readonly PluginSummary[]): readonly ExtensionsRow[] {
  return plugins.map((plugin) => ({
    id: `plugin:${plugin.id}`,
    title: plugin.displayName || plugin.id,
    status: pluginStatus(plugin),
    detail: [
      plugin.version !== undefined && plugin.version.length > 0 ? `v${plugin.version}` : undefined,
      `스킬 ${String(plugin.skillCount)}`,
      `MCP ${String(plugin.enabledMcpServerCount)}/${String(plugin.mcpServerCount)}`,
      `훅 ${String(plugin.hookCount)}`,
      `명령 ${String(plugin.commandCount)}`,
    ]
      .filter((part): part is string => part !== undefined)
      .join(' · '),
  }));
}

/**
 * Hooks are not a separate RPC list today — surface plugin-owned hook counts
 * so operators can audit from one modal without a second command.
 */
export function buildHookRows(plugins: readonly PluginSummary[]): readonly ExtensionsRow[] {
  const withHooks = plugins.filter((plugin) => plugin.hookCount > 0);
  if (withHooks.length === 0) {
    return [
      {
        id: 'hooks:empty',
        title: '등록된 훅 없음',
        status: '—',
        detail: '플러그인 훅은 설치 후 여기에 집계됩니다. 권한 deny는 항상 우선합니다.',
      },
    ];
  }
  return withHooks.map((plugin) => ({
    id: `hooks:${plugin.id}`,
    title: plugin.displayName || plugin.id,
    status: plugin.enabled ? '활성' : '비활성',
    detail: `훅 ${String(plugin.hookCount)}개 · 플러그인 소속 (always-approve 승격 없음)`,
  }));
}

export function buildSkillRows(skills: readonly SkillSummary[]): readonly ExtensionsRow[] {
  if (skills.length === 0) {
    return [
      {
        id: 'skills:empty',
        title: '스킬 없음',
        status: '—',
        detail: 'builtin / user / project 스킬이 여기에 표시됩니다.',
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

function mcpStatusKo(status: McpServerInfo['status']): string {
  switch (status) {
    case 'connected':
      return '연결됨';
    case 'pending':
      return '대기';
    case 'failed':
      return '실패';
    case 'disabled':
      return '비활성';
    case 'needs-auth':
      return '인증 필요';
    default:
      return status;
  }
}

export function buildMcpRows(servers: readonly McpServerInfo[]): readonly ExtensionsRow[] {
  if (servers.length === 0) {
    return [
      {
        id: 'mcp:empty',
        title: 'MCP 서버 없음',
        status: '—',
        detail: '/mcp 또는 플러그인 MCP로 서버를 추가하세요.',
      },
    ];
  }
  return servers.map((server) => ({
    id: `mcp:${server.name}`,
    title: server.name,
    status: mcpStatusKo(server.status),
    detail: [
      server.transport,
      `도구 ${String(server.toolCount)}`,
      server.error !== undefined && server.error.length > 0 ? '오류 있음' : undefined,
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
  return `플러그인 ${String(snapshot.plugins.length)} · 훅 ${String(hooks)} · 스킬 ${String(snapshot.skills.length)} · MCP ${String(snapshot.mcpServers.length)}`;
}

export function resolveExtensionsTab(arg: string | undefined): ExtensionsTabId {
  const raw = (arg ?? '').trim().toLowerCase();
  if (raw === 'hooks' || raw === 'hook') return 'hooks';
  if (raw === 'skills' || raw === 'skill') return 'skills';
  if (raw === 'mcp') return 'mcp';
  if (raw === 'plugins' || raw === 'plugin') return 'plugins';
  return 'plugins';
}
