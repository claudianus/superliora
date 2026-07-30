/**
 * SearchTools — inventory the agent's tool surface (inspired by OpenHarness
 * `tool_search`). Makes "eyes" for which hands exist so the model stops
 * ignoring dedicated tools.
 */

import { z } from 'zod';

import type { Agent } from '../../../agent/index';
import type { BuiltinTool, ToolInfo } from '../../../agent/tool';
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
      'Case-insensitive substring over tool name + description. Omit or empty to list tools (respects active_only + limit).',
    ),
  active_only: z
    .boolean()
    .optional()
    .describe('When true (default), only tools currently active on this agent. When false, include inactive registered tools.'),
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
    const query = (args.query ?? '').trim().toLowerCase();
    const all = this.agent.tools.data();
    const filtered = all.filter((tool) => {
      if (activeOnly && !tool.active) return false;
      if (query.length === 0) return true;
      return (
        tool.name.toLowerCase().includes(query) ||
        tool.description.toLowerCase().includes(query)
      );
    });

    // Prefer exact name matches, then prefix, then others; stable by name.
    const ranked = rankTools(filtered, query).slice(0, limit);

    if (ranked.length === 0) {
      return {
        output: [
          query.length === 0
            ? 'No tools registered for this agent profile.'
            : `No tools matched query "${args.query?.trim() ?? ''}".`,
          'Try a shorter substring (e.g. "browser", "read", "search") or active_only=false.',
        ].join('\n'),
      };
    }

    const activeCount = all.filter((t) => t.active).length;
    const lines = [
      `<tool-search-results query="${escapeXmlAttr(args.query?.trim() ?? '')}" active_only="${String(activeOnly)}" shown="${String(ranked.length)}" active_total="${String(activeCount)}" registered_total="${String(all.length)}">`,
      ...ranked.map((tool, i) => renderToolHit(tool, i + 1)),
      '</tool-search-results>',
      '',
      'Prefer dedicated tools from this list over raw Bash when they fit. Call the tool by exact name.',
    ];
    return { output: lines.join('\n') };
  }
}

function rankTools(tools: readonly ToolInfo[], query: string): ToolInfo[] {
  if (query.length === 0) {
    return [...tools].sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...tools].sort((a, b) => {
    const sa = scoreName(a.name, query);
    const sb = scoreName(b.name, query);
    if (sa !== sb) return sb - sa;
    return a.name.localeCompare(b.name);
  });
}

function scoreName(name: string, query: string): number {
  const lower = name.toLowerCase();
  if (lower === query) return 100;
  if (lower.startsWith(query)) return 80;
  if (lower.includes(query)) return 50;
  return 10;
}

function renderToolHit(tool: ToolInfo, rank: number): string {
  const desc = tool.description.replace(/\s+/g, ' ').trim();
  const short = desc.length > 160 ? `${desc.slice(0, 157)}…` : desc;
  return [
    `<tool rank="${String(rank)}" name="${escapeXmlAttr(tool.name)}" active="${String(tool.active)}" source="${escapeXmlAttr(tool.source)}">`,
    `  <description>${escapeXml(short)}</description>`,
    '</tool>',
  ].join('\n');
}
