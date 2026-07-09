import type { Kaos } from '@superliora/kaos';
import { join } from 'pathe';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import type { WorkspaceConfig } from '../../support/workspace';

export const LIORA_TREE_TOOL_NAME = 'LioraTree';

export const LioraTreeInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Directory to summarize. Defaults to workspace root.'),
  depth: z.number().int().min(1).max(4).optional().describe('Tree depth. Default 2.'),
  max_entries: z.number().int().min(1).max(200).optional(),
});

export type LioraTreeInput = z.infer<typeof LioraTreeInputSchema>;

const DESCRIPTION = [
  'Compact directory tree for orientation before Glob or broad reads.',
  'Prefer this over Bash ls/find when exploring repository structure.',
].join(' ');

const EXCLUDED = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  '.next',
  'coverage',
  '.turbo',
  '.cache',
]);

export class LioraTreeTool implements BuiltinTool<LioraTreeInput> {
  readonly name = LIORA_TREE_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LioraTreeInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
  ) {}

  resolveExecution(args: LioraTreeInput): ToolExecution {
    const parsed = LioraTreeInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: parsed.error.issues.map((issue) => issue.message).join('\n') };
    }
    const basePath = resolvePathAccessPath(parsed.data.path ?? '.', {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'read',
    });
    return {
      accesses: ToolAccesses.readFile(basePath),
      description: 'Building compact directory tree',
      readOnly: true,
      approvalRule: this.name,
      execute: () => this.execution(parsed.data, basePath),
    };
  }

  private async execution(input: LioraTreeInput, basePath: string): Promise<ExecutableToolResult> {
    try {
      const depth = input.depth ?? 2;
      const maxEntries = input.max_entries ?? 80;
      const lines = await renderTree(this.kaos, basePath, depth, maxEntries, '');
      return {
        output: ['<liora_tree>', ...lines, '</liora_tree>'].join('\n'),
      };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}

async function renderTree(
  kaos: Kaos,
  dirPath: string,
  depth: number,
  maxEntries: number,
  prefix: string,
): Promise<string[]> {
  if (depth <= 0 || maxEntries <= 0) return [];
  const entries = await collectEntries(kaos, dirPath);
  const lines: string[] = [];
  let remaining = maxEntries;
  for (const [index, entry] of entries.entries()) {
    if (remaining <= 0) {
      lines.push(`${prefix}└── ...`);
      break;
    }
    const isLast = index === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const childPrefix = isLast ? `${prefix}    ` : `${prefix}│   `;
    const suffix = entry.isDir ? '/' : '';
    lines.push(`${prefix}${connector}${entry.name}${suffix}`);
    remaining -= 1;
    if (entry.isDir && depth > 1) {
      const childLines = await renderTree(
        kaos,
        join(dirPath, entry.name),
        depth - 1,
        remaining,
        childPrefix,
      );
      lines.push(...childLines);
      remaining -= childLines.length;
    }
  }
  return lines;
}

interface TreeEntry {
  readonly name: string;
  readonly isDir: boolean;
}

async function collectEntries(kaos: Kaos, dirPath: string): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  for await (const fullPath of kaos.iterdir(dirPath)) {
    const name = fullPath.split(/[/\\]/u).at(-1) ?? fullPath;
    if (EXCLUDED.has(name)) continue;
    let isDir = false;
    try {
      const stat = await kaos.stat(fullPath);
      isDir = (stat.stMode & 0o170000) === 0o040000;
    } catch {
      continue;
    }
    entries.push({ name, isDir });
  }
  return entries.toSorted((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
