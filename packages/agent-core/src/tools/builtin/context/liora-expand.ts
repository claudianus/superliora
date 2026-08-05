import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import type { ToolStore } from '../../store';
import { expandArchivedContent } from './context-archive';

export const EXPAND_TOOL_NAME = 'Expand';

export const ExpandInputSchema = z.object({
  id: z.string().min(4).describe('Archive id from [liora-archived id=...] markers.'),
  start_line: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(400).optional(),
});

export type ExpandInput = z.infer<typeof ExpandInputSchema>;

/** Default page size for unscoped expand — full dumps thrash long sessions. */
export const EXPAND_DEFAULT_LIMIT = 120;

const EXPAND_DESCRIPTION = [
  'Recover reversibly archived compressed output bytes.',
  'Use when LioraRead/Bash compressed output and you need the omitted section.',
].join(' ');

export class ExpandTool implements BuiltinTool<ExpandInput> {
  readonly name: string = EXPAND_TOOL_NAME;
  readonly description: string = EXPAND_DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ExpandInputSchema);

  constructor(protected readonly store: ToolStore) {}

  resolveExecution(args: ExpandInput): ToolExecution {
    const parsed = ExpandInputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true, output: parsed.error.issues.map((issue) => issue.message).join('\n') };
    }
    return {
      accesses: ToolAccesses.none(),
      description: `Expanding archive ${parsed.data.id}`,
      readOnly: true,
      approvalRule: this.name,
      execute: async () => this.execution(parsed.data),
    };
  }

  private execution(input: ExpandInput): ExecutableToolResult {
    const expanded = expandArchivedContent(this.store, input.id);
    if (!expanded.found) {
      return { isError: true, output: `Archive id "${input.id}" was not found in this session.` };
    }
    const lines = expanded.entry.content.split(/\r?\n/);
    const start = Math.max(1, input.start_line ?? 1);
    const limit = input.limit ?? EXPAND_DEFAULT_LIMIT;
    // Unscoped expand still pages — full archive dumps thrash long-horizon context.
    const windowed = input.start_line !== undefined || input.limit !== undefined;
    const effectiveLimit = windowed ? limit : Math.min(limit, EXPAND_DEFAULT_LIMIT);
    const slice = lines.slice(start - 1, start - 1 + effectiveLimit);
    const truncated = start - 1 + slice.length < lines.length;
    const header = [
      `<expand id="${input.id}" label="${expanded.entry.label}">`,
      `window: ${String(start)}-${String(start + slice.length - 1)} of ${String(lines.length)}`,
    ];
    if (truncated) {
      header.push(
        `truncated: pass start_line/limit to page (default ${String(EXPAND_DEFAULT_LIMIT)} lines)`,
      );
    }
    return {
      output: [
        ...header,
        ...slice.map((line, index) => `${String(start + index)}\t${line}`),
        '</expand>',
      ].join('\n'),
    };
  }
}

export function createExpandTool(store: ToolStore): ExpandTool {
  return new ExpandTool(store);
}
