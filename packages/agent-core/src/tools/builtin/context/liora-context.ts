import type { Kaos } from '@superliora/kaos';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import type { WorkspaceConfig } from '../../support/workspace';
import { collectContextFiles } from './context-discovery';
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
      .enum(['pack', 'search', 'map'])
      .optional()
      .describe('pack returns ranked files plus symbols and snippets; search returns matches; map returns symbols.'),
    max_files: z.number().int().min(1).max(20).optional(),
    max_symbols_per_file: z.number().int().min(1).max(40).optional(),
  })
  .refine((input) => input.query !== undefined || (input.paths?.length ?? 0) > 0, {
    message: 'Provide query or paths.',
    path: ['query'],
  });

export type LioraContextInput = z.Infer<typeof LioraContextInputSchema>;

const DESCRIPTION = [
  'Build a compact Kimi code-context packet before broad file reads.',
  'Use this first for Ultrawork or coding tasks when you need repo orientation, symbol maps, or query-focused evidence.',
  'It follows Kimi Lean Context / code graph principles: compact overview first, file paths and line evidence, targeted source expansion hints, no full-file dumps.',
].join(' ');

export class LioraContextTool implements BuiltinTool<LioraContextInput> {
  readonly name = LIORA_CONTEXT_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LioraContextInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
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
      const files = await collectContextFiles({
        kaos: this.kaos,
        workspace: this.workspace,
        explicitPaths,
        query: input.query,
      });
      const ranked = rankContextFiles(files, input);
      return { output: renderContextPacket(ranked, input, files) };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}
