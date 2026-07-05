import type { Kaos } from '@superliora/kaos';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import type { WorkspaceConfig } from '../../support/workspace';
import { collectContextFiles } from './context-discovery';

export const LIORA_SYMBOL_TOOL_NAME = 'LioraSymbol';

export const LioraSymbolInputSchema = z.object({
  name: z.string().min(1).describe('Exact symbol name to locate.'),
  path: z.string().optional().describe('Optional file or directory scope.'),
  max_results: z.number().int().min(1).max(40).optional(),
});

export type LioraSymbolInput = z.infer<typeof LioraSymbolInputSchema>;

const DESCRIPTION = [
  'Find symbol definitions and references with compact evidence lines.',
  'Use before LioraRead when you know the exact symbol name.',
].join(' ');

export class LioraSymbolTool implements BuiltinTool<LioraSymbolInput> {
  readonly name = LIORA_SYMBOL_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LioraSymbolInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
  ) {}

  resolveExecution(args: LioraSymbolInput): ToolExecution {
    const parsed = LioraSymbolInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: parsed.error.issues.map((issue) => issue.message).join('\n') };
    }
    const explicitPaths =
      parsed.data.path === undefined
        ? undefined
        : [
            resolvePathAccessPath(parsed.data.path, {
              kaos: this.kaos,
              workspace: this.workspace,
              operation: 'read',
            }),
          ];
    return {
      accesses: explicitPaths?.length
        ? explicitPaths.map((path) => ({ kind: 'file' as const, operation: 'read' as const, path }))
        : ToolAccesses.searchTree(this.workspace.workspaceDir),
      description: `Locating symbol ${parsed.data.name}`,
      approvalRule: this.name,
      execute: () => this.execution(parsed.data, explicitPaths),
    };
  }

  private async execution(
    input: LioraSymbolInput,
    explicitPaths: readonly string[] | undefined,
  ): Promise<ExecutableToolResult> {
    try {
      const files = await collectContextFiles({
        kaos: this.kaos,
        workspace: this.workspace,
        explicitPaths,
        query: input.name,
      });
      const maxResults = input.max_results ?? 20;
      const escaped = escapeRegExp(input.name);
      const definitionRe = new RegExp(
        `^(?:export\\s+)?(?:async\\s+)?(?:function|class|interface|type|const|let|var)\\s+${escaped}\\b`,
        'u',
      );
      const referenceRe = new RegExp(`\\b${escaped}\\b`, 'u');
      const definitions: string[] = [];
      const references: string[] = [];
      for (const file of files) {
        const lines = file.content.split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
          const lineNumber = index + 1;
          const trimmed = line.trim();
          if (definitionRe.test(trimmed)) {
            definitions.push(`${file.displayPath}:L${String(lineNumber)} def ${trimmed.slice(0, 140)}`);
          } else if (referenceRe.test(trimmed)) {
            references.push(`${file.displayPath}:L${String(lineNumber)} ref ${trimmed.slice(0, 140)}`);
          }
          if (definitions.length + references.length >= maxResults * 2) break;
        }
      }
      const output = [
        `<liora_symbol name="${input.name}">`,
        `definitions: ${String(definitions.length)}`,
        ...definitions.slice(0, maxResults).map((line) => `- ${line}`),
        `references: ${String(references.length)}`,
        ...references.slice(0, maxResults).map((line) => `- ${line}`),
        'next: LioraRead(mode=lines) or Read for exact edit bytes.',
        '</liora_symbol>',
      ].join('\n');
      return { output };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
