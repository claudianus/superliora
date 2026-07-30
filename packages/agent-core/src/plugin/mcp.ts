import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { McpServerConfigSchema, type McpServerConfig } from '../config/schema';
import { expandPluginPlaceholders, expandRecordValues } from './expand';
import { isFile, isObject, pathEntries, resolvePluginPath } from './paths';
import type { PluginDiagnostic } from './types';

/**
 * Merge Claude `.mcp.json` (default) with manifest `mcpServers` (path or inline).
 * Manifest path entries supplement the default file; inline object merges by name.
 */
export async function loadClaudeMcpServers(input: {
  readonly pluginRoot: string;
  readonly raw: unknown;
  readonly vars: {
    readonly pluginRoot: string;
    readonly pluginData: string;
    readonly projectDir: string;
  };
  readonly diagnostics: PluginDiagnostic[];
  readonly useDefault: boolean;
}): Promise<Readonly<Record<string, McpServerConfig>> | undefined> {
  const out: Record<string, McpServerConfig> = {};

  if (input.useDefault) {
    const defaultPath = path.join(input.pluginRoot, '.mcp.json');
    if (await isFile(defaultPath)) {
      await mergeMcpFile(defaultPath, out, input.pluginRoot, input.vars, input.diagnostics);
    }
  }

  if (input.raw === undefined) {
    return Object.keys(out).length === 0 ? undefined : out;
  }

  if (typeof input.raw === 'string' || Array.isArray(input.raw)) {
    const entries = pathEntries(input.raw);
    if (entries === undefined) {
      input.diagnostics.push({
        severity: 'warn',
        message: '"mcpServers" path list must be a string or string[]',
      });
      return Object.keys(out).length === 0 ? undefined : out;
    }
    for (const entry of entries) {
      const resolved = await resolvePluginPath({
        pluginRoot: input.pluginRoot,
        field: 'mcpServers',
        value: entry,
        diagnostics: input.diagnostics,
      });
      if (resolved === undefined) continue;
      if (!(await isFile(resolved))) {
        input.diagnostics.push({
          severity: 'warn',
          message: `"mcpServers" path is not a file (${entry})`,
        });
        continue;
      }
      await mergeMcpFile(resolved, out, input.pluginRoot, input.vars, input.diagnostics);
    }
    return Object.keys(out).length === 0 ? undefined : out;
  }

  if (!isObject(input.raw)) {
    input.diagnostics.push({
      severity: 'warn',
      message: '"mcpServers" must be an object, path string, or string[]',
    });
    return Object.keys(out).length === 0 ? undefined : out;
  }

  // Inline may be `{ mcpServers: { ... } }` or bare server map.
  const table = isObject(input.raw['mcpServers'])
    ? (input.raw['mcpServers'] as Record<string, unknown>)
    : input.raw;

  for (const [name, value] of Object.entries(table)) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    const normalized = await normalizeServer({
      name: trimmed,
      value,
      pluginRoot: input.pluginRoot,
      vars: input.vars,
      diagnostics: input.diagnostics,
    });
    if (normalized !== undefined) out[trimmed] = normalized;
  }

  return Object.keys(out).length === 0 ? undefined : out;
}

async function mergeMcpFile(
  filePath: string,
  out: Record<string, McpServerConfig>,
  pluginRoot: string,
  vars: {
    readonly pluginRoot: string;
    readonly pluginData: string;
    readonly projectDir: string;
  },
  diagnostics: PluginDiagnostic[],
): Promise<void> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    diagnostics.push({
      severity: 'warn',
      message: `Failed to parse ${path.basename(filePath)}: ${(error as Error).message}`,
    });
    return;
  }
  if (!isObject(raw)) {
    diagnostics.push({
      severity: 'warn',
      message: `${path.basename(filePath)} must be a JSON object`,
    });
    return;
  }
  const table = isObject(raw['mcpServers'])
    ? (raw['mcpServers'] as Record<string, unknown>)
    : raw;
  for (const [name, value] of Object.entries(table)) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    const normalized = await normalizeServer({
      name: trimmed,
      value,
      pluginRoot,
      vars,
      diagnostics,
    });
    if (normalized !== undefined) out[trimmed] = normalized;
  }
}

async function normalizeServer(input: {
  readonly name: string;
  readonly value: unknown;
  readonly pluginRoot: string;
  readonly vars: {
    readonly pluginRoot: string;
    readonly pluginData: string;
    readonly projectDir: string;
  };
  readonly diagnostics: PluginDiagnostic[];
}): Promise<McpServerConfig | undefined> {
  if (!isObject(input.value)) {
    input.diagnostics.push({
      severity: 'warn',
      message: `Invalid MCP server "${input.name}": expected object`,
    });
    return undefined;
  }

  const expanded: Record<string, unknown> = { ...input.value };
  if (typeof expanded['command'] === 'string') {
    expanded['command'] = expandPluginPlaceholders(expanded['command'], input.vars);
  }
  if (typeof expanded['cwd'] === 'string') {
    expanded['cwd'] = expandPluginPlaceholders(expanded['cwd'], input.vars);
  }
  if (typeof expanded['url'] === 'string') {
    expanded['url'] = expandPluginPlaceholders(expanded['url'], input.vars);
  }
  if (Array.isArray(expanded['args'])) {
    expanded['args'] = expanded['args'].map((arg) =>
      typeof arg === 'string' ? expandPluginPlaceholders(arg, input.vars) : arg,
    );
  }
  if (isObject(expanded['env'])) {
    const envRecord: Record<string, string> = {};
    for (const [k, v] of Object.entries(expanded['env'])) {
      if (typeof v === 'string') envRecord[k] = v;
    }
    expanded['env'] = expandRecordValues(envRecord, input.vars);
  }

  const parsed = McpServerConfigSchema.safeParse(expanded);
  if (!parsed.success) {
    input.diagnostics.push({
      severity: 'warn',
      message: `Invalid MCP server "${input.name}": ${parsed.error.message}`,
    });
    return undefined;
  }

  const config = parsed.data;
  if (config.transport === 'http' || config.transport === 'sse') return config;

  let command = config.command;
  if (command.startsWith('./')) {
    const resolvedCommand = await resolvePluginPath({
      pluginRoot: input.pluginRoot,
      field: `mcpServers.${input.name}.command`,
      value: command,
      diagnostics: input.diagnostics,
    });
    if (resolvedCommand === undefined) return undefined;
    command = resolvedCommand;
  } else if (command.includes('/') || path.isAbsolute(command)) {
    // Absolute or non-./ relative after placeholder expand is fine if under root.
    if (path.isAbsolute(command)) {
      // keep
    } else {
      input.diagnostics.push({
        severity: 'warn',
        message: `"mcpServers.${input.name}.command" must be a PATH command or start with "./"`,
      });
      return undefined;
    }
  }

  let cwd = config.cwd;
  if (cwd !== undefined) {
    if (cwd.startsWith('./')) {
      const resolvedCwd = await resolvePluginPath({
        pluginRoot: input.pluginRoot,
        field: `mcpServers.${input.name}.cwd`,
        value: cwd,
        diagnostics: input.diagnostics,
      });
      if (resolvedCwd === undefined) return undefined;
      cwd = resolvedCwd;
    }
  }

  return { ...config, command, cwd };
}
