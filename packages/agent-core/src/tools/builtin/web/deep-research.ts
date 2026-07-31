/**
 * DeepResearchTool — multi-hop web research via WebSearchProvider.
 *
 * Plans several search queries heuristically (no LLM), fans out through the
 * host-injected provider, merges/dedupes hits, and returns a structured brief.
 */

import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';
import { literalRulePattern, matchesGlobRuleSubject } from '../../support/rule-match';
import { ToolResultBuilder } from '../../support/result-builder';
import {
  assessSearchChannelHealth,
  buildSearchNeverEmptyNextStep,
  inferSearchChannelsFromStatus,
} from '../../providers/research-search-health';
import { recordSearchNeverEmptySoftDegrade } from '../../providers/search-never-empty-telemetry';
import type { WebSearchProvider, WebSearchResult } from './web-search';
import DESCRIPTION from './deep-research.md?raw';

// ── Input schema ─────────────────────────────────────────────────────

export const DeepResearchFreshnessSchema = z.enum(['any', 'day', 'week', 'month', 'year']);
export type DeepResearchFreshness = z.infer<typeof DeepResearchFreshnessSchema>;

export const DeepResearchDepthSchema = z.enum(['quick', 'standard', 'exhaustive']);
export type DeepResearchDepth = z.infer<typeof DeepResearchDepthSchema>;

export const DeepResearchInputSchema = z.object({
  question: z.string().describe('Research question or topic to investigate.'),
  freshness: DeepResearchFreshnessSchema.default('any')
    .describe('Prefer recent sources when not `any`.')
    .optional(),
  depth: DeepResearchDepthSchema.default('standard')
    .describe('Search breadth: quick (3/query), standard (5), exhaustive (8).')
    .optional(),
  max_sources: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(8)
    .describe('Maximum merged sources to return (default 8).')
    .optional(),
});

export type DeepResearchInput = z.infer<typeof DeepResearchInputSchema>;

// ── Query planning & merge helpers (pure) ────────────────────────────

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
]);

export interface RankedResearchSource extends WebSearchResult {
  hitCount: number;
  matchedQueries: string[];
}

export function depthSearchLimit(depth: DeepResearchDepth = 'standard'): number {
  switch (depth) {
    case 'quick':
      return 3;
    case 'exhaustive':
      return 8;
    default:
      return 5;
  }
}

export function extractKeyTerms(question: string): string[] {
  const words = question
    .toLowerCase()
    .replaceAll(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 3);
}

export function planDeepResearchQueries(
  question: string,
  freshness: DeepResearchFreshness = 'any',
): string[] {
  const trimmed = question.trim();
  if (trimmed.length === 0) return [];

  const queries = new Set<string>();
  const add = (query: string) => {
    const normalized = query.trim().replaceAll(/\s+/g, ' ');
    if (normalized.length > 0) queries.add(normalized);
  };

  add(trimmed);
  add(`${trimmed} overview`);

  if (freshness !== 'any') {
    add(`latest ${trimmed}`);
    add(`${trimmed} ${freshness}`);
  }

  for (const term of extractKeyTerms(trimmed)) {
    add(`${term} ${trimmed}`);
  }

  return [...queries].slice(0, 5);
}

export function normalizeResearchUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (parsed.pathname.endsWith('/') && parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url.trim().toLowerCase();
  }
}

export function mergeResearchSources(
  batches: ReadonlyArray<{ readonly query: string; readonly results: readonly WebSearchResult[] }>,
  maxSources: number,
): RankedResearchSource[] {
  const byUrl = new Map<string, RankedResearchSource>();

  for (const batch of batches) {
    for (const result of batch.results) {
      const key = normalizeResearchUrl(result.url);
      const existing = byUrl.get(key);
      if (existing !== undefined) {
        existing.hitCount += 1;
        if (!existing.matchedQueries.includes(batch.query)) {
          existing.matchedQueries.push(batch.query);
        }
        if (result.snippet.length > existing.snippet.length) {
          existing.snippet = result.snippet;
          existing.title = result.title;
          if (result.date !== undefined) existing.date = result.date;
        }
        continue;
      }
      byUrl.set(key, {
        ...result,
        hitCount: 1,
        matchedQueries: [batch.query],
      });
    }
  }

  return [...byUrl.values()]
    .toSorted((left, right) => {
      const leftScore = left.hitCount * 1000 + left.snippet.length;
      const rightScore = right.hitCount * 1000 + right.snippet.length;
      return rightScore - leftScore;
    })
    .slice(0, maxSources);
}

export function formatDeepResearchChannelsTried(channels: readonly string[]): string {
  return channels.length === 0 ? '(none)' : channels.join(' | ');
}

export function buildDeepResearchOutput(options: {
  question: string;
  queries: readonly string[];
  sources: readonly RankedResearchSource[];
  degraded: boolean;
  hops: number;
  channelsTried: readonly string[];
  health?: ReturnType<typeof assessSearchChannelHealth> | undefined;
}): string {
  const lines: string[] = [];
  lines.push(`question: ${options.question.trim()}`);
  lines.push('');

  lines.push('answer_outline:');
  if (options.sources.length === 0) {
    lines.push('- No live sources returned across planned queries.');
  } else {
    for (const source of options.sources.slice(0, 5)) {
      lines.push(`- ${source.title}: ${truncateSnippet(source.snippet, 160)}`);
    }
  }
  lines.push('');

  lines.push('claims:');
  if (options.sources.length === 0) {
    lines.push('- (none — insufficient evidence)');
  } else {
    for (const source of options.sources.slice(0, 6)) {
      lines.push(`- ${truncateSnippet(source.snippet, 200)} (${source.url})`);
    }
  }
  lines.push('');

  lines.push('sources:');
  if (options.sources.length === 0) {
    lines.push('- (empty)');
  } else {
    for (const [index, source] of options.sources.entries()) {
      lines.push(`${index + 1}. ${source.title}`);
      lines.push(`   url: ${source.url}`);
      if (source.date) lines.push(`   date: ${source.date}`);
      lines.push(`   hits: ${String(source.hitCount)} | queries: ${source.matchedQueries.join(', ')}`);
      lines.push(`   snippet: ${truncateSnippet(source.snippet, 240)}`);
    }
  }
  lines.push('');

  lines.push(`channels_used: ${options.queries.join(' | ')}`);
  lines.push(`hops: ${String(options.hops)}`);
  lines.push(`channelsTried: ${formatDeepResearchChannelsTried(options.channelsTried)}`);
  lines.push(`degraded: ${options.degraded ? 'true' : 'false'}`);

  if (options.degraded) {
    lines.push(
      `next: ${buildSearchNeverEmptyNextStep({
        health: options.health,
        channelsTried: options.channelsTried,
      })}`,
    );
  }

  return lines.join('\n');
}

function truncateSnippet(text: string, maxLength: number): string {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

// ── Implementation ───────────────────────────────────────────────────

export class DeepResearchTool implements BuiltinTool<DeepResearchInput> {
  readonly name = 'DeepResearch' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(DeepResearchInputSchema);
  constructor(private readonly provider: WebSearchProvider) {}

  resolveExecution(args: DeepResearchInput): ToolExecution {
    const preview =
      args.question.length > 40 ? `${args.question.slice(0, 40)}…` : args.question;
    return {
      accesses: ToolAccesses.none(),
      readOnly: true,
      description: `Researching: ${preview}`,
      display: { kind: 'search', query: args.question },
      approvalRule: literalRulePattern(this.name, args.question),
      matchesRule: (ruleArgs) => matchesGlobRuleSubject(ruleArgs, args.question),
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: DeepResearchInput,
    { toolCallId }: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    try {
      const freshness = args.freshness ?? 'any';
      const depth = args.depth ?? 'standard';
      const maxSources = args.max_sources ?? 8;
      const queries = planDeepResearchQueries(args.question, freshness);
      const perQueryLimit = depthSearchLimit(depth);

      const settled = await Promise.allSettled(
        queries.map(async (query) => ({
          query,
          results: await this.provider.search(query, { limit: perQueryLimit, toolCallId }),
        })),
      );

      const batches = settled
        .filter(
          (entry): entry is PromiseFulfilledResult<{ query: string; results: WebSearchResult[] }> =>
            entry.status === 'fulfilled',
        )
        .map((entry) => entry.value);

      const sources = mergeResearchSources(batches, maxSources);
      const status = this.provider.status?.();
      const health = status === undefined ? undefined : assessSearchChannelHealth(status);
      const channelsTried =
        status === undefined ? [] : inferSearchChannelsFromStatus(status);
      const degraded = sources.length === 0 || health?.degraded === true;
      if (degraded) {
        recordSearchNeverEmptySoftDegrade();
      }
      const hops = batches.length > 0 ? batches.length : queries.length;
      const builder = new ToolResultBuilder({ maxChars: 12_000, maxLineLength: null });
      builder.write(
        buildDeepResearchOutput({
          question: args.question,
          queries,
          sources,
          degraded,
          hops,
          channelsTried,
          health,
        }),
      );
      return builder.ok();
    } catch (error) {
      recordSearchNeverEmptySoftDegrade();
      const status = this.provider.status?.();
      const health = status === undefined ? undefined : assessSearchChannelHealth(status);
      const channelsTried =
        status === undefined ? [] : inferSearchChannelsFromStatus(status);
      return {
        isError: false,
        output: [
          classifyResearchError(error),
          'hops: 0',
          `channelsTried: ${formatDeepResearchChannelsTried(channelsTried)}`,
          'degraded: true',
          `next: ${buildSearchNeverEmptyNextStep({ health, channelsTried })}`,
        ].join('\n'),
      };
    }
  }
}

function classifyResearchError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (name === 'AbortError' || lower.includes('abort')) {
    return `Research cancelled: ${message}`;
  }
  if (name === 'TimeoutError' || lower.includes('timed out') || lower.includes('timeout')) {
    return `Research timed out: ${message}`;
  }
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('auth')) {
    return `Research failed (authentication): ${message}`;
  }
  if (
    lower.includes('http ') ||
    lower.includes('network') ||
    lower.includes('fetch') ||
    name === 'TypeError'
  ) {
    return `Research failed (network): ${message}`;
  }
  return `Research failed: ${message}`;
}
