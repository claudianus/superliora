/**
 * VisualDiff builtin — thin kaos wrapper around pure `visualDiff`.
 *
 * Reads two image paths as bytes and returns JSON byte/hash equality (MVP, not SSIM).
 */

import type { Kaos } from '@superliora/kaos';
import { z } from 'zod';

import type { BuiltinTool } from '../agent/tool/types';
import { ToolAccesses } from '../loop/tool-access';
import type { ToolExecution } from '../loop/types';
import { toInputJsonSchema } from './support/input-schema';
import { literalRulePattern } from './support/rule-match';
import { visualDiff } from './visual-diff';

const inputSchema = z.object({
  left_path: z.string().min(1).describe('Path to the left/baseline image file.'),
  right_path: z.string().min(1).describe('Path to the right/candidate image file.'),
});

type VisualDiffToolInput = z.infer<typeof inputSchema>;

export class VisualDiffTool implements BuiltinTool<VisualDiffToolInput> {
  readonly name = 'VisualDiff' as const;
  readonly description =
    'Compare two image files by byte length and sha256 (MVP, not pixel SSIM). Returns JSON with identical, hashes, and lengthDelta.';
  readonly parameters = toInputJsonSchema(inputSchema);

  constructor(private readonly kaos: Kaos) {}

  resolveExecution(args: VisualDiffToolInput): ToolExecution {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true as const, output: `Invalid input: ${parsed.error.message}` };
    }
    const input = parsed.data;
    return {
      accesses: [
        ...ToolAccesses.readFile(input.left_path),
        ...ToolAccesses.readFile(input.right_path),
      ],
      readOnly: true,
      display: {
        kind: 'generic',
        summary: `VisualDiff ${input.left_path} vs ${input.right_path}`,
      },
      approvalRule: literalRulePattern(this.name, `${input.left_path}|${input.right_path}`),
      execute: async () => {
        try {
          const [left, right] = await Promise.all([
            this.kaos.readBytes(input.left_path),
            this.kaos.readBytes(input.right_path),
          ]);
          const result = visualDiff(left, right);
          return { output: JSON.stringify(result, null, 2) };
        } catch (error) {
          return {
            isError: true as const,
            output: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };
  }
}

export function createVisualDiffTool(kaos: Kaos): VisualDiffTool {
  return new VisualDiffTool(kaos);
}
