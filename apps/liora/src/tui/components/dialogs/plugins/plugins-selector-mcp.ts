import {Container, Key, matchesKey, renderRendererPanelChromeRows, type Focusable} from '#/tui/renderer';
import type { PluginInfo, PluginMcpServerInfo } from '@superliora/sdk';
import chalk from 'chalk';

import {renderSelectPointer} from '#/tui/utils/ui/select-pointer';
import {currentTheme} from '#/tui/theme';
import {printableChar} from '#/tui/utils/printable-key';

import {
  ELLIPSIS,
  MCP_SERVER_PREFIX,
  mutedHintLine,
  sectionLabel,
  statusStyle,
  wrapOverviewDescription,
  type PluginsOverviewItem,
} from './plugins-selector-shared';

export type PluginMcpSelection =
  | { readonly kind: 'toggle'; readonly pluginId: string; readonly server: string; readonly enabled: boolean }
  | { readonly kind: 'back'; readonly pluginId: string };

export interface PluginMcpSelectorOptions {
  readonly info: PluginInfo;
  readonly selectedServer?: string;
  readonly serverHint?: {
    readonly server: string;
    readonly text: string;
  };
  readonly onSelect: (selection: PluginMcpSelection) => void;
  readonly onCancel: () => void;
}

export class PluginMcpSelectorComponent extends Container implements Focusable {
  focused = false;

  private readonly opts: PluginMcpSelectorOptions;
  private readonly items: readonly PluginsOverviewItem[];
  private selectedIndex = 0;

  constructor(opts: PluginMcpSelectorOptions) {
    super();
    this.opts = opts;
    this.items = buildMcpItems(opts.info);
    const selectedIndex = this.items.findIndex(
      (item) => item.value === `${MCP_SERVER_PREFIX}${opts.selectedServer}`,
    );
    this.selectedIndex = Math.max(0, selectedIndex);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.opts.onCancel();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.space) || printableChar(data) === ' ') {
      const chosen = this.items[this.selectedIndex];
      if (chosen === undefined) return;
      if (chosen.value === 'back') {
        this.opts.onSelect({ kind: 'back', pluginId: this.opts.info.id });
        return;
      }
      const serverName = mcpItemServerName(chosen);
      if (serverName === undefined) return;
      const server = this.opts.info.mcpServers.find((item) => item.name === serverName);
      if (server === undefined) return;
      this.opts.onSelect({
        kind: 'toggle',
        pluginId: this.opts.info.id,
        server: server.name,
        enabled: !server.enabled,
      });
    }
  }

  override render(width: number): string[] {
    const { info } = this.opts;
    const colors = currentTheme.palette;
    const serverItems = this.items.filter((item) => item.kind === 'plugin');
    const actionItems = this.items.filter((item) => item.kind === 'action');
    const body: string[] = [
      sectionLabel(`MCP servers (${info.enabledMcpServerCount}/${info.mcpServerCount} enabled)`, colors),
    ];

    if (serverItems.length === 0) {
      body.push(chalk.hex(colors.textMuted)('  No MCP servers declared.'));
    } else {
      for (let i = 0; i < serverItems.length; i++) {
        body.push(...this.renderItem(serverItems[i]!, i, width));
      }
    }

    body.push('');
    body.push(sectionLabel('Actions', colors));
    for (let i = 0; i < actionItems.length; i++) {
      body.push(...this.renderItem(actionItems[i]!, serverItems.length + i, width));
    }

    return renderRendererPanelChromeRows({
      width,
      title: ` MCP servers · ${info.displayName}`,
      hint: ' ↑↓ navigate · Enter/Space enable/disable · Esc cancel',
      body,
      dividerStyle: (text) => chalk.hex(colors.primary)(text),
      titleStyle: (text) => chalk.hex(colors.primary).bold(text),
      hintStyle: (text) => mutedHintLine(text, colors),
      ellipsis: ELLIPSIS,
    });
  }

  private renderItem(item: PluginsOverviewItem, index: number, width: number): string[] {
    const colors = currentTheme.palette;
    const selected = index === this.selectedIndex;
    const pointer = selected ? renderSelectPointer('plugins:pointer') : ' ';
    const labelStyle = selected ? chalk.hex(colors.primary).bold : chalk.hex(colors.text);
    // Pointer is already ambient-styled; do not wrap it in chalk again.
    const tone = selected ? colors.primary : colors.textDim;
    const prefix = chalk.hex(tone)('  ') + pointer + chalk.hex(tone)(' ');
    let line = prefix + labelStyle(item.label);
    if (item.status !== undefined) {
      line += '  ' + statusStyle(item, colors)(item.status);
    }
    const serverName = mcpItemServerName(item);
    if (serverName !== undefined && this.opts.serverHint?.server === serverName) {
      line += '  ' + chalk.hex(colors.warning)(this.opts.serverHint.text);
    }
    const descriptionWidth = Math.max(1, width - 4);
    const lines = [line];
    for (const descLine of wrapOverviewDescription(item.description, descriptionWidth)) {
      lines.push(mutedHintLine(`    ${descLine}`, colors));
    }
    return lines;
  }
}

function buildMcpItems(info: PluginInfo): PluginsOverviewItem[] {
  const items: PluginsOverviewItem[] = info.mcpServers.map((server) => ({
    value: `${MCP_SERVER_PREFIX}${server.name}`,
    kind: 'plugin',
    label: server.name,
    status: server.enabled ? 'enabled' : 'disabled',
    description: mcpServerDescription(server),
  }));
  items.push({
    value: 'back',
    kind: 'action',
    label: 'Back to installed plugins',
    description: 'Return to the local plugin manager.',
  });
  return items;
}

function mcpServerDescription(server: PluginMcpServerInfo): string {
  const action = server.enabled ? 'Enter/Space disable' : 'Enter/Space enable';
  if (server.transport === 'http' || server.transport === 'sse') {
    return `${action} · ${server.transport.toUpperCase()} · ${server.url ?? server.runtimeName}`;
  }
  const args = server.args !== undefined && server.args.length > 0 ? ` ${server.args.join(' ')}` : '';
  const command = `${server.command ?? ''}${args}`.trim();
  const cwd = server.cwd === undefined ? '' : ` · cwd ${server.cwd}`;
  return `${action} · stdio · ${command || server.runtimeName}${cwd}`;
}

function mcpItemServerName(item: PluginsOverviewItem): string | undefined {
  if (!item.value.startsWith(MCP_SERVER_PREFIX)) return undefined;
  return item.value.slice(MCP_SERVER_PREFIX.length);
}
