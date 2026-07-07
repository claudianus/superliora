import type { Kaos } from '@superliora/kaos';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import type { WorkspaceConfig } from '../../support/workspace';
import { collectContextFiles } from './context-discovery';
import { buildCallgraph, renderCallgraph } from './context-callgraph';
import { isLeanCodegraphV2Enabled } from '../../../lean-context/graph/enabled';
import { buildIndexedCallgraph } from '../../../lean-context/graph/callgraph';
import { ensureWorkspaceIndex } from '../../../lean-context/index/ensure';
import { getGraphDatabase } from '../../../lean-context/graph/pipeline';

export const LIORA_CALLGRAPH_TOOL_NAME = 'LioraCallgraph';

export const LioraCallgraphInputSchema = z.object({
  symbol: z.string().min(1).describe('Symbol to trace.'),
  direction: z
    .enum(['callers', 'callees', 'both'])
    .optional()
    .describe('Trace direction. Default both.'),
  path: z.string().optional().describe('Optional scope path.'),
});

export type LioraCallgraphInput = z.infer<typeof LioraCallgraphInputSchema>;

const DESCRIPTION = [
  'Compact caller/callee/import graph for impact analysis.',
  'Use for hidden dependencies; use LioraSearch for const/static string references.',
].join(' ');

export class LioraCallgraphTool implements BuiltinTool<LioraCallgraphInput> {
  readonly name = LIORA_CALLGRAPH_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LioraCallgraphInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
  ) {}

  resolveExecution(args: LioraCallgraphInput): ToolExecution {
    const parsed = LioraCallgraphInputSchema.safeParse(args);
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
      description: `Tracing ${parsed.data.symbol}`,
      approvalRule: this.name,
      execute: () => this.execution(parsed.data, explicitPaths),
    };
  }

  private async execution(
    input: LioraCallgraphInput,
    explicitPaths: readonly string[] | undefined,
  ): Promise<ExecutableToolResult> {
    try {
      if (isLeanCodegraphV2Enabled() && explicitPaths === undefined) {
        await ensureWorkspaceIndex(this.kaos, this.workspace);
        const graph = buildIndexedCallgraph(
          getGraphDatabase(this.workspace),
          input.symbol,
          input.direction ?? 'both',
        );
        return { output: renderCallgraph(graph) };
      }
      const files = await collectContextFiles({
        kaos: this.kaos,
        workspace: this.workspace,
        explicitPaths,
        query: input.symbol,
      });
      const graph = buildCallgraph(files, input.symbol, input.direction ?? 'both');
      return { output: renderCallgraph(graph) };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}
