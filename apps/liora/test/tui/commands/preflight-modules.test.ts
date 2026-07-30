import { describe, expect, it } from 'vitest';

import type { BenchStatus } from '#/tui/commands/bench/bench';
import type { MemoryReadinessSnapshot } from '#/tui/commands/memory/evidence-readiness';
import {
  buildPreflightRefreshPlan,
  evidenceFreshnessSignal,
  isBenchReady,
  isMemoryReady,
  isRecallReady,
  nextPreflightAction,
} from '#/tui/commands/preflight/readiness';
import type { PreflightFreshness } from '#/tui/commands/preflight/types';
import {
  formatDuration,
  formatPreflightError,
  readyWord,
} from '#/tui/commands/preflight/utils';
import { refreshAgeDetails } from '#/tui/commands/preflight/refresh';
import { fallbackLoopRerunCommand } from '#/tui/commands/preflight/loop';

describe('preflight extracted helpers', () => {
  it('formats durations and ready labels for status lines', () => {
    expect(formatDuration(30_000)).toBe('0m');
    expect(formatDuration(90 * 60 * 1000)).toBe('1h');
    expect(formatDuration(2 * 24 * 60 * 60 * 1000)).toBe('2d');
    expect(readyWord(true)).toBe('ready');
    expect(readyWord(false)).toBe('blocked');
  });

  it('surfaces preflight errors as strings', () => {
    expect(formatPreflightError(new Error('stats unavailable'))).toBe('stats unavailable');
    expect(formatPreflightError('offline')).toBe('offline');
  });

  it('evaluates bench, memory, and recall readiness gates', () => {
    const bench: BenchStatus = {
      sourcePath: '/repo/.superliora/evidence/bench/summary.json',
      status: 'PASS',
      score: 1,
      passRate: 1,
      noSecret: true,
      nextAction: 'Run the next bounded Ultrawork loop.',
      warnings: [],
    };
    const memory: MemoryReadinessSnapshot = {
      stats: { total: 1, active: 1 } as MemoryReadinessSnapshot['stats'],
      query: 'browser-use readiness',
      searchResults: [{ score: 0.9, reasons: ['subject'], memory: { subject: 'seed' } as never }],
      evidence: {
        sourceRoot: '/repo/.superliora/evidence',
        llmWiki: { ready: true, verified: true, tier: 'verified', matchCount: 1, summary: 'ok' },
        knowledgeMap: { ready: true, verified: true, tier: 'verified', matchCount: 1, summary: 'ok' },
        browserUse: { ready: true, verified: true, tier: 'verified', matchCount: 1, summary: 'ok' },
        computerUse: { ready: true, verified: true, tier: 'verified', matchCount: 1, summary: 'ok' },
        warnings: [],
      },
    };

    expect(isBenchReady(bench)).toBe(true);
    expect(isMemoryReady(memory)).toBe(true);
    expect(isRecallReady(memory)).toBe(true);
    expect(isBenchReady({ ...bench, status: 'UNAVAILABLE' })).toBe(false);
    expect(isRecallReady({ ...memory, searchResults: [] })).toBe(false);
  });

  it('builds refresh plans and next actions from blocked evidence', () => {
    const bench: BenchStatus = {
      sourcePath: '/repo/.superliora/evidence/bench/summary.json',
      status: 'PASS',
      score: 1,
      passRate: 1,
      noSecret: true,
      nextAction: 'Run the next bounded Ultrawork loop.',
      warnings: [],
    };
    const memory: MemoryReadinessSnapshot = {
      stats: { total: 1, active: 1 } as MemoryReadinessSnapshot['stats'],
      query: 'browser-use readiness',
      searchResults: [{ score: 0.9, reasons: ['subject'], memory: { subject: 'seed' } as never }],
      evidence: {
        sourceRoot: '/repo/.superliora/evidence',
        llmWiki: { ready: false, verified: false, tier: 'missing', matchCount: 0, summary: 'missing' },
        knowledgeMap: { ready: true, verified: true, tier: 'verified', matchCount: 1, summary: 'ok' },
        browserUse: { ready: true, verified: true, tier: 'verified', matchCount: 1, summary: 'ok' },
        computerUse: { ready: true, verified: true, tier: 'verified', matchCount: 1, summary: 'ok' },
        warnings: [],
      },
    };
    const freshness: PreflightFreshness = {
      ready: true,
      windowMs: 24 * 60 * 60 * 1000,
      bench: { state: 'fresh', ageMs: 1000, sourcePath: bench.sourcePath },
      llmWiki: { state: 'fresh', ageMs: 1000 },
      knowledgeMap: { state: 'fresh', ageMs: 1000 },
      browserUse: { state: 'fresh', ageMs: 1000 },
      computerUse: { state: 'fresh', ageMs: 1000 },
    };

    expect(buildPreflightRefreshPlan(bench, memory, freshness).reason).toBe('llm-wiki evidence missing');
    expect(nextPreflightAction(bench, memory, freshness)).toContain('llm-wiki/durable-memory');
  });

  it('computes freshness and refresh age details from timestamps', () => {
    const nowMs = Date.parse('2026-07-30T12:00:00.000Z');
    expect(evidenceFreshnessSignal(undefined, nowMs, 24 * 60 * 60 * 1000).state).toBe('missing');

    const details = refreshAgeDetails({
      status: 'PASS',
      evidencePath: '.superliora/evidence/superliora-preflight-refresh',
      runtimeCandidates: [],
      missingChannels: [],
      completedAt: new Date(nowMs - 30 * 60 * 1000).toISOString(),
    }, nowMs);
    expect(details?.state).toBe('fresh');
    expect(details?.ageMs).toBe(30 * 60 * 1000);
  });

  it('builds fallback loop rerun commands from evidence roots', () => {
    expect(fallbackLoopRerunCommand(undefined, 2)).toContain('--max-iterations 2');
    expect(fallbackLoopRerunCommand('.superliora/evidence/liora-agent-bench/latest', 2)).toContain(
      '--evidence-root .superliora/evidence/liora-agent-bench/latest',
    );
  });
});
