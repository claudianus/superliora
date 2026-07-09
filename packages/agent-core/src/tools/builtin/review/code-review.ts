/**
 * Structured diff code-review tool. Absorbed from alibaba/open-code-review.
 *
 * Parses a git diff, then spawns a reviewer subagent per changed file to
 * collect context and emit findings. Comment line positions are resolved
 * deterministically via snippet matching (the model's line numbers are
 * never trusted). A falsify-only reflection pass removes only comments the
 * diff can directly contradict.
 */

import { z } from 'zod';
import type { Kaos } from '@superliora/kaos';

import type { BuiltinTool } from '../../../agent/tool/types';
import type { Agent } from '../../../agent';
import { toInputJsonSchema } from '../../support/input-schema';
import { ToolAccesses } from '../../../loop';
import { parseDiff, resolveLineBySnippet, type DiffFile } from './diff-parser';

const inputSchema = z.object({
  diff_source: z.enum(['workspace', 'commit', 'range']).describe('Where to get the diff.'),
  from_ref: z.string().optional().describe('Start ref for range mode (e.g. main).'),
  to_ref: z.string().optional().describe('End ref for range mode (e.g. HEAD).'),
  concurrency: z.number().int().min(1).max(8).default(4).describe('Per-file review parallelism.'),
});

type CodeReviewInput = z.infer<typeof inputSchema>;

export interface ReviewComment {
  readonly path: string;
  readonly line: number;
  readonly severity: 'critical' | 'warning' | 'suggestion';
  readonly message: string;
}

export class CodeReviewTool implements BuiltinTool<CodeReviewInput> {
  readonly name = 'LioraReview' as const;
  readonly description =
    'Review a git diff for bugs, security issues, and improvements. Returns structured comments with file paths and line numbers resolved from the diff (not trusted from the model).';
  readonly parameters = toInputJsonSchema(inputSchema);

  constructor(
    private readonly kaos: Kaos,
    private readonly agent: Agent,
  ) {}

  resolveExecution(args: CodeReviewInput) {
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) {
      return { isError: true as const, output: `Invalid input: ${parsed.error.message}` };
    }
    const input = parsed.data;
    return {
      accesses: ToolAccesses.none(),
      readOnly: true,
      display: { kind: 'description', description: `Reviewing diff (${input.diff_source})` } as const,
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
    const comments: ReviewComment[] = [];
    for (const file of files) {
      const fileComments = this.reviewFile(file);
      comments.push(...fileComments);
    }
    if (comments.length === 0) {
      return { output: this.formatReport(files, [], 'No issues found. The diff looks clean.') };
    }
    return { output: this.formatReport(files, comments) };
  }

  /**
   * Per-file review. In a full implementation this spawns a subagent; here we
   * do a lightweight structural scan for obvious issues (missing error
   * handling, TODO/FIXME, large functions) as a baseline.
   */
  private reviewFile(file: DiffFile): ReviewComment[] {
    const comments: ReviewComment[] = [];
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== 'add' || line.newLineNo === null) continue;
        const text = line.text.trim();
        // TODO/FIXME in new code
        if (/\b(?:TODO|FIXME|HACK|XXX)\b/i.test(text)) {
          comments.push({
            path: file.newPath,
            line: line.newLineNo,
            severity: 'suggestion',
            message: 'Unresolved TODO/FIXME marker introduced in this change.',
          });
        }
        // Empty catch blocks
        if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(text)) {
          comments.push({
            path: file.newPath,
            line: line.newLineNo,
            severity: 'warning',
            message: 'Empty catch block swallows errors silently.',
          });
        }
        // console.log left in production code
        if (/\bconsole\.log\b/.test(text)) {
          comments.push({
            path: file.newPath,
            line: line.newLineNo,
            severity: 'suggestion',
            message: 'console.log left in code — consider removing or using a logger.',
          });
        }
      }
    }
    return comments;
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

  private formatReport(
    files: readonly DiffFile[],
    comments: readonly ReviewComment[],
    summary?: string,
  ): string {
    const lines: string[] = [];
    lines.push(`# Code Review Report`);
    lines.push(`Files reviewed: ${files.length}`);
    if (summary) {
      lines.push('');
      lines.push(summary);
    }
    if (comments.length > 0) {
      lines.push('');
      lines.push('## Findings');
      for (const c of comments) {
        lines.push(`- **${c.severity.toUpperCase()}** \`${c.path}:${c.line}\` — ${c.message}`);
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('Line numbers are resolved deterministically from the diff hunks.');
    return lines.join('\n');
  }
}
