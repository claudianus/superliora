import type { Kaos } from '@superliora/kaos';
import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { resolvePathAccessPath } from '../../policies/path-access';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import { appendTextToolMeta } from '../../support/text-result-meta';
import type { WorkspaceConfig } from '../../support/workspace';
import { archiveContent } from './context-archive';
import { renderTerseRead } from './context-terse';

export const LIORA_READ_TOOL_NAME = 'LioraRead';

export const LioraReadInputSchema = z.object({
  path: z.string().min(1).describe('File path. Relative paths resolve from the workspace.'),
  mode: z
    .enum(['auto', 'full', 'signatures', 'map', 'lines'])
    .optional()
    .describe(
      'Compression mode. auto=signatures for large files, full for small. signatures=API surface only. map=structure. lines=windowed read.',
    ),
  start_line: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(400).optional(),
  line_offset: z.number().int().min(1).optional().describe('Alias for start_line; accepted for consistency with Read.'),
  n_lines: z.number().int().min(1).max(400).optional().describe('Alias for limit; accepted for consistency with Read.'),
  raw: z.boolean().optional().describe('When true, skip compression and return full content.'),
});

export type LioraReadInput = z.infer<typeof LioraReadInputSchema>;

const DESCRIPTION = [
  'Token-efficient file read with lean context modes.',
  'Prefer this over Read for orientation (mode=signatures|map|auto) and use Read only for edit-ready exact bytes.',
  'Overflow is archived reversibly — recover with LioraExpand.',
].join(' ');

export class LioraReadTool implements BuiltinTool<LioraReadInput> {
  readonly name = LIORA_READ_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LioraReadInputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly workspace: WorkspaceConfig,
    private readonly store: ToolStore,
  ) {}

  resolveExecution(args: LioraReadInput): ToolExecution {
    const parsed = LioraReadInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: parsed.error.issues.map((issue) => issue.message).join('\n') };
    }
    const normalized = normalizeLioraReadInput(parsed.data);
    const path = resolvePathAccessPath(normalized.path, {
      kaos: this.kaos,
      workspace: this.workspace,
      operation: 'read',
    });
    return {
      accesses: ToolAccesses.readFile(path),
      description: `LioraRead ${normalized.path}`,
      approvalRule: this.name,
      execute: () => this.execution(normalized, path),
    };
  }

  private async execution(input: LioraReadInput, safePath: string): Promise<ExecutableToolResult> {
    try {
      const content = await this.kaos.readText(safePath, { errors: 'strict' });
      const displayPath = relativeDisplayPath(safePath, this.workspace);
      if (input.raw === true || input.mode === 'full') {
        const rendered = renderTerseRead({
          content,
          displayPath,
          mode: 'full',
        });
        return finalize(rendered.text, rendered.overflow, this.store, displayPath, {
          mode: rendered.modeUsed,
          partial: rendered.renderedLines < rendered.lineCount,
          truncated: rendered.overflow !== undefined,
          lineCount: rendered.lineCount,
          renderedLines: rendered.renderedLines,
        });
      }
      const rendered = renderTerseRead({
        content,
        displayPath,
        mode: input.mode ?? 'auto',
        startLine: input.start_line,
        limit: input.limit,
      });
      return finalize(rendered.text, rendered.overflow, this.store, displayPath, {
        mode: rendered.modeUsed,
        partial: rendered.renderedLines < rendered.lineCount,
        truncated: rendered.overflow !== undefined,
        lineCount: rendered.lineCount,
        renderedLines: rendered.renderedLines,
      });
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}

function finalize(
  text: string,
  overflow: string | undefined,
  store: ToolStore,
  displayPath: string,
  meta: {
    readonly mode: string;
    readonly partial: boolean;
    readonly truncated: boolean;
    readonly lineCount: number;
    readonly renderedLines: number;
  },
): ExecutableToolResult {
  const summary = `Rendered ${String(meta.renderedLines)} of ${String(meta.lineCount)} lines for ${displayPath}.`;
  if (overflow === undefined || overflow.length === 0) {
    return {
      output: appendTextToolMeta(text, {
        tool: LIORA_READ_TOOL_NAME,
        mode: meta.mode,
        partial: meta.partial,
        truncated: meta.truncated,
        summary,
        stats: { total_lines: meta.lineCount, rendered_lines: meta.renderedLines },
        nextStep: 'Use Read for exact edit bytes or LioraRead mode=lines to page a focused window.',
      }),
    };
  }
  const archived = archiveContent({
    store,
    content: overflow,
    label: displayPath,
    path: displayPath,
  });
  return {
    output: appendTextToolMeta(
      `${text}\n${archived.marker}\narchived_summary: ${archived.summary}\nrecover: LioraExpand(id="${archived.id}")`,
      {
        tool: LIORA_READ_TOOL_NAME,
        mode: meta.mode,
        partial: true,
        truncated: true,
        summary,
        stats: { total_lines: meta.lineCount, rendered_lines: meta.renderedLines },
        nextStep: 'Call LioraExpand for archived overflow, or use Read for exact edit-ready bytes.',
      },
    ),
  };
}

function normalizeLioraReadInput(input: LioraReadInput): LioraReadInput {
  return {
    ...input,
    start_line: input.start_line ?? input.line_offset,
    limit: input.limit ?? input.n_lines,
  };
}

function relativeDisplayPath(path: string, workspace: WorkspaceConfig): string {
  if (path === workspace.workspaceDir) return '.';
  if (path.startsWith(workspace.workspaceDir + '/')) return path.slice(workspace.workspaceDir.length + 1);
  return path;
}
