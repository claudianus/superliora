import { describe, expect, it } from 'vitest';

import { evaluateHarnessRadarGate } from '../../../../scripts/kimi-harness-radar.mjs';

function completeRadar() {
  return {
    schemaVersion: 1,
    name: 'super-kimi-harness-radar',
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
  };
}

describe('harness radar gate', () => {
  it('accepts the internalized best-of-Agent-Harnesses radar contract', () => {
    const gate = evaluateHarnessRadarGate(completeRadar());

    expect(gate.status).toBe('PASS');
    expect(gate.observed?.autonomyTarget).toBe('headless');
    expect(gate.observed?.recoveryMinimum).toBe('resumable');
    expect(gate.observed?.toolDiscoveryPattern).toBe('tool-discovery-context-budget');
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
});
