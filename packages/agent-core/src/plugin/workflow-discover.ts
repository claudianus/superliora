import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { isDir, isFile } from './paths';
import { extractMeta, type WorkflowMeta } from './workflow-runtime';

export interface DiscoveredWorkflowScript {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly filePath: string;
  readonly source: 'plugin' | 'project' | 'user';
  readonly pluginId?: string;
  readonly meta: WorkflowMeta;
}

/**
 * Discover Claude dynamic-workflow JS scripts from plugin dirs and migration paths:
 * 1) plugin workflows/
 * 2) `<project>/.claude/workflows`
 * 3) `~/.claude/workflows`
 */
export async function discoverWorkflowScripts(input: {
  readonly pluginWorkflows: readonly {
    readonly pluginId: string;
    readonly dir: string;
  }[];
  readonly projectDir: string;
  readonly homeDir?: string;
}): Promise<readonly DiscoveredWorkflowScript[]> {
  const out: DiscoveredWorkflowScript[] = [];
  const seenNames = new Set<string>();

  for (const plugin of input.pluginWorkflows) {
    for (const script of await scanWorkflowDir(plugin.dir, {
      source: 'plugin',
      pluginId: plugin.pluginId,
      idPrefix: plugin.pluginId,
    })) {
      if (seenNames.has(script.name)) continue;
      seenNames.add(script.name);
      out.push(script);
    }
  }

  const projectDir = path.join(input.projectDir, '.claude', 'workflows');
  for (const script of await scanWorkflowDir(projectDir, {
    source: 'project',
    idPrefix: 'project',
  })) {
    // Closer project wins over user; plugin names already reserved above.
    if (seenNames.has(script.name)) continue;
    seenNames.add(script.name);
    out.push(script);
  }

  const home = input.homeDir ?? os.homedir();
  const userDir = path.join(home, '.claude', 'workflows');
  for (const script of await scanWorkflowDir(userDir, {
    source: 'user',
    idPrefix: 'user',
  })) {
    if (seenNames.has(script.name)) continue;
    seenNames.add(script.name);
    out.push(script);
  }

  return out.toSorted((a, b) => a.name.localeCompare(b.name));
}

async function scanWorkflowDir(
  dir: string,
  opts: {
    readonly source: DiscoveredWorkflowScript['source'];
    readonly pluginId?: string;
    readonly idPrefix: string;
  },
): Promise<DiscoveredWorkflowScript[]> {
  if (!(await isDir(dir))) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DiscoveredWorkflowScript[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.(m?js|cjs)$/i.test(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    if (!(await isFile(filePath))) continue;
    let sourceText: string;
    try {
      sourceText = await readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const slug = entry.name.replace(/\.(m?js|cjs)$/i, '');
    const meta = extractMeta(sourceText) ?? { name: slug };
    const name = meta.name;
    out.push({
      id: `${opts.idPrefix}:${name}`,
      name,
      description: meta.description,
      filePath,
      source: opts.source,
      pluginId: opts.pluginId,
      meta: { name, description: meta.description },
    });
  }
  return out;
}
