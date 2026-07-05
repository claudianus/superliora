import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import { expandArchivedContent } from './context-archive';

export const LIORA_EXPAND_TOOL_NAME = 'LioraExpand';

export const LioraExpandInputSchema = z.object({
  id: z.string().min(4).describe('Archive id from [liora-archived id=...] markers.'),
  start_line: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(400).optional(),
});

export type LioraExpandInput = z.infer<typeof LioraExpandInputSchema>;

const DESCRIPTION = [
  'Recover reversibly archived lean-context bytes.',
  'Use when LioraRead/LioraSearch/Bash compressed output and you need the omitted section.',
].join(' ');

export class LioraExpandTool implements BuiltinTool<LioraExpandInput> {
  readonly name = LIORA_EXPAND_TOOL_NAME;
  readonly description = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(LioraExpandInputSchema);

  constructor(private readonly store: ToolStore) {}

  resolveExecution(args: LioraExpandInput): ToolExecution {
    const parsed = LioraExpandInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: parsed.error.issues.map((issue) => issue.message).join('\n') };
    }
    return {
      description: `Expanding archive ${parsed.data.id}`,
      approvalRule: this.name,
      execute: async () => this.execution(parsed.data),
    };
  }

  private execution(input: LioraExpandInput): ExecutableToolResult {
    const expanded = expandArchivedContent(this.store, input.id);
    if (!expanded.found) {
      return { isError: true, output: `Archive id "${input.id}" was not found in this session.` };
    }
    const lines = expanded.entry.content.split(/\r?\n/);
    if (input.start_line !== undefined || input.limit !== undefined) {
      const start = Math.max(1, input.start_line ?? 1);
      const limit = input.limit ?? 120;
      const slice = lines.slice(start - 1, start - 1 + limit);
      return {
        output: [
          `<liora_expand id="${input.id}" label="${expanded.entry.label}">`,
          `window: ${String(start)}-${String(start + slice.length - 1)} of ${String(lines.length)}`,
          ...slice.map((line, index) => `${String(start + index)}\t${line}`),
          '</liora_expand>',
        ].join('\n'),
      };
    }
    return {
      output: [
        `<liora_expand id="${input.id}" label="${expanded.entry.label}">`,
        expanded.entry.content,
        '</liora_expand>',
      ].join('\n'),
    };
  }
}
