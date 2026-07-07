import type { Kaos } from '@superliora/kaos';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import type { TelemetryClient } from '../../../telemetry';
import { noopTelemetryClient } from '../../../telemetry';
import { toInputJsonSchema } from '../../support/input-schema';
import type { WorkspaceConfig } from '../../support/workspace';
import { buildWorkspaceIndex, getIndexStatus } from '../../../lean-context/index/builder';
import { ensureWorkspaceIndex } from '../../../lean-context/index/ensure';

export const LIORA_INDEX_TOOL_NAME = 'LioraIndex';

export const LioraIndexInputSchema = z.object({
  action: z.enum(['status', 'build']).describe('status reports index health; build creates or incrementally updates the workspace index.'),
  full: z
    .boolean()
    .optional()
    .describe('When true with action=build, rebuild from scratch instead of incremental update.'),
});

export type LioraIndexInput = z.infer<typeof LioraIndexInputSchema>;

const DESCRIPTION = [
  'Manage the workspace-scoped Liora Lean Context index under .superliora/index.',
  'Build warms BM25 chunks and import graph used by LioraContext, LioraSearch, and compose ranking.',
].join(' ');

export class LioraIndexTool implements BuiltinTool<LioraIndexInput> {
  readonly name = LIORA_INDEX_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LioraIndexInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly telemetry: TelemetryClient = noopTelemetryClient,
  ) {}

  resolveExecution(args: LioraIndexInput): ToolExecution {
    const parsed = LioraIndexInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: parsed.error.issues.map((issue) => issue.message).join('\n') };
    }
    return {
      description: parsed.data.action === 'build' ? 'Building Liora index' : 'Reading Liora index status',
      approvalRule: this.name,
      execute: () => this.execution(parsed.data),
    };
  }

  private async execution(input: LioraIndexInput): Promise<ExecutableToolResult> {
    try {
      if (input.action === 'status') {
        const status = await getIndexStatus(this.kaos, this.workspace);
        return {
          output: [
            '<liora_index status>',
            `ready: ${String(status.ready)}`,
            `stale: ${String(status.stale)}`,
            `index_dir: ${status.indexDir}`,
            `chunks: ${String(status.chunkCount)}`,
            `edges: ${String(status.edgeCount)}`,
            status.stale ? 'hint: run LioraIndex action=build' : 'hint: index ready for LioraContext/LioraSearch',
            '</liora_index>',
          ].join('\n'),
        };
      }
      const stats = await buildWorkspaceIndex({
        kaos: this.kaos,
        workspace: this.workspace,
        incremental: input.full !== true,
      });
      this.telemetry.track('lean_context_index_build', {
        files_indexed: stats.filesIndexed,
        chunks_indexed: stats.chunksIndexed,
        edges_indexed: stats.edgesIndexed,
        incremental: stats.incremental,
        duration_ms: stats.durationMs,
      });
      return {
        output: [
          '<liora_index build>',
          `files_indexed: ${String(stats.filesIndexed)}`,
          `chunks_indexed: ${String(stats.chunksIndexed)}`,
          `edges_indexed: ${String(stats.edgesIndexed)}`,
          `incremental: ${String(stats.incremental)}`,
          `duration_ms: ${String(stats.durationMs)}`,
          '</liora_index>',
        ].join('\n'),
      };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}

export async function warmWorkspaceIndex(kaos: Kaos, workspace: WorkspaceConfig): Promise<void> {
  await ensureWorkspaceIndex(kaos, workspace);
}
