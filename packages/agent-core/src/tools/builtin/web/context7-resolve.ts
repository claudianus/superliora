/**
 * Context7ResolveTool — resolve library names to Context7-compatible IDs.
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
import DESCRIPTION from './context7-resolve.md?raw';

export const Context7ResolveInputSchema = z.object({
  library_name: z
    .string()
    .describe('Library or framework name to search for (e.g. "next.js", "pydantic", "shadcn/ui").'),
  query: z
    .string()
    .describe(
      'The user task or question — used to rank library matches by relevance. Be specific about the API or feature you need.',
    ),
});

export type Context7ResolveInput = z.infer<typeof Context7ResolveInputSchema>;

export class Context7ResolveTool implements BuiltinTool<Context7ResolveInput> {
  readonly name = 'Context7Resolve' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(Context7ResolveInputSchema);

  constructor(private readonly provider: Context7Provider) {}

  resolveExecution(args: Context7ResolveInput): ToolExecution {
    const preview =
      args.library_name.length > 32 ? `${args.library_name.slice(0, 32)}…` : args.library_name;
    return {
      accesses: ToolAccesses.none(),
      description: `Context7 resolve: ${preview}`,
      display: { kind: 'search', query: args.library_name },
      approvalRule: literalRulePattern(this.name, args.library_name),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.library_name),
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: Context7ResolveInput,
    { toolCallId }: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    try {
      const text = await this.provider.searchLibraryText(args.query, args.library_name, {
        toolCallId,
      });
      const builder = new ToolResultBuilder({ maxLineLength: null });
      builder.write(text.trim().length > 0 ? text : 'No libraries found for that name.');
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
