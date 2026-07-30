import { readFile } from 'node:fs/promises';

import { isObject } from './paths';
import type { PluginDiagnostic } from './types';

export interface PluginLspServerDef {
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly extensionToLanguage?: Readonly<Record<string, string>>;
}

/**
 * Parse Claude `.lsp.json` / plugin lspServers file.
 * Full stdio diagnostics collection is optional — this validates/discovers
 * server defs so sessions can degrade cleanly when no runtime is armed.
 */
export async function loadPluginLspServers(input: {
  readonly lspServersPath: string;
  readonly diagnostics: PluginDiagnostic[];
}): Promise<readonly PluginLspServerDef[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(input.lspServersPath, 'utf8')) as unknown;
  } catch (error) {
    input.diagnostics.push({
      severity: 'warn',
      message: `Failed to parse LSP config: ${(error as Error).message}`,
    });
    return [];
  }

  const table = isObject(raw)
    ? isObject(raw['lspServers'])
      ? (raw['lspServers'] as Record<string, unknown>)
      : raw
    : undefined;
  if (table === undefined) {
    input.diagnostics.push({
      severity: 'warn',
      message: 'LSP config must be an object of server definitions',
    });
    return [];
  }

  const out: PluginLspServerDef[] = [];
  for (const [name, value] of Object.entries(table)) {
    if (!isObject(value)) continue;
    const command = typeof value['command'] === 'string' ? value['command'] : undefined;
    if (command === undefined || command.trim() === '') {
      input.diagnostics.push({
        severity: 'warn',
        message: `lspServers.${name} is missing "command"`,
      });
      continue;
    }
    const args =
      Array.isArray(value['args']) && value['args'].every((a) => typeof a === 'string')
        ? (value['args'] as string[])
        : undefined;
    const extensionToLanguage =
      isObject(value['extensionToLanguage'])
        ? Object.fromEntries(
            Object.entries(value['extensionToLanguage']).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : undefined;
    out.push({ name, command, args, extensionToLanguage });
  }
  return out;
}

/** Format buffered diagnostics for a system reminder (no live LSP required). */
export function renderLspDiagnosticsReminder(input: {
  readonly pluginId: string;
  readonly servers: readonly PluginLspServerDef[];
}): string | undefined {
  if (input.servers.length === 0) return undefined;
  const lines = input.servers.map(
    (server) => `- ${server.name}: ${server.command}${(server.args ?? []).length > 0 ? ` ${(server.args ?? []).join(' ')}` : ''}`,
  );
  return [
    `Plugin "${input.pluginId}" declared LSP servers (diagnostics bridge runs when a language server is available):`,
    ...lines,
  ].join('\n');
}
