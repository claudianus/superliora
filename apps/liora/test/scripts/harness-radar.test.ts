import { describe, expect, it } from 'vitest';

import { evaluateHarnessRadarGate } from '../../../../scripts/liora-harness-radar.mjs';
import { buildHarnessRadarFromBestOf } from '../../../../scripts/liora-harness-radar-refresh.mjs';

function completeRadar() {
  return {
    schemaVersion: 1,
    name: 'super-liora-harness-radar',
    source: {
      name: 'best-of-Agent-Harnesses',
      url: 'https://github.com/RyanAlberts/best-of-Agent-Harnesses',
      starsCapturedAt: '2026-06-28',
    },
    axes: [
      {
        id: 'autonomy',
        tiers: ['step-gated', 'checkpoint-gated', 'bounded', 'headless'],
        minimum: 'bounded',
        target: 'headless',
      },
      {
        id: 'recovery',
        tiers: ['none', 'retry', 'resumable', 'durable'],
        minimum: 'resumable',
        target: 'durable',
      },
      {
        id: 'adoption-surface',
        tiers: ['super simple', 'mostly simple', 'slightly complex', 'complex'],
        principle: 'pick the lowest surface that solves the job',
      },
    ],
    patterns: [
      {
        id: 'terminal-agent-shell-vs-harness',
        takeaway: 'The TUI is the shell; the harness loop, sandboxing, recovery, and extension model carry the product quality.',
        projects: ['opencode', 'Codex', 'goose', 'crush'],
      },
      {
        id: 'tool-discovery-context-budget',
        takeaway: 'Use MCP tool discovery and retrieval before loading tool schemas to reduce token cost.',
        projects: ['MCP-Zero', 'ToolRAG', 'langgraph-bigtool', 'spring-ai-tool-search-tool'],
        target: {
          defaultToolExposure: 'search-then-load',
          tokenBudgetImpact: 'measured',
        },
      },
      {
        id: 'memory-ownership-lanes',
        takeaway: 'Separate application-owned, harness-owned, and agent-owned memory before designing recall UX.',
        lanes: ['application-owned', 'harness-owned', 'agent-owned'],
      },
      {
        id: 'benchmark-eval-mix',
        takeaway: 'Measure source edits, terminal/TUI workflows, recovery, memory recall, and tool efficiency with executable traces.',
        references: ['SWE-bench', 'Terminal-Bench', 'inspect_ai', 'Agent Lightning'],
      },
      {
        id: 'curation-refresh-routine',
        takeaway: 'Regenerate the radar from structured data with allowlisted diffs and freshness checks.',
        cadence: 'weekly',
      },
    ],
    watchlist: {
      generatedFrom: 'best-of-Agent-Harnesses use_cases',
      items: [
        {
          focus: 'terminal coding agent',
          intent: 'I want a turnkey coding agent today',
          name: 'opencode',
          githubId: 'anomalyco/opencode',
          category: 'coding-agent-products',
          stars: 180000,
        },
        {
          focus: 'tool discovery',
          intent: 'I want to plug hundreds to thousands of tools without context bloat',
          name: 'MCP-Zero',
          githubId: 'xfey/MCP-Zero',
          category: 'progressive-disclosure',
          stars: 489,
        },
        {
          focus: 'evaluation harness',
          intent: 'I want to evaluate or benchmark agents',
          name: 'SWE-bench',
          githubId: 'SWE-bench/SWE-bench',
          category: 'evaluation',
          stars: 5275,
        },
      ],
    },
  };
}

describe('harness radar gate', () => {
  it('accepts the internalized best-of-Agent-Harnesses radar contract', () => {
    const gate = evaluateHarnessRadarGate(completeRadar(), {
      nowMs: Date.parse('2026-07-01T00:00:00.000Z'),
    });

    expect(gate.status).toBe('PASS');
    expect(gate.observed?.autonomyTarget).toBe('headless');
    expect(gate.observed?.recoveryMinimum).toBe('resumable');
    expect(gate.observed?.toolDiscoveryPattern).toBe('tool-discovery-context-budget');
    expect(gate.observed?.watchlistCount).toBe(3);
    expect(gate.observed?.watchlistCategories).toEqual([
      'coding-agent-products',
      'progressive-disclosure',
      'evaluation',
    ]);
    expect(gate.observed?.sourceAgeDays).toBe(3);
    expect(gate.observed?.sourceMaxAgeDays).toBe(14);
  });

  it('fails when long-running autonomy has no resumable recovery floor', () => {
    const radar = completeRadar();
    const recovery = radar.axes.find((axis) => axis.id === 'recovery');
    expect(recovery).toBeDefined();
    if (recovery === undefined) return;
    recovery.minimum = 'retry';
    recovery.target = 'resumable';

    const gate = evaluateHarnessRadarGate(radar);

    expect(gate.status).toBe('FAIL');
    expect(gate.reason).toContain('recovery axis must target durable with resumable minimum');
  });

  it('fails when token-efficient tool discovery is missing', () => {
    const radar = completeRadar();
    radar.patterns = radar.patterns.filter((pattern) => pattern.id !== 'tool-discovery-context-budget');

    const gate = evaluateHarnessRadarGate(radar);

    expect(gate.status).toBe('FAIL');
    expect(gate.reason).toContain('missing tool-discovery-context-budget pattern');
  });

  it('fails when the external harness radar source is stale', () => {
    const gate = evaluateHarnessRadarGate(completeRadar(), {
      nowMs: Date.parse('2026-07-20T00:00:00.000Z'),
    });

    expect(gate.status).toBe('FAIL');
    expect(gate.reason).toContain('source.starsCapturedAt is stale');
    expect(gate.observed?.sourceAgeDays).toBe(22);
  });

  it('builds the internal radar from structured best-of-Agent-Harnesses data', () => {
    const radar = buildHarnessRadarFromBestOf({
      meta: {
        name: 'best-of-Agent-Harnesses',
        url: 'https://github.com/RyanAlberts/best-of-Agent-Harnesses',
        stars_captured: '2026-07-01',
      },
      use_cases: [
        {
          intent: 'I want a turnkey coding agent today',
          picks: ['anomalyco/opencode', 'openai/codex', 'google-gemini/gemini-cli'],
        },
        {
          intent: 'I want to plug hundreds to thousands of tools without context bloat',
          picks: ['xfey/MCP-Zero', 'antl3x/ToolRAG', 'langchain-ai/langgraph-bigtool'],
        },
        {
          intent: 'I want to evaluate or benchmark agents',
          picks: ['SWE-bench/SWE-bench', 'UKGovernmentBEIS/inspect_ai'],
        },
      ],
      projects: [
        project('opencode', 'anomalyco/opencode', 'coding-agent-products', ['mcp', 'cli', 'tui'], 180000),
        project('Codex', 'openai/codex', 'coding-agent-products', ['sandbox', 'cli'], 94000),
        project('Gemini CLI', 'google-gemini/gemini-cli', 'coding-agent-products', ['mcp', 'cli'], 106000),
        project('ToolRAG', 'antl3x/ToolRAG', 'progressive-disclosure', ['mcp', 'tool-discovery'], 28),
        project('MCP-Zero', 'xfey/MCP-Zero', 'progressive-disclosure', ['tool-discovery'], 489),
        project('langgraph-bigtool', 'langchain-ai/langgraph-bigtool', 'progressive-disclosure', ['tool-discovery'], 545),
        project('Mem0', 'mem0ai/mem0', 'libraries-sdks', ['memory'], 59600),
        project('claude-mem', 'thedotmack/claude-mem', 'plugins-mcp-cli', ['memory'], 84800),
        project('Letta', 'letta-ai/letta', 'frameworks', ['memory'], 23600),
        project('SWE-bench', 'SWE-bench/SWE-bench', 'evaluation', ['evals', 'sandbox'], 5275),
        project('inspect_ai', 'UKGovernmentBEIS/inspect_ai', 'evaluation', ['evals', 'sandbox'], 2269),
      ],
    }, {
      refreshedAt: '2026-07-01',
    });

    const gate = evaluateHarnessRadarGate(radar, {
      nowMs: Date.parse('2026-07-01T12:00:00.000Z'),
    });

    expect(gate.status).toBe('PASS');
    expect(radar.source.starsCapturedAt).toBe('2026-07-01');
    expect(radar.source.refreshedAt).toBe('2026-07-01');
    expect(radar.patterns.find((pattern) => pattern.id === 'terminal-agent-shell-vs-harness')?.projects)
      .toEqual(['opencode', 'Codex', 'Gemini CLI']);
    expect(radar.patterns.find((pattern) => pattern.id === 'tool-discovery-context-budget')?.projects)
      .toEqual(['MCP-Zero', 'ToolRAG', 'langgraph-bigtool']);
    expect(radar.watchlist.items.map((item) => item.name)).toEqual([
      'opencode',
      'Codex',
      'Gemini CLI',
      'MCP-Zero',
      'ToolRAG',
      'langgraph-bigtool',
      'SWE-bench',
      'inspect_ai',
    ]);
    expect(radar.watchlist.items.map((item) => item.focus)).toEqual([
      'terminal coding agent',
      'terminal coding agent',
      'terminal coding agent',
      'tool discovery',
      'tool discovery',
      'tool discovery',
      'evaluation harness',
      'evaluation harness',
    ]);
  });

  it('records project drift against the previous internal radar', () => {
    const previousRadar = completeRadar();
    previousRadar.patterns.find((pattern) => pattern.id === 'terminal-agent-shell-vs-harness')!.projects = [
      'opencode',
      'goose',
    ];
    previousRadar.patterns.find((pattern) => pattern.id === 'tool-discovery-context-budget')!.projects = [
      'ToolRAG',
      'OldTool',
    ];
    previousRadar.patterns.find((pattern) => pattern.id === 'memory-ownership-lanes')!.projects = [
      'Mem0',
      'claude-mem',
      'Letta',
    ];

    const radar = buildHarnessRadarFromBestOf({
      meta: {
        name: 'best-of-Agent-Harnesses',
        url: 'https://github.com/RyanAlberts/best-of-Agent-Harnesses',
        stars_captured: '2026-07-01',
      },
      use_cases: [
        {
          intent: 'I want a turnkey coding agent today',
          picks: ['anomalyco/opencode', 'openai/codex'],
        },
        {
          intent: 'I want to plug hundreds to thousands of tools without context bloat',
          picks: ['xfey/MCP-Zero', 'antl3x/ToolRAG'],
        },
        {
          intent: 'I want to evaluate or benchmark agents',
          picks: ['SWE-bench/SWE-bench'],
        },
      ],
      projects: [
        project('opencode', 'anomalyco/opencode', 'coding-agent-products', ['mcp', 'cli', 'tui'], 180000),
        project('Codex', 'openai/codex', 'coding-agent-products', ['sandbox', 'cli'], 94000),
        project('ToolRAG', 'antl3x/ToolRAG', 'progressive-disclosure', ['mcp', 'tool-discovery'], 28),
        project('MCP-Zero', 'xfey/MCP-Zero', 'progressive-disclosure', ['tool-discovery'], 489),
        project('Mem0', 'mem0ai/mem0', 'libraries-sdks', ['memory'], 59600),
        project('claude-mem', 'thedotmack/claude-mem', 'plugins-mcp-cli', ['memory'], 84800),
        project('Letta', 'letta-ai/letta', 'frameworks', ['memory'], 23600),
        project('SWE-bench', 'SWE-bench/SWE-bench', 'evaluation', ['evals', 'sandbox'], 5275),
      ],
    }, {
      previousRadar,
      previousLabel: '.superliora/bench/harness-radar.json',
      refreshedAt: '2026-07-01',
    });

    expect(radar.source.changeSummary).toEqual({
      comparedWith: '.superliora/bench/harness-radar.json',
      totalAdded: 2,
      totalRemoved: 2,
      patterns: [
        {
          id: 'terminal-agent-shell-vs-harness',
          added: ['Codex'],
          removed: ['goose'],
        },
        {
          id: 'tool-discovery-context-budget',
          added: ['MCP-Zero'],
          removed: ['OldTool'],
        },
      ],
    });

    const gate = evaluateHarnessRadarGate(radar, {
      nowMs: Date.parse('2026-07-01T12:00:00.000Z'),
    });

    expect(gate.status).toBe('PASS');
    expect(gate.observed?.changeSummary?.totalAdded).toBe(2);
    expect(gate.observed?.changeSummary?.totalRemoved).toBe(2);
  });
});

function project(
  name: string,
  githubId: string,
  category: string,
  tags: string[],
  stars: number,
) {
  return {
    name,
    github_id: githubId,
    category,
    tags,
    stars,
  };
}
