/**
 * SearchTools — inventory the agent's tool surface (inspired by OpenHarness
 * `tool_search` + Grok ToolSearchIndex BM25-class ranking). Makes "eyes" for
 * which hands exist so the model stops ignoring dedicated tools.
 */

import { z } from 'zod';

import type { Agent } from '../../../agent/index';
import type { BuiltinTool, ToolInfo } from '../../../agent/tool';
import {
  filterToolsForPublicHelp,
  formatCompatToolHelpHint,
  isCompatBrandingTool,
} from '../../../agent/tool/help-visibility';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { escapeXml, escapeXmlAttr } from '../../../utils/xml-escape';
import { toInputJsonSchema } from '../../support/input-schema';
import searchToolsDescription from './search-tools.md?raw';

export interface SearchToolsInput {
  query?: string;
  active_only?: boolean;
  limit?: number;
}

export const SearchToolsInputSchema: z.ZodType<SearchToolsInput> = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Case-insensitive BM25-lite query over tool name + description (tokens + substrings). Omit or empty to list tools (respects active_only + limit).',
    ),
  active_only: z
    .boolean()
    .optional()
    .describe(
      'When true (default), only tools currently active on this agent. When false, include inactive registered tools.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(80)
    .optional()
    .describe('Max matches to return (default 24).'),
});

export class SearchToolsTool implements BuiltinTool<SearchToolsInput> {
  readonly name = 'SearchTools' as const;
  readonly description = searchToolsDescription;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SearchToolsInputSchema);

  constructor(private readonly agent: Agent) {}

  resolveExecution(args: SearchToolsInput): ToolExecution {
    const q = args.query?.trim() ?? '';
    return {
      accesses: ToolAccesses.none(),
      description: q.length > 0 ? `Search tools: ${q}` : 'List tools',
      display: { kind: 'generic', summary: q.length > 0 ? `SearchTools: ${q}` : 'SearchTools: list' },
      readOnly: true,
      approvalRule: this.name,
      execute: () => this.execution(args),
    };
  }

  private async execution(args: SearchToolsInput): Promise<ExecutableToolResult> {
    const activeOnly = args.active_only !== false;
    const limit = args.limit ?? 24;
    const rawQuery = (args.query ?? '').trim();
    const query = rawQuery.toLowerCase();
    const all = this.agent.tools.data();
    const catalog = query.length === 0 ? filterToolsForPublicHelp(all, 'primary') : all;
    const candidates = catalog.filter((tool) => !(activeOnly && !tool.active));

    const ranked =
      query.length === 0
        ? [...candidates].toSorted((a, b) => a.name.localeCompare(b.name)).slice(0, limit)
        : rankToolsBm25Lite(candidates, query).slice(0, limit);

    if (ranked.length === 0) {
      return {
        output: [
          query.length === 0
            ? 'No tools registered for this agent profile.'
            : `No tools matched query "${rawQuery}".`,
          'Try a shorter token (e.g. "browser", "read", "search") or active_only=false.',
        ].join('\n'),
      };
    }

    const activeCount = all.filter((t) => t.active).length;
    const lines = [
      `<tool-search-results query="${escapeXmlAttr(rawQuery)}" active_only="${String(activeOnly)}" shown="${String(ranked.length)}" active_total="${String(activeCount)}" registered_total="${String(all.length)}">`,
      ...ranked.map((tool, i) => renderToolHit(tool, i + 1)),
      '</tool-search-results>',
      '',
      'Prefer dedicated tools from this list over raw Bash when they fit. Call the tool by exact name.',
    ];
    return { output: lines.join('\n') };
  }
}

/** Exported for unit tests — BM25-lite ranking over name + description. */
export function rankToolsBm25Lite(tools: readonly ToolInfo[], query: string): ToolInfo[] {
  const queryTokens = tokenizeToolQuery(query);
  if (queryTokens.length === 0 && query.length === 0) {
    return [...tools].toSorted((a, b) => a.name.localeCompare(b.name));
  }

  const docs = tools.map((tool) => {
    const nameTokens = tokenizeToolQuery(splitCamel(tool.name));
    const descTokens = tokenizeToolQuery(tool.description);
    return { tool, nameTokens, descTokens, allTokens: [...nameTokens, ...descTokens] };
  });

  const df = new Map<string, number>();
  for (const token of queryTokens) {
    let count = 0;
    for (const doc of docs) {
      if (doc.allTokens.includes(token) || doc.tool.name.toLowerCase().includes(token)) {
        count += 1;
      }
    }
    df.set(token, count);
  }

  const n = Math.max(docs.length, 1);
  const avgDl =
    docs.reduce((sum, doc) => sum + Math.max(doc.allTokens.length, 1), 0) / n || 1;
  const k1 = 1.2;
  const b = 0.75;

  const scored = docs
    .map((doc) => {
      const nameLower = doc.tool.name.toLowerCase();
      const descLower = doc.tool.description.toLowerCase();
      let score = 0;

      // Exact / prefix name boosts (legacy rankTools behavior, amplified).
      if (nameLower === query) score += 100;
      else if (nameLower.startsWith(query)) score += 80;
      else if (nameLower.includes(query)) score += 50;
      else if (descLower.includes(query)) score += 15;

      for (const token of queryTokens) {
        const docFreq = df.get(token) ?? 0;
        if (docFreq === 0) continue;
        const idf = Math.log(1 + (n - docFreq + 0.5) / (docFreq + 0.5));
        const tfName = termFrequency(doc.nameTokens, token);
        const tfDesc = termFrequency(doc.descTokens, token);
        const tf = tfName * 3 + tfDesc; // name field boost
        const dl = Math.max(doc.allTokens.length, 1);
        const bm25 =
          idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgDl))));
        score += bm25;
        if (nameLower.includes(token)) score += 8;
      }

      return { tool: doc.tool, score };
    })
    .filter((entry) => entry.score > 0);

  return scored
    .toSorted((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .map((entry) => entry.tool);
}

function splitCamel(name: string): string {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replaceAll(/[_./-]+/g, ' ');
}

function tokenizeToolQuery(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function termFrequency(tokens: readonly string[], term: string): number {
  let count = 0;
  for (const token of tokens) {
    if (token === term) count += 1;
  }
  return count;
}

function renderToolHit(tool: ToolInfo, rank: number): string {
  const desc = tool.description.replaceAll(/\s+/g, ' ').trim();
  const aliasHint =
    isCompatBrandingTool(tool.name) ? formatCompatToolHelpHint(tool.name) : undefined;
  const body = aliasHint !== undefined ? `${desc} (${aliasHint})` : desc;
  const short = body.length > 160 ? `${body.slice(0, 157)}…` : body;
  return [
    `<tool rank="${String(rank)}" name="${escapeXmlAttr(tool.name)}" active="${String(tool.active)}" source="${escapeXmlAttr(tool.source)}">`,
    `  <description>${escapeXml(short)}</description>`,
    '</tool>',
  ].join('\n');
}
