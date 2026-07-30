import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { loadPluginCommand } from './commands';
import { isDir } from './paths';
import type { PluginCommandDef, PluginDiagnostic } from './types';

export interface PluginWorkflowLoadResult {
  readonly commands: readonly PluginCommandDef[];
  readonly scriptNames: readonly string[];
  readonly scriptPaths: readonly { readonly name: string; readonly filePath: string }[];
  readonly diagnostics: readonly PluginDiagnostic[];
}

/**
 * Workflow host: markdown → command aliases; JS scripts discovered for WorkflowHost.
 */
export async function loadPluginWorkflows(input: {
  readonly pluginId: string;
  readonly workflowsDir: string;
}): Promise<PluginWorkflowLoadResult> {
  if (!(await isDir(input.workflowsDir))) {
    return { commands: [], scriptNames: [], scriptPaths: [], diagnostics: [] };
  }
  let entries;
  try {
    entries = await readdir(input.workflowsDir, { withFileTypes: true });
  } catch {
    return { commands: [], scriptNames: [], scriptPaths: [], diagnostics: [] };
  }

  const commands: PluginCommandDef[] = [];
  const scriptNames: string[] = [];
  const scriptPaths: { name: string; filePath: string }[] = [];
  const diagnostics: PluginDiagnostic[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(input.workflowsDir, entry.name);
    if (entry.name.endsWith('.md')) {
      const slug = entry.name.replace(/\.md$/i, '');
      const def = await loadPluginCommand({
        commandPath: full,
        pluginId: input.pluginId,
        fallbackName: `workflow:${slug}`,
      });
      if (def !== undefined) {
        commands.push({
          ...def,
          name: def.name.startsWith('workflow:') ? def.name : `workflow:${def.name}`,
        });
      }
      continue;
    }
    if (/\.(m?js|cjs)$/i.test(entry.name)) {
      const name = entry.name.replace(/\.(m?js|cjs)$/i, '');
      scriptNames.push(name);
      scriptPaths.push({ name, filePath: full });
    } else if (/\.ts$/i.test(entry.name)) {
      diagnostics.push({
        severity: 'info',
        message: `workflow TypeScript "${entry.name}" discovered; only .js/.mjs/.cjs are executed`,
      });
      scriptNames.push(entry.name.replace(/\.ts$/i, ''));
    }
  }

  return {
    commands: commands.toSorted((a, b) => a.name.localeCompare(b.name)),
    scriptNames,
    scriptPaths,
    diagnostics,
  };
}

export function renderWorkflowScriptsReminder(input: {
  readonly pluginId: string;
  readonly scriptNames: readonly string[];
}): string | undefined {
  if (input.scriptNames.length === 0) return undefined;
  return [
    `Plugin "${input.pluginId}" workflow scripts (run via /workflows or /${input.pluginId}:<name>):`,
    ...input.scriptNames.map((name) => `- ${name}`),
  ].join('\n');
}
