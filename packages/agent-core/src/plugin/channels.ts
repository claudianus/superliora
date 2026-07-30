import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isDir, isFile, isObject } from './paths';
import type { PluginChannelDef, PluginDiagnostic } from './types';

export type { PluginChannelDef };

/**
 * Load Claude plugin channels (MCP-bound inbound chat ports).
 * Accepts plugin.json `channels` array, `channels.json`, or `channels/*.json`.
 */
export async function loadPluginChannels(input: {
  readonly channelsPath: string;
  readonly inline?: unknown;
  readonly mcpServerNames: ReadonlySet<string>;
  readonly diagnostics: PluginDiagnostic[];
}): Promise<readonly PluginChannelDef[]> {
  const rawEntries = await readChannelEntries(input);
  const out: PluginChannelDef[] = [];
  for (const entry of rawEntries) {
    if (!isObject(entry)) continue;
    const server = typeof entry['server'] === 'string' ? entry['server'].trim() : '';
    if (server.length === 0) {
      input.diagnostics.push({
        severity: 'warn',
        message: 'channels entry missing "server"',
      });
      continue;
    }
    if (!input.mcpServerNames.has(server)) {
      input.diagnostics.push({
        severity: 'warn',
        message: `channel server "${server}" is not declared in mcpServers`,
      });
    }
    const userConfig = isObject(entry['userConfig']) ? entry['userConfig'] : undefined;
    out.push({ server, userConfig });
  }
  return out;
}

export function renderChannelsReminder(input: {
  readonly pluginId: string;
  readonly channels: readonly PluginChannelDef[];
}): string | undefined {
  if (input.channels.length === 0) return undefined;
  const lines = input.channels.map((channel) => `- MCP server "${channel.server}"`);
  return [
    `Plugin "${input.pluginId}" declared channels (enable with --channels / session opt-in for inbound inject):`,
    ...lines,
  ].join('\n');
}

async function readChannelEntries(input: {
  readonly channelsPath: string;
  readonly inline?: unknown;
}): Promise<readonly unknown[]> {
  if (Array.isArray(input.inline)) return input.inline;
  if (await isFile(input.channelsPath)) {
    try {
      const parsed = JSON.parse(await readFile(input.channelsPath, 'utf8')) as unknown;
      if (Array.isArray(parsed)) return parsed;
      if (isObject(parsed) && Array.isArray(parsed['channels'])) return parsed['channels'];
    } catch {
      return [];
    }
  }
  if (await isDir(input.channelsPath)) {
    // Directory marker only — Claude uses manifest array; keep empty.
    return [];
  }
  // channelsPath may be plugin root when channels were inline in plugin.json.
  const inlineFile = path.join(input.channelsPath, 'channels.json');
  if (await isFile(inlineFile)) {
    try {
      const parsed = JSON.parse(await readFile(inlineFile, 'utf8')) as unknown;
      if (Array.isArray(parsed)) return parsed;
      if (isObject(parsed) && Array.isArray(parsed['channels'])) return parsed['channels'];
    } catch {
      return [];
    }
  }
  return [];
}
