import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expandPluginPlaceholders } from './expand';
import { isFile, isObject, resolvePluginPath } from './paths';
import type { PluginDiagnostic, PluginMonitorDef } from './types';

type ExpandVars = {
  readonly pluginRoot: string;
  readonly pluginData: string;
  readonly projectDir: string;
};

/**
 * Load Claude monitors from `monitors/monitors.json` (default) or manifest override.
 * Override replaces the default path (Claude semantics).
 */
export async function loadClaudeMonitors(input: {
  readonly pluginRoot: string;
  readonly raw: unknown;
  readonly vars: ExpandVars;
  readonly diagnostics: PluginDiagnostic[];
}): Promise<readonly PluginMonitorDef[]> {
  const sources: unknown[] = [];

  if (input.raw === undefined) {
    const defaultPath = path.join(input.pluginRoot, 'monitors', 'monitors.json');
    if (await isFile(defaultPath)) {
      sources.push(await readJsonFile(defaultPath, input.diagnostics));
    }
  } else if (typeof input.raw === 'string') {
    const resolved = await resolvePluginPath({
      pluginRoot: input.pluginRoot,
      field: 'monitors',
      value: input.raw,
      diagnostics: input.diagnostics,
    });
    if (resolved !== undefined && (await isFile(resolved))) {
      sources.push(await readJsonFile(resolved, input.diagnostics));
    } else if (resolved !== undefined) {
      input.diagnostics.push({
        severity: 'warn',
        message: `"monitors" path is not a file (${input.raw})`,
      });
    }
  } else if (Array.isArray(input.raw) || isObject(input.raw)) {
    sources.push(input.raw);
  } else {
    input.diagnostics.push({
      severity: 'warn',
      message: '"monitors" must be a path string, array, or object',
    });
  }

  const out: PluginMonitorDef[] = [];
  for (const source of sources) {
    if (source === undefined) continue;
    out.push(...flattenMonitors(source, input.vars, input.diagnostics));
  }
  return out;
}

function flattenMonitors(
  raw: unknown,
  vars: ExpandVars,
  diagnostics: PluginDiagnostic[],
): PluginMonitorDef[] {
  const list = Array.isArray(raw)
    ? raw
    : isObject(raw) && Array.isArray(raw['monitors'])
      ? raw['monitors']
      : undefined;
  if (list === undefined) {
    diagnostics.push({
      severity: 'warn',
      message: 'monitors config must be an array or { monitors: [...] }',
    });
    return [];
  }

  const out: PluginMonitorDef[] = [];
  for (const entry of list) {
    if (!isObject(entry)) continue;
    const name = typeof entry['name'] === 'string' ? entry['name'].trim() : '';
    const command = typeof entry['command'] === 'string' ? entry['command'] : '';
    if (name.length === 0 || command.trim().length === 0) {
      diagnostics.push({
        severity: 'warn',
        message: 'monitor entry requires non-empty "name" and "command"',
      });
      continue;
    }
    // Claude rejects ${user_config.*} in monitor commands (shell exposure).
    if (command.includes('${user_config.')) {
      diagnostics.push({
        severity: 'warn',
        message: `monitor "${name}" must not use \${user_config.*} in command; ignored`,
      });
      continue;
    }
    const when = typeof entry['when'] === 'string' ? entry['when'] : undefined;
    if (when !== undefined && when !== 'always') {
      diagnostics.push({
        severity: 'info',
        message: `monitor "${name}" when="${when}" is not armed (only "always"/omitted run)`,
      });
      continue;
    }
    out.push({
      name,
      command: expandPluginPlaceholders(command, vars),
      description: typeof entry['description'] === 'string' ? entry['description'] : undefined,
      when: when ?? 'always',
    });
  }
  return out;
}

async function readJsonFile(
  filePath: string,
  diagnostics: PluginDiagnostic[],
): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  } catch (error) {
    diagnostics.push({
      severity: 'warn',
      message: `Failed to parse ${path.basename(filePath)}: ${(error as Error).message}`,
    });
    return undefined;
  }
}
