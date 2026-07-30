import chalk from 'chalk';

import type { PluginSummary } from '@superliora/sdk';

import type { ColorPalette } from '#/tui/theme/colors';
import {formatPluginSourceLabel, pluginTrustLabel} from '#/tui/utils/plugin-source-label';
import {computeUpdateStatus, type PluginMarketplaceEntry} from '#/utils/plugin-marketplace';

export function overviewPluginDescription(plugin: PluginSummary): string {
  const state = plugin.state === 'ok' ? '' : ` · state ${plugin.state}`;
  const skills = `${plugin.skillCount} skill${plugin.skillCount === 1 ? '' : 's'}`;
  const mcp =
    plugin.mcpServerCount > 0
      ? ` · MCP ${plugin.enabledMcpServerCount}/${plugin.mcpServerCount}`
      : '';
  const diagnostics = plugin.hasErrors ? ' · diagnostics available' : '';
  const source = ` · ${formatPluginSourceLabel(plugin)}`;
  const trust = ` · ${pluginTrustLabel(plugin)}`;
  return `id ${plugin.id} · ${skills}${mcp}${source}${trust}${state}${diagnostics}`;
}

export function pluginStatus(plugin: PluginSummary): string | undefined {
  if (plugin.state !== 'ok') return plugin.state;
  return plugin.enabled ? 'enabled' : 'disabled';
}

export function marketplaceStatusStyle(status: string, colors: ColorPalette): (text: string) => string {
  // "update …" is a warning (actionable); "installed …" is success;
  // "install …" is the available action.
  if (status.startsWith('update')) return chalk.hex(colors.warning);
  if (status.startsWith('installed')) return chalk.hex(colors.success);
  return chalk.hex(colors.primary);
}

export function marketplaceEntryDescription(entry: PluginMarketplaceEntry): string {
  const tier = marketplaceTierLabel(entry.tier);
  const description = entry.description ?? tier;
  const version = entry.version !== undefined ? ` · v${entry.version}` : '';
  const keywords =
    entry.keywords !== undefined && entry.keywords.length > 0
      ? ` · ${entry.keywords.join(', ')}`
      : '';
  const tierSuffix = entry.description !== undefined ? ` · ${tier}` : '';
  return `${description} · id ${entry.id}${version}${tierSuffix}${keywords}`;
}

function marketplaceTierLabel(tier: PluginMarketplaceEntry['tier']): string {
  if (tier === 'official') return 'Official plugin';
  if (tier === 'curated') return 'Curated plugin';
  return 'Plugin';
}

function installStatus(entry: PluginMarketplaceEntry): string {
  return entry.version === undefined ? 'install' : `install v${entry.version}`;
}

export function marketplaceEntryStatus(
  entry: PluginMarketplaceEntry,
  installed: ReadonlyMap<string, string | undefined>,
): string {
  const status = computeUpdateStatus(entry.version, installed.get(entry.id), installed.has(entry.id));
  switch (status.kind) {
    case 'update':
      return `update ${status.local} → ${status.latest}`;
    case 'up-to-date':
      return status.version === undefined ? 'installed' : `installed · v${status.version}`;
    case 'not-installed':
      return installStatus(entry);
  }
}
