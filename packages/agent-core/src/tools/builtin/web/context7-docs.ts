/**
 * Context7DocsTool — fetch version-specific library documentation from Context7.
 *
 * Host-injected via `Context7Provider`. When no provider is configured,
 * the tool is not registered.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import type { Context7Provider } from '../../providers/context7';
import { Context7Error } from '../../providers/context7';
import { isContext7SetupCancelled } from '../../providers/context7-session';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesGlobRuleSubject } from '../../support/rule-match';
import { ToolResultBuilder } from '../../support/result-builder';
import DESCRIPTION from './context7-docs.md?raw';

const LIBRARY_ID_PATTERN = /^\/[^/\s]+(?:\/[^/\s]+(?:\/[^/\s]+)?)?$/;

export const Context7DocsInputSchema = z.object({
  library_id: z
    .string()
    .describe(
      'Exact Context7-compatible library ID from Context7Resolve or the user (e.g. "/vercel/next.js", "/mongodb/docs", "/vercel/next.js/v15.0.0").',
    ),
  query: z
    .string()
    .describe(
      'Focused question or task — returns the most relevant documentation snippets and code examples for this library.',
    ),
});

export type Context7DocsInput = z.infer<typeof Context7DocsInputSchema>;

export class Context7DocsTool implements BuiltinTool<Context7DocsInput> {
  readonly name = 'Context7Docs' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(Context7DocsInputSchema);

  constructor(private readonly provider: Context7Provider) {}

  resolveExecution(args: Context7DocsInput): ToolExecution {
    const preview = args.library_id.length > 40 ? `${args.library_id.slice(0, 40)}…` : args.library_id;
    return {
      accesses: ToolAccesses.none(),
      readOnly: true,
      description: `Context7 docs: ${preview}`,
      display: { kind: 'search', query: args.query },
      approvalRule: literalRulePattern(this.name, args.library_id),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.library_id),
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: Context7DocsInput,
    { toolCallId }: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    if (!LIBRARY_ID_PATTERN.test(args.library_id.trim())) {
      return {
        isError: true,
        output:
          'Invalid library_id format. Expected `/org/project` or `/org/project/version`. Call Context7Resolve first unless the user supplied a valid ID.',
      };
    }

    try {
      const text = await this.provider.getContextText(args.query, args.library_id.trim(), {
        toolCallId,
      });
      const builder = new ToolResultBuilder({ maxLineLength: null });
      builder.write(text.trim().length > 0 ? text : 'No documentation snippets matched that query.');
      return builder.ok();
    } catch (error) {
      return {
        isError: true,
        output: classifyContext7Error(error),
      };
    }
  }
}

function classifyContext7Error(error: unknown): string {
  if (isContext7SetupCancelled(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (error instanceof Context7Error) {
    if (lower.includes('invalid') && lower.includes('library')) {
      return `${message} Call Context7Resolve to obtain a valid library ID.`;
    }
    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('api key')) {
      return `Context7 failed (authentication): ${message}`;
    }
    return `Context7 failed: ${message}`;
  }
  if (name === 'AbortError' || lower.includes('abort')) {
    return `Context7 cancelled: ${message}`;
  }
  if (name === 'TimeoutError' || lower.includes('timed out') || lower.includes('timeout')) {
    return `Context7 timed out: ${message}`;
  }
  if (
    lower.includes('http ') ||
    lower.includes('network') ||
    lower.includes('fetch') ||
    name === 'TypeError'
  ) {
    return `Context7 failed (network): ${message}`;
  }
  return `Context7 failed: ${message}`;
}
