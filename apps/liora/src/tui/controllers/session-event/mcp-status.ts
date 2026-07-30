import type { Session } from '@superliora/sdk';

import { MoonLoader } from '../../components/chrome/moon-loader';
import { StatusMessageComponent } from '../../components/messages/status-message';
import type { AppState } from '../../types';
import type { TUIState } from '../../tui-state';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';
import { requestTUILayoutRender } from '../../utils/frame-render';
import {
  formatMcpStartupStatusSummary,
  mcpServerStatusKey,
  type McpServerStatusSnapshot,
  selectMcpStartupStatusRows,
} from '../../utils/mcp-server-status';

/** Host surface required by MCP server status rendering. */
export interface McpStatusEventHost {
  state: TUIState;
  session: Session | undefined;
  aborted: boolean;
  setAppState(patch: Partial<AppState>): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
}

export class SessionEventMcpStatus {
  renderedMcpServerStatusKeys: Map<string, string> = new Map();
  mcpServerStatusSpinners: Map<string, MoonLoader> = new Map();
  mcpServers: Map<string, McpServerStatusSnapshot> = new Map();

  constructor(private readonly host: McpStatusEventHost) {}

  resetRuntimeState(): void {
    this.renderedMcpServerStatusKeys.clear();
    this.mcpServers.clear();
    this.stopAllSpinners();
  }

  async syncSnapshot(session: Session): Promise<void> {
    const { host } = this;
    let servers: readonly McpServerStatusSnapshot[];
    try {
      servers = await session.listMcpServers();
    } catch (error) {
      if (host.session !== session || host.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      host.showError(`Failed to sync MCP server status: ${message}`);
      return;
    }
    if (host.session !== session || host.state.appState.sessionId !== session.id) return;

    const visible = selectMcpStartupStatusRows(servers);
    const visibleNames = new Set(visible.map((server) => server.name));
    for (const server of visible) {
      if (this.renderedMcpServerStatusKeys.has(server.name)) continue;
      this.renderServerStatus(server);
    }

    this.mcpServers.clear();
    for (const server of servers) {
      this.mcpServers.set(server.name, server);
    }
    const hidden: McpServerStatusSnapshot[] = [];
    for (const server of servers) {
      if (visibleNames.has(server.name)) continue;
      if (this.renderedMcpServerStatusKeys.has(server.name)) continue;
      this.renderedMcpServerStatusKeys.set(server.name, mcpServerStatusKey(server));
      hidden.push(server);
    }
    const summary = formatMcpStartupStatusSummary(servers);
    host.setAppState({ mcpServersSummary: summary || null });
  }

  renderServerStatus(server: McpServerStatusSnapshot): void {
    const key = mcpServerStatusKey(server);
    if (this.renderedMcpServerStatusKeys.get(server.name) === key) return;
    this.renderedMcpServerStatusKeys.set(server.name, key);
    this.mcpServers.set(server.name, server);
    const summary = formatMcpStartupStatusSummary([...this.mcpServers.values()]);
    this.host.setAppState({ mcpServersSummary: summary || null });

    switch (server.status) {
      case 'connected': {
        const toolStr = `${server.toolCount} tool${server.toolCount === 1 ? '' : 's'}`;
        const message = `MCP server "${server.name}" connected · ${toolStr} (${server.transport})`;
        this.finalizeRow(server.name, message, 'success');
        return;
      }
      case 'failed': {
        const message = `MCP server "${server.name}" failed${server.error !== undefined ? `: ${server.error}` : ''}`;
        this.finalizeRow(server.name, message, 'error');
        return;
      }
      case 'needs-auth': {
        const message = `MCP server "${server.name}" needs OAuth — run /mcp-config login ${server.name}`;
        this.finalizeRow(server.name, message, 'warning');
        return;
      }
      case 'disabled':
        this.finalizeRow(
          server.name,
          `MCP server "${server.name}" disabled`,
          'textMuted',
        );
        return;
      case 'pending':
        this.showSpinner(server.name);
        return;
    }
  }

  stopAllSpinners(): void {
    for (const spinner of this.mcpServerStatusSpinners.values()) {
      spinner.stop();
    }
    this.mcpServerStatusSpinners.clear();
  }

  private showSpinner(name: string): void {
    const { state } = this.host;
    const label = `MCP server "${name}" connecting…`;
    const existing = this.mcpServerStatusSpinners.get(name);
    if (existing !== undefined) {
      existing.setLabel(label);
      return;
    }
    const tint = (s: string): string => currentTheme.fg('textMuted', s);
    const spinner = new MoonLoader(state.ui, 'braille', tint, label);
    state.transcriptContainer.addChild(spinner);
    this.mcpServerStatusSpinners.set(name, spinner);
    requestTUILayoutRender(state);
  }

  private finalizeRow(name: string, message: string, color: ColorToken): void {
    const { state } = this.host;
    const spinner = this.mcpServerStatusSpinners.get(name);
    if (spinner === undefined) {
      this.host.showStatus(message, color);
      return;
    }
    spinner.stop();
    const status = new StatusMessageComponent(message, color);
    const children = state.transcriptContainer.children;
    const idx = children.indexOf(spinner);
    if (idx >= 0) {
      children[idx] = status;
      state.transcriptContainer.invalidate();
    } else {
      state.transcriptContainer.addChild(status);
    }
    this.mcpServerStatusSpinners.delete(name);
    requestTUILayoutRender(state);
  }
}
