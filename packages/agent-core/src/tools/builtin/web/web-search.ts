/**
 * WebSearchTool — host-injected web search.
 *
 * kimi-core defines the interface; the host provides the real search
 * implementation via `WebSearchProvider`. If no provider is supplied,
 * the tool should not be registered (not exposed to the LLM).
 *
 * Never-empty: failures and empty results soft-return with `degraded: true`
 * so Goal/Mission loops keep running (see loop-dispatch runtime.degraded emit).
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import type { ResearchSearchStatus } from '../../providers/research-search-types';
import {
  appendSearchNeverEmptySoftFailFooter,
  assessSearchChannelHealth,
  inferSearchChannelsFromStatus,
} from '../../providers/research-search-health';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesGlobRuleSubject } from '../../support/rule-match';
import { ToolResultBuilder } from '../../support/result-builder';
import DESCRIPTION from './web-search.md?raw';

// ── Provider interface (host-injected) ───────────────────────────────

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string | undefined;
  content?: string | undefined;
}

export interface WebSearchProvider {
  search(
    query: string,
    options?: { limit?: number; includeContent?: boolean; toolCallId?: string },
  ): Promise<WebSearchResult[]>;
  /** When implemented (e.g. ResearchSearchEngine), enables channel health hints. */
  status?(): ResearchSearchStatus;
}

// ── Input schema ─────────────────────────────────────────────────────

export const WebSearchInputSchema = z.object({
  query: z.string().describe('The query text to search for.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe(
      'Results to return (default 3, max 10). Prefer a sharper query over raising limit; each extra hit costs quota and tokens.',
    )
    .optional(),
  include_content: z
    .boolean()
    .default(false)
    .describe(
      'Fetch cleaned page bodies for the top 1–2 hits only (can consume a large amount of tokens when this is set to true). Default false — use snippets first, then FetchURL on the 1–2 URLs you will cite. You should avoid enabling this when `limit` is set to a large value.',
    )
    .optional(),
});

export type WebSearchInput = z.Infer<typeof WebSearchInputSchema>;

// ── Implementation ───────────────────────────────────────────────────

export class WebSearchTool implements BuiltinTool<WebSearchInput> {
  readonly name = 'WebSearch' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WebSearchInputSchema);
  constructor(private readonly provider: WebSearchProvider) {}

  resolveExecution(args: WebSearchInput): ToolExecution {
    const preview = args.query.length > 40 ? `${args.query.slice(0, 40)}…` : args.query;
    return {
      accesses: ToolAccesses.none(),
      readOnly: true,
      description: `Searching: ${preview}`,
      display: { kind: 'search', query: args.query },
      approvalRule: literalRulePattern(this.name, args.query),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.query),
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private providerHealth() {
    const status = this.provider.status?.();
    return status === undefined ? undefined : assessSearchChannelHealth(status);
  }

  private async execution(
    args: WebSearchInput,
    {
    toolCallId,
    }: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    const healthBefore = this.providerHealth();
    try {
      const opts: { limit?: number; includeContent?: boolean; toolCallId?: string } = {
        toolCallId,
      };
      if (args.limit !== undefined) opts.limit = args.limit;
      if (args.include_content !== undefined) opts.includeContent = args.include_content;
      const results = await this.provider.search(args.query, opts);
      const healthAfter = this.providerHealth() ?? healthBefore;

      if (results.length === 0) {
        return this.softOk(buildEmptySearchMessage(healthAfter), healthAfter);
      }

      const builder = new ToolResultBuilder({
        maxChars: args.include_content === true ? 8_000 : 4_000,
        maxLineLength: null,
      });

      let first = true;
      for (const result of results) {
        if (!first) builder.write('---\n\n');
        first = false;

        builder.write(`Title: ${result.title}\n`);
        if (result.date) builder.write(`Date: ${result.date}\n`);
        builder.write(`URL: ${result.url}\n`);
        builder.write(`Snippet: ${result.snippet}\n\n`);
        if (result.content) builder.write(`${result.content}\n\n`);
      }

      appendSearchNeverEmptySoftFailFooter(builder, {
        degraded: healthAfter?.degraded === true,
        health: healthAfter,
      });
      return builder.ok();
    } catch (error) {
      const message = classifySearchError(error);
      return this.softOk(message, healthBefore);
    }
  }

  private softOk(
    body: string,
    health: ReturnType<typeof assessSearchChannelHealth> | undefined,
  ): ExecutableToolResult {
    const builder = new ToolResultBuilder({ maxChars: 4_000, maxLineLength: null });
    builder.write(body);
    appendSearchNeverEmptySoftFailFooter(builder, {
      degraded: true,
      health,
      channelsTried: this.providerChannelsTried(),
    });
    return builder.ok();
  }

  private providerChannelsTried(): readonly string[] {
    const status = this.provider.status?.();
    return status === undefined ? [] : inferSearchChannelsFromStatus(status);
  }
}

function buildEmptySearchMessage(
  health: ReturnType<typeof assessSearchChannelHealth> | undefined,
): string {
  if (health?.reason === 'paid_channels_cooling') {
    return (
      'No live search hits from paid channels (cooling). Free fallback may still apply on retry; ' +
      'otherwise escalate to browser automation (Ch4) or Chrome extension bridge (Ch5).'
    );
  }
  if (health?.hard === true) {
    return (
      'No live search hits across all configured channels. ' +
      'Browser automation (Ch4) or Chrome extension bridge (Ch5) may still help, ' +
      'or continue from FetchURL / local repo evidence.'
    );
  }
  return (
    'No live search hits. Retry with a sharper query, browser automation (Ch4) or ' +
    'Chrome extension bridge (Ch5), FetchURL on a known URL, or local repo evidence.'
  );
}

// ── Error classification ─────────────────────────────────────────────

function classifySearchError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (name === 'AbortError' || lower.includes('abort')) {
    return `Search cancelled: ${message}`;
  }
  if (name === 'TimeoutError' || lower.includes('timed out') || lower.includes('timeout')) {
    return `Search timed out: ${message}`;
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
    return `Search failed (authentication): ${message}`;
  }
  if (
    lower.includes('http ') ||
    lower.includes('network') ||
    lower.includes('fetch') ||
    name === 'TypeError'
  ) {
    return `Search failed (network): ${message}`;
  }
  return `Search failed: ${message}`;
}
