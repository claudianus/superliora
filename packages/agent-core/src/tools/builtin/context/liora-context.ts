import type { Kaos } from '@superliora/kaos';
import { z } from 'zod';

import { composeRankContext } from '../../../lean-context/compose/ranker';
import { getIndexBuiltAt } from '../../../lean-context/index/builder';
import { ensureWorkspaceIndex } from '../../../lean-context/index/ensure';
import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import type { WorkspaceConfig } from '../../support/workspace';
import { collectContextFiles } from './context-discovery';
import { persistComposeCache, resolveComposeCache } from './context-compose-cache';
import { renderContextPacket } from './context-render';
import { rankContextFiles } from './context-symbols';

export const LIORA_CONTEXT_TOOL_NAME = 'LioraContext';

export const LioraContextInputSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .optional()
      .describe('Search text or symbol name to build a compact code-context packet around.'),
    paths: z
      .array(z.string().min(1))
      .max(20)
      .optional()
      .describe('Optional file paths to map directly. Relative paths resolve from the workspace.'),
    mode: z
      .enum(['pack', 'search', 'map', 'compose'])
      .optional()
      .describe('pack returns ranked files plus symbols and snippets; search returns matches; map returns symbols; compose bundles orientation + inline evidence (call FIRST).'),
    max_files: z.number().int().min(1).max(20).optional(),
    max_symbols_per_file: z.number().int().min(1).max(40).optional(),
  })
  .refine((input) => input.query !== undefined || (input.paths?.length ?? 0) > 0, {
    message: 'Provide query or paths.',
    path: ['query'],
  });

export type LioraContextInput = z.Infer<typeof LioraContextInputSchema>;

const DESCRIPTION = [
  'Primary orientation tool — call FIRST before broad Read/Grep when exploring code.',
  'compose mode bundles ranked files, symbols, relationships, and inline evidence in one compact packet.',
  'Use LioraRead/LioraSearch/LioraSymbol for follow-up; Read only for edit-ready exact bytes.',
  'Inspired by lean context routing: compact overview first, reversible archives via LioraExpand.',
].join(' ');

export class LioraContextTool implements BuiltinTool<LioraContextInput> {
  readonly name = LIORA_CONTEXT_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LioraContextInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly store?: ToolStore,
  ) {}

  resolveExecution(args: LioraContextInput): ToolExecution {
    const parsed = LioraContextInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: parsed.error.issues.map((issue) => issue.message).join('\n') };
    }
    const explicitPaths = parsed.data.paths?.map((path) =>
      resolvePathAccessPath(path, {
        kaos: this.kaos,
        workspace: this.workspace,
        operation: 'read',
      }),
    );
    return {
      accesses: explicitPaths?.length
        ? explicitPaths.map((path) => ({ kind: 'file' as const, operation: 'read' as const, path }))
        : ToolAccesses.searchTree(this.workspace.workspaceDir),
      description: parsed.data.query
        ? `Building compact context for ${parsed.data.query}`
        : 'Building compact context map',
      approvalRule: this.name,
      execute: () => this.execution(parsed.data, explicitPaths),
    };
  }

  private async execution(
    input: LioraContextInput,
    explicitPaths: readonly string[] | undefined,
  ): Promise<ExecutableToolResult> {
    try {
      const mode = input.mode ?? (input.query !== undefined ? 'compose' : 'pack');
      if (input.query !== undefined && explicitPaths === undefined) {
        const indexBuiltAt = await getIndexBuiltAt(this.kaos, this.workspace);
        const cacheInput = {
          query: input.query,
          mode,
          maxFiles: input.max_files,
          maxSymbolsPerFile: input.max_symbols_per_file,
          indexBuiltAt,
        };
        const cached = await resolveComposeCache(this.kaos, this.workspace, this.store, cacheInput);
        if (cached !== undefined) {
          return { output: `${cached}\nstatus: compose_cache_hit` };
        }
        await ensureWorkspaceIndex(this.kaos, this.workspace);
        const freshIndexBuiltAt = await getIndexBuiltAt(this.kaos, this.workspace);
        const freshCacheInput = { ...cacheInput, indexBuiltAt: freshIndexBuiltAt };
        const composed = await composeRankContext({
          kaos: this.kaos,
          workspace: this.workspace,
          query: input.query,
          maxFiles: input.max_files,
          maxSymbolsPerFile: input.max_symbols_per_file,
        });
        const body = renderContextPacket(composed.ranked, { ...input, mode }, composed.allFiles, {
          strategy: composed.strategy,
        });
        const hint = composed.indexStaleHint === undefined ? '' : `\nstatus: ${composed.indexStaleHint}`;
        const output = `${body}${hint}`;
        await persistComposeCache(this.kaos, this.workspace, this.store, freshCacheInput, output);
        return { output };
      }
      const files = await collectContextFiles({
        kaos: this.kaos,
        workspace: this.workspace,
        explicitPaths,
        query: input.query,
      });
      const ranked = rankContextFiles(files, input);
      return {
        output: renderContextPacket(ranked, { ...input, mode }, files),
      };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}
