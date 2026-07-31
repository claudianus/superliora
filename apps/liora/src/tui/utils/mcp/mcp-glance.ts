/**
 * MCP settings glance — live listMcpServers summary + mcp.json tips (SSOT §9.2).
 */

import type { McpServerInfo } from '@superliora/sdk';

import { formatMcpStartupStatusSummary } from './mcp-server-status';

export interface McpConfigGlance {
  readonly configured: number;
  readonly paths: readonly string[];
}

export interface McpGlanceInput {
  readonly live?: readonly McpServerInfo[];
  readonly loadError?: string;
  readonly config?: McpConfigGlance;
}

export function formatMcpLiveSessionLine(servers: readonly McpServerInfo[]): string {
  if (servers.length === 0) {
    return 'Live session: 0 servers registered';
  }
  let tools = 0;
  for (const server of servers) {
    if (server.status === 'connected') tools += server.toolCount;
  }
  const statusSummary = formatMcpStartupStatusSummary(servers);
  const toolPart =
    tools > 0 ? ` · ${String(tools)} tool${tools === 1 ? '' : 's'} available` : '';
  return `Live session: ${String(servers.length)} server(s) · ${statusSummary}${toolPart}`;
}

function formatLiveServerRows(servers: readonly McpServerInfo[]): readonly string[] {
  if (servers.length === 0) return [];
  const rows = [...servers]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 6)
    .map((server) => {
      const tools =
        server.toolCount > 0 ? ` · ${String(server.toolCount)} tool${server.toolCount === 1 ? '' : 's'}` : '';
      return `· ${server.name} — ${server.status} · ${server.transport}${tools}`;
    });
  if (servers.length > 6) {
    return [
      ...rows,
      `· … +${String(servers.length - 6)} more (full table: Manage → Status or /mcp status)`,
    ];
  }
  return rows;
}

export function buildMcpSettingsLines(input: McpGlanceInput): readonly string[] {
  const liveLines: string[] = [];
  if (input.loadError !== undefined) {
    liveLines.push(`Live session: failed to load (${input.loadError})`);
  } else if (input.live !== undefined) {
    liveLines.push(formatMcpLiveSessionLine(input.live));
    liveLines.push(...formatLiveServerRows(input.live));
  } else {
    liveLines.push('Live session: open a session to inspect MCP connection status');
  }

  const configLines: string[] = [];
  if (input.config !== undefined && input.config.configured > 0) {
    configLines.push(`mcp.json: ${String(input.config.configured)} server(s) across scopes`);
    configLines.push(...input.config.paths.map((path) => `· ${path}`));
  } else {
    configLines.push('mcp.json: no entries yet — Manage → Install or Import from Claude');
  }

  return [
    '── MCP servers (read-only glance) ──────────',
    'Claude-compatible mcp.json — Sovereign Reform §9.2.',
    '',
    '── Live session ─────────────────────────────',
    ...liveLines,
    '',
    '── Config scopes ───────────────────────────',
    ...configLines,
    'Scopes: project/.superliora/mcp.json · project-root/.mcp.json · ~/.superliora/mcp.json',
    '',
    '── Tool allowlist ──────────────────────────',
    'Per-server: enabledTools / disabledTools in mcp.json',
    'Security glance: Settings → Security → MCP tool allowlist',
    '',
    '── Manage ──────────────────────────────────',
    '· Manage → Install (stdio/HTTP), toggle, remove, reload',
    '· /mcp — same manage picker · /mcp status — full status panel',
    '· Extensions → Plugin MCP for plugin-declared servers',
    '· OAuth: /mcp-config login <name> when status is needs-auth',
    '',
    '── Built-in research ───────────────────────',
    'WebSearch + FetchURL run outside MCP — no server required.',
  ];
}
