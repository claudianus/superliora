import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MemoryRecord, MemoryStats } from '@superliora/sdk';
import { describe, expect, it } from 'vitest';

import {
  buildPreflightLines,
  buildPreflightStatus,
  loadPreflightHumanWriting,
  loadPreflightLoopRun,
  loadPreflightRefreshRun,
  redactPreflightText,
  type PreflightFreshness,
} from '#/tui/commands/preflight';

describe('preflight slash command status surface', () => {
  it('unifies bench, memory, recall, and runtime evidence readiness', () => {
    const status = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.superliora/evidence/bench/summary.json',
        status: 'PASS',
        score: 1,
        passRate: 1,
        holdout: 'active',
        providerBlock: 'not blocked',
        redaction: 'PASS',
        noSecret: true,
        nextAction: 'Run the next bounded Ultrawork loop.',
        warnings: [],
      },
      memory: {
        stats: memoryStats({ total: 1, active: 1 }),
        query: 'browser-use computer-use readiness',
        searchResults: [
          {
            score: 0.93,
            reasons: ['subject'],
            memory: memoryRecord('preflight browser-use computer-use memory'),
          },
        ],
        evidence: {
          sourceRoot: '/repo/.superliora/evidence',
          llmWiki: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/llm-wiki.md',
            summary: 'evidence found',
          },
          knowledgeMap: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/liora-knowledge-map.json',
            summary: 'evidence found',
          },
          browserUse: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/browser-use.json',
            summary: 'evidence found',
          },
          computerUse: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/computer-use-state.json',
            summary: 'evidence found',
          },
          warnings: [],
        },
      },
      freshness: preflightFreshness('fresh'),
      loopRun: {
        status: 'BLOCKED',
        evidencePath: '.superliora/evidence/liora-agent-bench/latest/loop-summary.json',
        evidenceRoot: '.superliora/evidence/liora-agent-bench/latest',
        rerunCommand: 'node scripts/liora-agent-bench.mjs --loop --max-iterations 2 --evidence-root .superliora/evidence/liora-agent-bench/latest',
        completedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        stopReason: 'quarantine_pending',
        bestScore: 1,
        firstScore: 1,
        lastScore: 1,
        iterations: 1,
        maxIterations: 2,
        selected: 2,
        scored: 1,
        passed: 1,
        failed: 0,
        blocked: 0,
        quarantined: 1,
        quarantineTask: 'seed.contamination-guard.v1',
        quarantineFindings: ['answers/solution.txt'],
        proposal: 'Preserve passing loop and expand holdout coverage.',
      },
    });
    const text = buildPreflightLines(status).join('\n');

    expect(status.ready).toBe(true);
    expect(text).toContain('Unified status  ready');
    expect(text).toContain('Bench  ready; status PASS');
    expect(text).toContain('Bench score  1.00; passRate 100%');
    expect(text).toContain('Memory  ready; active 1 / total 1');
    expect(text).toContain('Recall  ready; 1 match for "browser-use computer-use readiness"');
    expect(text).toContain('LLM-wiki evidence  ready; verified; 1 match');
    expect(text).toContain('Knowledge-map evidence  ready; verified; 1 match');
    expect(text).toContain('Browser-use evidence  ready');
    expect(text).toContain('Computer-use evidence  ready');
    expect(text).toContain('Ready gates  9/9; blocked none');
    expect(text).toContain('Human writing  ready; anti-slop advisory-only');
    expect(text).toContain('Freshness  ready; window 24h');
    expect(text).toContain('Bench age  fresh; 0m');
    expect(text).toContain('LLM-wiki age  fresh; 0m');
    expect(text).toContain('Knowledge-map age  fresh; 0m');
    expect(text).toContain('Browser-use age  fresh; 0m');
    expect(text).toContain('Computer-use age  fresh; 0m');
    expect(text).toContain('Boundary  no secret-looking strings displayed');
    expect(text).toContain('No-web  browser UI excluded');
    expect(text).toContain('Next  Ready: run the next bounded Ultrawork loop from this preflight.');
    expect(text).toContain('Loop cue  run_next_loop; refresh_due unknown');
    expect(text).toContain('Loop command  node scripts/liora-agent-bench.mjs --loop --max-iterations 2');
    expect(text).toContain('Loop evidence  .superliora/evidence/liora-agent-bench');
    expect(text).toContain('Loop rerun  node scripts/liora-agent-bench.mjs --loop --max-iterations 2 --evidence-root .superliora/evidence/liora-agent-bench/latest');
    expect(text).toContain('Loop inspect  .superliora/evidence/liora-agent-bench/latest/loop-summary.json');
    expect(text).toContain('Loop budget  2 iters; 10m; stop ceiling/no_delta');
    expect(text).toContain('Loop last  BLOCKED; score 1.00; stop quarantine_pending; iter 1/2');
    expect(text).toContain('Loop scope  scored 1/2; pass 1; q 1; blocked 0; failed 0');
    expect(text).toContain('Loop guard  q seed.contamination-guard.v1');
    expect(text).toContain('Loop files  answers/solution.txt');
    expect(text).toContain('Loop delta  single_iter score 1.00');
    expect(text).toContain('Loop age  fresh; 30m; due 23h');
    expect(text).toContain('Loop proposal  Preserve passing loop and expand holdout coverage.');
    expect(text).toContain('Loop next  fix_quarantine_then_rerun_loop');
    expect(text).not.toContain('Refresh verify');
    expect(text).not.toContain('Refresh command');
    expect(text).not.toContain('Refresh last');
  });

  it('reruns stale loop evidence before acting on a recorded proposal', () => {
    const status = buildPreflightStatus(readyPreflightInput({
      status: 'PASS',
      evidencePath: '.superliora/evidence/liora-agent-bench/latest/loop-summary.json',
      completedAt: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
      stopReason: 'max_iterations_reached',
      bestScore: 0.75,
      firstScore: 0.5,
      lastScore: 0.75,
      iterations: 2,
      maxIterations: 2,
      selected: 2,
      scored: 2,
      passed: 1,
      failed: 1,
      blocked: 0,
      quarantined: 0,
      proposal: 'Implement the stale proposal after another bounded run.',
    }));
    const text = buildPreflightLines(status).join('\n');

    expect(text).toContain('Loop age  stale; 2d; expired 1d');
    expect(text).toContain('Loop proposal  Implement the stale proposal after another bounded run.');
    expect(text).toContain('Loop next  rerun_loop_first');
    expect(text).not.toContain('Loop next  implement_proposal_then_rerun_loop');
  });

  it('keeps legacy loop summaries without scope counts compatible', () => {
    const status = buildPreflightStatus(readyPreflightInput({
      status: 'PASS',
      evidencePath: '.superliora/evidence/liora-agent-bench/latest/loop-summary.json',
      completedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      stopReason: 'score_ceiling_reached',
      bestScore: 1,
      firstScore: 1,
      lastScore: 1,
      iterations: 1,
      maxIterations: 2,
      proposal: 'Legacy loop summary without task counts.',
    }));
    const text = buildPreflightLines(status).join('\n');

    expect(text).toContain('Loop last  PASS; score 1.00; stop score_ceiling_reached; iter 1/2');
    expect(text).toContain('Loop scope  unknown');
    expect(text).toContain('Loop guard  none');
    expect(text).toContain('Loop files  none');
    expect(text).toContain('Loop rerun  node scripts/liora-agent-bench.mjs --loop --max-iterations 2 --evidence-root .superliora/evidence/liora-agent-bench/latest');
    expect(text).toContain('Loop inspect  .superliora/evidence/liora-agent-bench/latest/loop-summary.json');
    expect(text).toContain('Loop next  implement_proposal_then_rerun_loop');
  });

  it('degrades honestly without claiming readiness and redacts secret-looking text', () => {
    const status = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.superliora/evidence/malformed/summary.json',
        status: 'UNAVAILABLE',
        noSecret: false,
        nextAction: 'Run node scripts/liora-agent-bench.mjs, then open /bench again.',
        warnings: ['No bench evidence found at /repo/.superliora/evidence/malformed/summary.json'],
      },
      memory: {
        stats: memoryStats({ total: 0, active: 0 }),
        query: 'api_key=secret-value KIMI_MODEL_API_KEY sk-proj-1234567890abcdef',
        searchResults: [],
        evidence: {
          sourceRoot: '/repo/.superliora/evidence',
          llmWiki: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No llm-wiki or durable-memory evidence found.',
          },
          knowledgeMap: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No Liora Knowledge Map evidence found.',
          },
          browserUse: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No browser-use evidence found.',
          },
          computerUse: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No computer-use evidence found.',
          },
          warnings: ['Malformed evidence ignored: /repo/.superliora/evidence/browser-use.json'],
        },
      },
      freshness: preflightFreshness('missing'),
      refreshRun: {
        status: 'BLOCKED',
        evidencePath: '.superliora/evidence/superliora-preflight-refresh',
        durationMs: 742,
        completedAt: new Date(Date.now() - 10 * 1000).toISOString(),
        bench: refreshBench(),
        readinessGates: {
          total: 5,
          passed: 1,
          blocked: ['llmWiki', 'knowledgeMap', 'browserUse', 'computerUse'],
          nextAction: 'refresh_runtime_evidence',
        },
        runtimeCandidates: [
          {
            channel: 'browserUse',
            state: 'fresh',
            sourcePath: '.superliora/evidence/lint-clean-tui-launch-smoke/tui/summary.json',
          },
        ],
        missingChannels: ['llmWiki', 'knowledgeMap', 'browserUse', 'computerUse'],
      },
    });
    const text = buildPreflightLines(status).join('\n');

    expect(status.ready).toBe(false);
    expect(text).toContain('Unified status  blocked');
    expect(text).toContain('Bench  blocked; status UNAVAILABLE');
    expect(text).toContain('Memory  blocked; active 0 / total 0');
    expect(text).toContain('LLM-wiki evidence  blocked');
    expect(text).toContain('Knowledge-map evidence  blocked');
    expect(text).toContain('Browser-use evidence  blocked');
    expect(text).toContain('Computer-use evidence  blocked');
    expect(text).toContain('Ready gates  1/9; blocked bench,memory,recall,llmWiki,knowledgeMap,browserUse,computerUse,freshness');
    expect(text).toContain('Human writing  ready; anti-slop advisory-only');
    expect(text).toContain('Freshness  blocked; window 24h');
    expect(text).toContain('Bench age  missing');
    expect(text).toContain('Boundary  review evidence before sharing');
    expect(text).toContain('No-web  browser UI excluded');
    expect(text).toContain('Next  Run node scripts/liora-agent-bench.mjs, then open /bench again.');
    expect(text).toContain('Loop cue  refresh_now; refresh_due 23h');
    expect(text).toContain('Loop command  node scripts/liora-preflight-refresh.mjs');
    expect(text).toContain('Loop evidence  .superliora/evidence/superliora-preflight-refresh (bench + runtime audit)');
    expect(text).toContain('Loop budget  refresh once; no bench iteration');
    expect(text).toContain('Loop last  missing; run Loop command');
    expect(text).toContain('Loop scope  missing; run Loop command');
    expect(text).toContain('Loop guard  missing; run Loop command');
    expect(text).toContain('Loop files  missing; run Loop command');
    expect(text).toContain('Loop delta  missing; run Loop command');
    expect(text).toContain('Loop age  missing; run Loop command');
    expect(text).toContain('Loop proposal  missing; run Loop command');
    expect(text).toContain('Loop next  run_loop_first');
    expect(text).toContain('Refresh  benchmark evidence unavailable');
    expect(text).toContain('Refresh command  node scripts/liora-preflight-refresh.mjs');
    expect(text).toContain('Refresh evidence  .superliora/evidence/superliora-preflight-refresh');
    expect(text).toContain('Refresh runtime  .superliora/evidence/preflight-readiness');
    expect(text).not.toContain('--runtime-evidence-root .superliora/evidence/preflight-readiness');
    expect(text).toContain('Refresh last  BLOCKED; elapsed 742ms; missing llmWiki,knowledgeMap,browserUse,computerUse');
    expect(text).toContain('Refresh age  fresh; 0m; due 23h');
    expect(text).toContain('Refresh bench  score 1.00; passRate 100%; tasks 1/1 passed; q 1; cost 2ms; tok 53; cmd 1');
    expect(text).toContain('Refresh gates  1/5; blocked llmWiki,knowledgeMap,browserUse,computerUse; next refresh_runtime_evidence');
    expect(text).toContain('Refresh candidates  1 candidate; all fresh');
    expect(text).toContain('Refresh candidate inspect  summary.md under Refresh last evidence');
    expect(text).toContain(
      'Refresh candidate action  recapture 1 candidate',
    );
    expect(text).toContain('Refresh candidate target  .superliora/evidence/preflight-readiness');
    expect(text).toContain('Refresh candidate rerun  node scripts/liora-preflight-refresh.mjs');
    expect(text).toContain('Refresh last evidence  .superliora/evidence/superliora-preflight-refresh');
    expect(text).not.toContain('Refresh verify');
    expect(text).toContain('Warning  memory: Malformed evidence ignored');
    expect(text).not.toContain('secret-value');
    expect(text).not.toContain('KIMI_MODEL_API_KEY');
    expect(text).not.toContain('sk-proj-1234567890abcdef');
  });

  it('gives a copyable memory command when preflight recall has no durable context', () => {
    const status = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.superliora/evidence/bench/summary.json',
        status: 'PASS',
        score: 1,
        passRate: 1,
        holdout: 'active',
        providerBlock: 'not blocked',
        redaction: 'PASS',
        noSecret: true,
        nextAction: 'Run the next bounded Ultrawork loop.',
        warnings: [],
      },
      memory: {
        stats: memoryStats({ total: 0, active: 0 }),
        query: 'superliora harness knowledge-map browser-use computer-use llm-wiki readiness',
        searchResults: [],
        evidence: {
          sourceRoot: '/repo/.superliora/evidence',
          llmWiki: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No llm-wiki or durable-memory evidence found.',
          },
          knowledgeMap: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No Liora Knowledge Map evidence found.',
          },
          browserUse: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No browser-use evidence found.',
          },
          computerUse: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No computer-use evidence found.',
          },
          warnings: [],
        },
      },
      freshness: preflightFreshness('missing'),
    });
    const text = buildPreflightLines(status).join('\n');

    expect(text).toContain(
      'Next  Run /memory remember preflight-readiness :: superliora harness knowledge-map browser-use computer-use llm-wiki readiness.',
    );

    const noRecallStatus = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.superliora/evidence/bench/summary.json',
        status: 'PASS',
        score: 1,
        passRate: 1,
        holdout: 'active',
        providerBlock: 'not blocked',
        redaction: 'PASS',
        noSecret: true,
        nextAction: 'Run the next bounded Ultrawork loop.',
        warnings: [],
      },
      memory: {
        stats: memoryStats({ total: 1, active: 1 }),
        query: 'custom recall target',
        searchResults: [],
        evidence: {
          sourceRoot: '/repo/.superliora/evidence',
          llmWiki: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/llm-wiki.md',
            summary: 'evidence found',
          },
          knowledgeMap: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/liora-knowledge-map.json',
            summary: 'evidence found',
          },
          browserUse: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/browser-use.json',
            summary: 'evidence found',
          },
          computerUse: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/computer-use-state.json',
            summary: 'evidence found',
          },
          warnings: [],
        },
      },
      freshness: preflightFreshness('fresh'),
    });
    const noRecallText = buildPreflightLines(noRecallStatus).join('\n');

    expect(noRecallText).toContain(
      'Next  Run /memory remember preflight-readiness :: custom recall target, then rerun /preflight.',
    );
  });

  it('points missing runtime evidence at the preflight readiness evidence root', () => {
    const status = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.superliora/evidence/bench/summary.json',
        status: 'PASS',
        score: 1,
        passRate: 1,
        holdout: 'active',
        providerBlock: 'not blocked',
        redaction: 'PASS',
        noSecret: true,
        nextAction: 'Run the next bounded Ultrawork loop.',
        warnings: [],
      },
      memory: {
        stats: memoryStats({ total: 1, active: 1 }),
        query: 'superliora harness readiness',
        searchResults: [
          {
            score: 0.93,
            reasons: ['subject'],
            memory: memoryRecord('superliora harness readiness'),
          },
        ],
        evidence: {
          sourceRoot: '/repo/.superliora/evidence',
          llmWiki: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No llm-wiki or durable-memory evidence found.',
          },
          knowledgeMap: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No Liora Knowledge Map evidence found.',
          },
          browserUse: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No browser-use evidence found.',
          },
          computerUse: {
          ready: false,
          verified: false,
          tier: 'missing',
          matchCount: 0,
            summary: 'No computer-use evidence found.',
          },
          warnings: [],
        },
      },
      freshness: preflightFreshness('missing'),
    });
    const text = buildPreflightLines(status).join('\n');

    expect(text).toContain(
      'Next  Capture llm-wiki/durable-memory evidence under .superliora/evidence/preflight-readiness, then run Refresh command below.',
    );
  });

  it('blocks otherwise ready preflight state when evidence is stale', () => {
    const status = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.superliora/evidence/bench/summary.json',
        status: 'PASS',
        score: 1,
        passRate: 1,
        holdout: 'active',
        providerBlock: 'not blocked',
        redaction: 'PASS',
        noSecret: true,
        nextAction: 'Run the next bounded Ultrawork loop.',
        warnings: [],
      },
      memory: {
        stats: memoryStats({ total: 1, active: 1 }),
        query: 'browser-use computer-use readiness',
        searchResults: [
          {
            score: 0.93,
            reasons: ['subject'],
            memory: memoryRecord('preflight browser-use computer-use memory'),
          },
        ],
        evidence: {
          sourceRoot: '/repo/.superliora/evidence',
          llmWiki: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/llm-wiki.md',
            summary: 'evidence found',
          },
          knowledgeMap: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/liora-knowledge-map.json',
            summary: 'evidence found',
          },
          browserUse: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/browser-use.json',
            summary: 'evidence found',
          },
          computerUse: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/computer-use-state.json',
            summary: 'evidence found',
          },
          warnings: [],
        },
      },
      freshness: preflightFreshness('stale'),
      refreshRun: {
        status: 'PASS',
        evidencePath: '.superliora/evidence/superliora-preflight-refresh',
        durationMs: 1500,
        completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        bench: refreshBench(),
        readinessGates: {
          total: 5,
          passed: 5,
          blocked: [],
          nextAction: 'ready',
        },
        runtimeCandidates: [],
        missingChannels: [],
      },
    });
    const text = buildPreflightLines(status).join('\n');

    expect(status.ready).toBe(false);
    expect(text).toContain('Unified status  blocked');
    expect(text).toContain('Ready gates  8/9; blocked freshness');
    expect(text).toContain('Freshness  blocked; window 24h');
    expect(text).toContain('Bench age  stale; 2d');
    expect(text).toContain('Next  Run the Refresh commands below, recapture runtime evidence, then rerun /preflight.');
    expect(text).toMatch(/Loop cue  refresh_now; expired (24h|1d)/);
    expect(text).toContain('Loop command  node scripts/liora-preflight-refresh.mjs');
    expect(text).toContain('Loop evidence  .superliora/evidence/superliora-preflight-refresh (bench + runtime audit)');
    expect(text).toContain('Loop budget  refresh once; no bench iteration');
    expect(text).toContain('Loop last  missing; run Loop command');
    expect(text).toContain('Loop scope  missing; run Loop command');
    expect(text).toContain('Loop guard  missing; run Loop command');
    expect(text).toContain('Loop files  missing; run Loop command');
    expect(text).toContain('Loop delta  missing; run Loop command');
    expect(text).toContain('Loop age  missing; run Loop command');
    expect(text).toContain('Loop proposal  missing; run Loop command');
    expect(text).toContain('Loop next  run_loop_first');
    expect(text).toContain('Refresh  evidence stale or missing');
    expect(text).toContain('Refresh command  node scripts/liora-preflight-refresh.mjs');
    expect(text).toContain('Refresh evidence  .superliora/evidence/superliora-preflight-refresh');
    expect(text).toContain('Refresh runtime  .superliora/evidence/preflight-readiness');
    expect(text).not.toContain('--runtime-evidence-root .superliora/evidence/preflight-readiness');
    expect(text).toContain('Refresh last  PASS; elapsed 1.5s; runtime ok');
    expect(text).toMatch(/Refresh age  stale; 2d; expired (24h|1d)/);
    expect(text).toContain('Refresh bench  score 1.00; passRate 100%; tasks 1/1 passed; q 1; cost 2ms; tok 53; cmd 1');
    expect(text).toContain('Refresh gates  5/5; blocked none; next ready');
    expect(text).toContain('Refresh last evidence  .superliora/evidence/superliora-preflight-refresh');
    expect(text).not.toContain('Refresh verify');
  });

  it('keeps older refresh summaries without readiness gates compatible', () => {
    const status = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.superliora/evidence/bench/summary.json',
        status: 'PASS',
        score: 1,
        passRate: 1,
        holdout: 'active',
        providerBlock: 'not blocked',
        redaction: 'PASS',
        noSecret: true,
        nextAction: 'Run the next bounded Ultrawork loop.',
        warnings: [],
      },
      memory: {
        stats: memoryStats({ total: 1, active: 1 }),
        query: 'browser-use computer-use readiness',
        searchResults: [
          {
            score: 0.93,
            reasons: ['subject'],
            memory: memoryRecord('preflight browser-use computer-use memory'),
          },
        ],
        evidence: {
          sourceRoot: '/repo/.superliora/evidence',
          llmWiki: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/llm-wiki.md',
            summary: 'evidence found',
          },
          knowledgeMap: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/liora-knowledge-map.json',
            summary: 'evidence found',
          },
          browserUse: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/browser-use.json',
            summary: 'evidence found',
          },
          computerUse: {
            ready: true,
            verified: true,
            tier: 'verified',
            matchCount: 1,
            sourcePath: '/repo/.superliora/evidence/computer-use-state.json',
            summary: 'evidence found',
          },
          warnings: [],
        },
      },
      freshness: preflightFreshness('fresh'),
      refreshRun: {
        status: 'PASS',
        evidencePath: '.superliora/evidence/superliora-preflight-refresh',
        durationMs: 61,
        bench: refreshBench(),
        runtimeCandidates: [],
        missingChannels: [],
      },
    });
    const text = buildPreflightLines(status).join('\n');

    expect(text).toContain('Refresh last  PASS; elapsed 61ms; runtime ok');
    expect(text).toContain('Loop cue  review_refresh_summary; age unknown');
    expect(text).toContain('Loop command  node scripts/liora-preflight-refresh.mjs');
    expect(text).toContain('Loop evidence  .superliora/evidence/superliora-preflight-refresh (bench + runtime audit)');
    expect(text).toContain('Loop budget  refresh once; no bench iteration');
    expect(text).toContain('Loop last  missing; run Loop command');
    expect(text).toContain('Loop scope  missing; run Loop command');
    expect(text).toContain('Loop guard  missing; run Loop command');
    expect(text).toContain('Loop files  missing; run Loop command');
    expect(text).toContain('Loop delta  missing; run Loop command');
    expect(text).toContain('Loop age  missing; run Loop command');
    expect(text).toContain('Loop proposal  missing; run Loop command');
    expect(text).toContain('Loop next  run_loop_first');
    expect(text).toContain('Refresh age  unknown');
    expect(text).toContain('Refresh bench  score 1.00; passRate 100%');
    expect(text).not.toContain('Refresh gates');
  });

  it('redacts bench and memory secrets through one helper', () => {
    expect(
      redactPreflightText('api_key=secret-value KIMI_MODEL_API_KEY sk-proj-1234567890abcdef'),
    ).toBe('api_key=[REDACTED_SECRET] [REDACTED_ENV] [REDACTED_SECRET]');
  });

  it('surfaces human-writing anti-slop readiness as advisory-only', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-preflight-human-writing-'));
    try {
      writeHumanWritingFixture(workDir, {
        contract: [
          'Human Writing / Anti-Slop',
          'not a bottleneck on code',
          'light pass',
          'Dynamic routing',
          'response language',
          'Locale-specific skills are discovered via SearchSkill',
          'never assume a default language',
          'surface-specific voice lane',
          'plain specific claims, concrete nouns and verbs',
          'source-backed details',
          'self-audit for template openings',
          'avoid-ai-writing style checks',
          'Do not treat AI-writing detectors as truth',
          'never use detector signals to accuse an author',
          'deterministic unslop cleanup only as advisory pattern checks',
          'reread for changed meaning',
          'second-pass rewrite or deterministic cleanup',
          'AI-writing detectors are advisory pattern checks, not truth.',
        ].join('\n'),
        humanWriting: [
          'Treat no-AI-slop as a quality gate for user-facing prose — not a bottleneck on code, tools, or short confirmations.',
          'Default to a light pass (system.md rules + inline scan). SearchSkill → Skill only when shipping docs, PR/changelog, TUI copy, plan text, or long user-facing prose.',
          'Dynamic routing: combine surface + locked response language in SearchSkill keywords. Locale-specific skills are discovered, not hardcoded.',
          'Choose a surface-specific voice lane for the response language instead of blending tones.',
          'Prefer plain specific claims, concrete nouns and verbs with source-backed details.',
          'Self-audit for template openings and generic conclusions.',
          'Use avoid-ai-writing checks as advisory pattern checks.',
          'Do not treat AI-writing detectors as truth or use them to accuse an author.',
          'Run a second-pass rewrite or deterministic cleanup when available, then reread for changed meaning.',
        ],
      });

      const humanWriting = loadPreflightHumanWriting(workDir);
      const status = buildPreflightStatus({
        ...readyPreflightInput({
          status: 'PASS',
          evidencePath: '.superliora/evidence/liora-agent-bench/latest/loop-summary.json',
        }),
        humanWriting,
      });
      const text = buildPreflightLines(status).join('\n');

      expect(status.ready).toBe(true);
      expect(humanWriting.ready).toBe(true);
      expect(text).toContain('Ready gates  9/9; blocked none');
      expect(text).toContain('Human writing  ready; anti-slop advisory-only');
      expect(text).toContain('Human writing source  apps/liora/src/tui/commands/ultrawork-contract.ts; .superliora/bench/sota-criteria.json');
      expect(text).toContain('Next  Ready: run the next bounded Ultrawork loop from this preflight.');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('blocks human-writing readiness when the contract or rubric is missing', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-preflight-human-writing-missing-'));
    try {
      writeHumanWritingFixture(workDir, {
        contract: 'Human Writing / Anti-Slop\nplain specific claims, concrete nouns and verbs',
        humanWriting: ['generic writing advice'],
      });

      const humanWriting = loadPreflightHumanWriting(workDir);
      const status = buildPreflightStatus({
        ...readyPreflightInput({
          status: 'PASS',
          evidencePath: '.superliora/evidence/liora-agent-bench/latest/loop-summary.json',
        }),
        humanWriting,
      });
      const text = buildPreflightLines(status).join('\n');

      expect(status.ready).toBe(false);
      expect(humanWriting.ready).toBe(false);
      expect(text).toContain('Unified status  blocked');
      expect(text).toContain('Ready gates  8/9; blocked humanWriting');
      expect(text).toContain('Human writing  blocked; blocked contract,rubric,advisory-only; advisory-only required');
      expect(text).toContain('Next  Restore human-writing contract/rubric/advisoryOnly guidance, then rerun /preflight.');
      expect(text).toContain('Warning  human-writing: blocked contract,rubric,advisoryOnly');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('handles malformed refresh summary as a warning instead of crashing preflight', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-preflight-refresh-'));
    try {
      const refreshRoot = join(workDir, '.superliora/evidence/superliora-preflight-refresh');
      mkdirSync(refreshRoot, { recursive: true });
      writeFileSync(join(refreshRoot, 'summary.json'), '{not-json', 'utf8');

      const refreshRun = loadPreflightRefreshRun(workDir);
      expect(refreshRun?.status).toBe('UNREADABLE');
      expect(refreshRun?.warning).toContain('unreadable refresh summary');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('loads structured readiness gates from the latest refresh summary', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-preflight-refresh-gates-'));
    try {
      const refreshRoot = join(workDir, '.superliora/evidence/superliora-preflight-refresh');
      mkdirSync(refreshRoot, { recursive: true });
      writeFileSync(join(refreshRoot, 'summary.json'), JSON.stringify({
        status: 'BLOCKED',
        durationMs: 72,
        readinessGates: {
          total: 5,
          passed: 1,
          blocked: [
            { id: 'llmWiki', label: 'LLM-wiki' },
            { id: 'knowledgeMap', label: 'knowledge-map' },
            { id: 'browserUse', label: 'browser-use' },
          ],
          nextAction: 'refresh_runtime_evidence',
        },
        missingOrStaleRuntimeEvidence: [
          { channel: 'llmWiki' },
          { channel: 'knowledgeMap' },
          { channel: 'browserUse' },
        ],
        runtimeEvidenceCandidates: {
          browserUse: {
            state: 'fresh',
            sourcePath: join(workDir, '.superliora/evidence/browser-use/summary.json'),
          },
        },
      }), 'utf8');

      const refreshRun = loadPreflightRefreshRun(workDir);
      expect(refreshRun?.readinessGates).toEqual({
        total: 5,
        passed: 1,
        blocked: ['llmWiki', 'knowledgeMap', 'browserUse'],
        nextAction: 'refresh_runtime_evidence',
      });
      expect(refreshRun?.runtimeCandidates).toEqual([
        {
          channel: 'browserUse',
          state: 'fresh',
          sourcePath: '.superliora/evidence/browser-use/summary.json',
        },
      ]);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('loads the latest bounded loop summary for preflight', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-preflight-loop-'));
    try {
      const loopRoot = join(workDir, '.superliora/evidence/liora-agent-bench/latest');
      mkdirSync(loopRoot, { recursive: true });
      writeFileSync(join(loopRoot, 'loop-summary.json'), JSON.stringify({
        benchmark: 'superliora-agent-bench-loop',
        status: 'BLOCKED',
        stopReason: 'quarantine_pending',
        bestScore: 1,
        maxIterations: 2,
        rerun: {
          command: 'node scripts/liora-agent-bench.mjs --loop --max-iterations 2 --evidence-root .superliora/evidence/liora-agent-bench/latest',
          evidenceRoot: '.superliora/evidence/liora-agent-bench/latest',
        },
        iterations: [
          {
            index: 1,
            status: 'PASS',
            score: 1,
            counts: {
              discovered: 8,
              selected: 2,
              scored: 1,
              passed: 1,
              failed: 0,
              blocked: 0,
              quarantined: 1,
            },
            quarantine: {
              count: 1,
              tasks: [
                {
                  id: 'seed.contamination-guard.v1',
                  title: 'Quarantine leaked answer fixture',
                  findings: ['answers/solution.txt'],
                  reason: 'Task quarantined before solving because blocked files were present: answers/solution.txt',
                },
              ],
            },
            proposal: 'Preserve passing loop and expand holdout coverage.',
          },
        ],
      }), 'utf8');

      const loopRun = loadPreflightLoopRun(workDir);
      expect(loopRun).toMatchObject({
        status: 'BLOCKED',
        evidencePath: '.superliora/evidence/liora-agent-bench/latest/loop-summary.json',
        evidenceRoot: '.superliora/evidence/liora-agent-bench/latest',
        rerunCommand: 'node scripts/liora-agent-bench.mjs --loop --max-iterations 2 --evidence-root .superliora/evidence/liora-agent-bench/latest',
        stopReason: 'quarantine_pending',
        bestScore: 1,
        firstScore: 1,
        lastScore: 1,
        iterations: 1,
        maxIterations: 2,
        selected: 2,
        scored: 1,
        passed: 1,
        failed: 0,
        blocked: 0,
        quarantined: 1,
        quarantineTask: 'seed.contamination-guard.v1',
        quarantineFindings: ['answers/solution.txt'],
        proposal: 'Preserve passing loop and expand holdout coverage.',
      });
      expect(loopRun?.evidenceMtimeMs).toEqual(expect.any(Number));
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('treats unreadable bounded loop summaries as warnings', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-preflight-loop-bad-'));
    try {
      const loopRoot = join(workDir, '.superliora/evidence/liora-agent-bench/latest');
      mkdirSync(loopRoot, { recursive: true });
      writeFileSync(join(loopRoot, 'loop-summary.json'), '{not-json', 'utf8');

      const loopRun = loadPreflightLoopRun(workDir);
      expect(loopRun?.status).toBe('UNREADABLE');
      expect(loopRun?.warning).toContain('unreadable loop summary');

      const status = buildPreflightStatus({
        bench: {
          sourcePath: '/repo/.superliora/evidence/bench/summary.json',
          status: 'PASS',
          score: 1,
          passRate: 1,
          holdout: 'active',
          providerBlock: 'not blocked',
          redaction: 'PASS',
          noSecret: true,
          nextAction: 'Run the next bounded Ultrawork loop.',
          warnings: [],
        },
        memory: {
          stats: memoryStats({ total: 1, active: 1 }),
          query: 'browser-use computer-use readiness',
          searchResults: [
            {
              score: 0.93,
              reasons: ['subject'],
              memory: memoryRecord('preflight browser-use computer-use memory'),
            },
          ],
          evidence: {
            sourceRoot: '/repo/.superliora/evidence/preflight-readiness',
            llmWiki: {
          ready: true,
          verified: true,
          tier: 'verified',
          matchCount: 1,
              sourcePath: '/repo/.superliora/evidence/llm-wiki.json',
              summary: 'evidence found',
            },
            knowledgeMap: {
          ready: true,
          verified: true,
          tier: 'verified',
          matchCount: 1,
              sourcePath: '/repo/.superliora/evidence/liora-knowledge-map.json',
              summary: 'evidence found',
            },
            browserUse: {
          ready: true,
          verified: true,
          tier: 'verified',
          matchCount: 1,
              sourcePath: '/repo/.superliora/evidence/browser-use.json',
              summary: 'evidence found',
            },
            computerUse: {
          ready: true,
          verified: true,
          tier: 'verified',
          matchCount: 1,
              sourcePath: '/repo/.superliora/evidence/computer-use.json',
              summary: 'evidence found',
            },
            warnings: [],
          },
        },
        freshness: preflightFreshness('fresh'),
        loopRun,
      });
      const text = buildPreflightLines(status).join('\n');
      expect(text).toContain('Loop delta  inspect_loop_summary .superliora/evidence/liora-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop rerun  inspect_loop_summary .superliora/evidence/liora-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop inspect  inspect_loop_summary .superliora/evidence/liora-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop scope  inspect_loop_summary .superliora/evidence/liora-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop guard  inspect_loop_summary .superliora/evidence/liora-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop files  inspect_loop_summary .superliora/evidence/liora-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop age  inspect_loop_summary .superliora/evidence/liora-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop next  inspect_loop_summary .superliora/evidence/liora-agent-bench/latest/loop-summary.json');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});

function memoryStats(input: { readonly total: number; readonly active: number }): MemoryStats {
  return {
    total: input.total,
    active: input.active,
    archived: 0,
    deleted: 0,
    byKind: {
      semantic: input.active,
      episodic: 0,
      procedural: 0,
      prospective: 0,
      governance: 0,
    },
    byScope: {
      user: 0,
      workspace: input.active,
      session: 0,
    },
  };
}

function memoryRecord(subject: string): MemoryRecord {
  return {
    id: 'mem_1',
    kind: 'semantic',
    scope: 'workspace',
    subject,
    content: 'Harness preflight memory.',
    tags: ['manual'],
    confidence: 1,
    importance: 1,
    status: 'active',
    source: { kind: 'user' },
    createdAt: 1,
    updatedAt: 1,
    accessCount: 0,
    supersedes: [],
    metadata: {},
  };
}

function readyPreflightInput(
  loopRun: NonNullable<Parameters<typeof buildPreflightStatus>[0]['loopRun']>,
): Parameters<typeof buildPreflightStatus>[0] {
  return {
    bench: {
      sourcePath: '/repo/.superliora/evidence/bench/summary.json',
      status: 'PASS',
      score: 1,
      passRate: 1,
      holdout: 'active',
      providerBlock: 'not blocked',
      redaction: 'PASS',
      noSecret: true,
      nextAction: 'Run the next bounded Ultrawork loop.',
      warnings: [],
    },
    memory: {
      stats: memoryStats({ total: 1, active: 1 }),
      query: 'browser-use computer-use readiness',
      searchResults: [
        {
          score: 0.93,
          reasons: ['subject'],
          memory: memoryRecord('preflight browser-use computer-use memory'),
        },
      ],
      evidence: {
        sourceRoot: '/repo/.superliora/evidence',
        llmWiki: {
          ready: true,
          verified: true,
          tier: 'verified',
          matchCount: 1,
          sourcePath: '/repo/.superliora/evidence/llm-wiki.md',
          summary: 'evidence found',
        },
        knowledgeMap: {
          ready: true,
          verified: true,
          tier: 'verified',
          matchCount: 1,
          sourcePath: '/repo/.superliora/evidence/liora-knowledge-map.json',
          summary: 'evidence found',
        },
        browserUse: {
          ready: true,
          verified: true,
          tier: 'verified',
          matchCount: 1,
          sourcePath: '/repo/.superliora/evidence/browser-use.json',
          summary: 'evidence found',
        },
        computerUse: {
          ready: true,
          verified: true,
          tier: 'verified',
          matchCount: 1,
          sourcePath: '/repo/.superliora/evidence/computer-use-state.json',
          summary: 'evidence found',
        },
        warnings: [],
      },
    },
    freshness: preflightFreshness('fresh'),
    loopRun,
  };
}

function preflightFreshness(state: 'fresh' | 'missing' | 'stale'): PreflightFreshness {
  const ageMs = state === 'fresh' ? 10 * 1000 : state === 'stale' ? 2 * 24 * 60 * 60 * 1000 : undefined;
  const signal = {
    state,
    ageMs,
    sourcePath: state === 'missing' ? undefined : '/repo/.superliora/evidence/source.json',
  };
  return {
    ready: state === 'fresh',
    windowMs: 24 * 60 * 60 * 1000,
    bench: signal,
    llmWiki: signal,
    knowledgeMap: signal,
    browserUse: signal,
    computerUse: signal,
  };
}

function writeHumanWritingFixture(
  workDir: string,
  fixture: { readonly contract: string; readonly humanWriting: readonly string[] },
) {
  const contractDir = join(workDir, 'apps/liora/src/tui/commands');
  const criteriaDir = join(workDir, '.superliora/bench');
  mkdirSync(contractDir, { recursive: true });
  mkdirSync(criteriaDir, { recursive: true });
  writeFileSync(join(contractDir, 'ultrawork-contract.ts'), fixture.contract, 'utf8');
  writeFileSync(join(criteriaDir, 'sota-criteria.json'), JSON.stringify({
    loopScoreRubric: {
      humanWriting: fixture.humanWriting,
    },
  }), 'utf8');
}

function refreshBench() {
  return {
    score: 1,
    passRate: 1,
    scored: 1,
    passed: 1,
    failed: 0,
    blocked: 0,
    quarantined: 1,
    wallClockMs: 2,
    estimatedTokens: 53,
    commandCount: 1,
  };
}
