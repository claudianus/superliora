import type { Kaos } from '@superliora/kaos';
import { z } from 'zod';

import { queryIndexedPaths } from '../../../lean-context/index/builder';
import { ensureWorkspaceIndex } from '../../../lean-context/index/ensure';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import { appendTextToolMeta } from '../../support/text-result-meta';
import type { WorkspaceConfig } from '../../support/workspace';
import { archiveContent } from './context-archive';
import { collectContextFiles } from './context-discovery';

export const LIORA_SEARCH_TOOL_NAME = 'LioraSearch';

export const LioraSearchInputSchema = z.object({
  pattern: z.string().min(1).describe('Regex or plain-text pattern to search for.'),
  path: z.string().optional().describe('Optional file or directory scope.'),
  max_matches: z.number().int().min(1).max(80).optional(),
  limit: z.number().int().min(1).max(80).optional().describe('Alias for max_matches.'),
  case_insensitive: z.boolean().optional(),
  literal: z.boolean().optional().describe('Treat pattern as literal text instead of regex.'),
});

export type LioraSearchInput = z.infer<typeof LioraSearchInputSchema>;

const DESCRIPTION = [
  'Token-efficient content search with compact match lines.',
  'Prefer this over Grep for orientation; use Grep when you need ripgrep-specific modes.',
].join(' ');

export class LioraSearchTool implements BuiltinTool<LioraSearchInput> {
  readonly name = LIORA_SEARCH_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LioraSearchInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly store: ToolStore,
  ) {}

  resolveExecution(args: LioraSearchInput): ToolExecution {
    const parsed = LioraSearchInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: parsed.error.issues.map((issue) => issue.message).join('\n') };
    }
    const normalized = normalizeLioraSearchInput(parsed.data);
    const explicitPaths =
      normalized.path === undefined
        ? undefined
        : [
            resolvePathAccessPath(normalized.path, {
              kaos: this.kaos,
              workspace: this.workspace,
              operation: 'read',
            }),
          ];
    return {
      accesses: explicitPaths?.length
        ? explicitPaths.map((path) => ({ kind: 'file' as const, operation: 'read' as const, path }))
        : ToolAccesses.searchTree(this.workspace.workspaceDir),
      description: `Searching for ${normalized.pattern}`,
      readOnly: true,
      approvalRule: this.name,
      execute: () => this.execution(normalized, explicitPaths),
    };
  }

  private async execution(
    input: LioraSearchInput,
    explicitPaths: readonly string[] | undefined,
  ): Promise<ExecutableToolResult> {
    try {
      let scopedPaths = explicitPaths;
      let source: 'filesystem' | 'index' = 'filesystem';
      if (scopedPaths === undefined) {
        await ensureWorkspaceIndex(this.kaos, this.workspace);
        const indexed = await queryIndexedPaths(this.kaos, this.workspace, input.pattern, 40);
        if (indexed.length > 0) {
          scopedPaths = indexed;
          source = 'index';
        }
      }
      const files = await collectContextFiles({
        kaos: this.kaos,
        workspace: this.workspace,
        explicitPaths: scopedPaths,
        query: input.pattern,
      });
      const maxMatches = input.max_matches ?? 30;
      const flags = input.case_insensitive === true ? 'iu' : 'u';
      const resolved = resolvePattern(input.pattern, flags, input.literal === true);
      const pattern = resolved.pattern;
      const matches: string[] = [];
      const overflowLines: string[] = [];
      for (const file of files) {
        const lines = file.content.split(/\r?\n/);
        for (const [index, line] of lines.entries()) {
          if (!pattern.test(line)) continue;
          const formatted = `${file.displayPath}:L${String(index + 1)} ${line.trim().slice(0, 160)}`;
          if (matches.length < maxMatches) matches.push(formatted);
          else overflowLines.push(formatted);
        }
      }
      const body = [
        `<liora_search pattern="${input.pattern}">`,
        `matches: ${String(matches.length + overflowLines.length)}`,
        ...matches.map((line) => `- ${line}`),
      ];
      if (overflowLines.length > 0) {
        const archived = archiveContent({
          store: this.store,
          content: overflowLines.join('\n'),
          label: `search:${input.pattern}`,
        });
        body.push(`${archived.marker}`);
        body.push(`archived_overflow: ${String(overflowLines.length)} matches`);
        body.push(`recover: LioraExpand(id="${archived.id}")`);
      }
      body.push('</liora_search>');
      return {
        output: appendTextToolMeta(body.join('\n'), {
          tool: LIORA_SEARCH_TOOL_NAME,
          mode: resolved.interpretation,
          partial: overflowLines.length > 0,
          truncated: overflowLines.length > 0,
          summary: `Found ${String(matches.length + overflowLines.length)} matches across ${String(files.length)} file(s).`,
          stats: {
            files_considered: files.length,
            matches: matches.length + overflowLines.length,
            source,
          },
          nextStep: 'Use Grep for exact ripgrep behavior, or LioraRead/Read to inspect matched files.',
        }),
      };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}

function resolvePattern(
  pattern: string,
  flags: string,
  literal: boolean,
): { pattern: RegExp; interpretation: 'literal' | 'regex' } {
  if (literal) {
    return { pattern: new RegExp(escapeRegExp(pattern), flags), interpretation: 'literal' };
  }
  try {
    return { pattern: new RegExp(pattern, flags), interpretation: 'regex' };
  } catch {
    return { pattern: new RegExp(escapeRegExp(pattern), flags), interpretation: 'literal' };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizeLioraSearchInput(input: LioraSearchInput): LioraSearchInput {
  return {
    ...input,
    max_matches: input.max_matches ?? input.limit,
  };
}
