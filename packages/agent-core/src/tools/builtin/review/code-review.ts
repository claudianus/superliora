/**
 * Structured diff inventory tool. Parses a git diff into file paths and
 * added/removed line counts. Does not judge quality — Conductor/worker LLM
 * inspects exceptions. Mechanical type/lint/protocol stay on their own tools.
 */

import { z } from 'zod';
import type { Kaos } from '@superliora/kaos';

import type { BuiltinTool } from '../../../agent/tool/types';
import type { Agent } from '../../../agent/index';
import { toInputJsonSchema } from '../../support/input-schema';
import { ToolAccesses, type ToolExecution } from '../../../loop';
import { parseDiff, type DiffFile } from './diff-parser';
import { inventoryDiffFiles, type ReviewFileInventory } from './review-heuristics';

const inputSchema = z.object({
  diff_source: z.enum(['workspace', 'commit', 'range']).describe('Where to get the diff.'),
  from_ref: z.string().optional().describe('Start ref for range mode (e.g. main).'),
  to_ref: z.string().optional().describe('End ref for range mode (e.g. HEAD).'),
  concurrency: z.number().int().min(1).max(8).default(4).describe('Per-file review parallelism.'),
});

type CodeReviewInput = z.infer<typeof inputSchema>;

export const REVIEW_JUDGMENT_DEFERRED =
  'No regex quality policy. Inspect exceptions on the Conductor/worker LLM — this tool only inventories the diff.';

const REVIEW_INVENTORY_DESCRIPTION =
  'Parse a git diff into a mechanical file inventory (paths and added/removed line counts). Does not judge quality, style, or security — Conductor/worker LLM inspects exceptions. Prefer this over regex/heuristic policy.';

const LIORA_REVIEW_DESCRIPTION =
  `Legacy/advanced alias of Review. Prefer Review for new work. ${REVIEW_INVENTORY_DESCRIPTION}`;

export class CodeReviewTool implements BuiltinTool<CodeReviewInput> {
  readonly name: string = 'LioraReview';
  readonly description: string = LIORA_REVIEW_DESCRIPTION;
  readonly parameters = toInputJsonSchema(inputSchema);

  constructor(
    private readonly kaos: Kaos,
    _agent: Agent,
  ) {}

  resolveExecution(args: CodeReviewInput): ToolExecution {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true as const, output: `Invalid input: ${parsed.error.message}` };
    }
    const input = parsed.data;
    return {
      accesses: ToolAccesses.none(),
      readOnly: true,
      display: { kind: 'generic', summary: `Inventorying diff (${input.diff_source})` },
      approvalRule: 'LioraReview' as const,
      execute: async () => this.runReview(input),
    };
  }

  private async runReview(input: CodeReviewInput) {
    const diff = await this.getDiff(input);
    if (diff.trim().length === 0) {
      return { output: 'No changes to review — the diff is empty.' };
    }
    const files = parseDiff(diff);
    if (files.length === 0) {
      return { output: 'No files found in the diff.' };
    }
    const inventory = inventoryDiffFiles(files);
    return { output: formatInventoryReport(files, inventory) };
  }

  private async getDiff(input: CodeReviewInput): Promise<string> {
    const args: string[] = ['diff', '--no-color', '-U3'];
    if (input.diff_source === 'workspace') {
      args.push('HEAD');
    } else if (input.diff_source === 'commit') {
      args.push('HEAD~1', 'HEAD');
    } else {
      args.push(input.from_ref ?? 'main', input.to_ref ?? 'HEAD');
    }
    const proc = await this.kaos.exec('git', ...args);
    proc.stdin.end();
    let stdout = '';
    proc.stdout.setEncoding('utf8');
    for await (const chunk of proc.stdout) stdout += chunk;
    await proc.wait();
    return stdout;
  }
}

function formatInventoryReport(
  files: readonly DiffFile[],
  inventory: readonly ReviewFileInventory[],
): string {
  const lines: string[] = [];
  lines.push('# Code Review Report');
  lines.push(`Files reviewed: ${files.length}`);
  lines.push('');
  lines.push('## Diff inventory');
  for (const item of inventory) {
    lines.push(`- \`${item.path}\` +${item.added} / -${item.removed}`);
  }
  lines.push('');
  lines.push(REVIEW_JUDGMENT_DEFERRED);
  return lines.join('\n');
}

/** Sovereign public name — same implementation as {@link CodeReviewTool}. */
export class ReviewTool extends CodeReviewTool {
  override readonly name = 'Review' as const;
  override readonly description = REVIEW_INVENTORY_DESCRIPTION;
}

/** Factory alias used by ToolManager registration. */
export function createLioraReviewTool(kaos: Kaos, agent: Agent): CodeReviewTool {
  return new CodeReviewTool(kaos, agent);
}

export function createReviewTool(kaos: Kaos, agent: Agent): ReviewTool {
  return new ReviewTool(kaos, agent);
}
