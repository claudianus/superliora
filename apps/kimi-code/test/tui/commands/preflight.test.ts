import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MemoryRecord, MemoryStats } from '@moonshot-ai/kimi-code-sdk';
import { describe, expect, it } from 'vitest';

import {
  buildPreflightLines,
  buildPreflightStatus,
  loadPreflightLoopRun,
  loadPreflightRefreshRun,
  redactPreflightText,
  type PreflightFreshness,
} from '#/tui/commands/preflight';

describe('preflight slash command status surface', () => {
  it('unifies bench, memory, recall, and runtime evidence readiness', () => {
    const status = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.omo/evidence/bench/summary.json',
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
          sourceRoot: '/repo/.omo/evidence',
          llmWiki: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/llm-wiki.md',
            summary: 'evidence found',
          },
          knowledgeMap: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/kimi-knowledge-map.json',
            summary: 'evidence found',
          },
          browserUse: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/browser-use.json',
            summary: 'evidence found',
          },
          computerUse: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/computer-use-state.json',
            summary: 'evidence found',
          },
          warnings: [],
        },
      },
      freshness: preflightFreshness('fresh'),
      loopRun: {
        status: 'BLOCKED',
        evidencePath: '.omo/evidence/kimi-agent-bench/latest/loop-summary.json',
        evidenceRoot: '.omo/evidence/kimi-agent-bench/latest',
        rerunCommand: 'node scripts/kimi-agent-bench.mjs --loop --max-iterations 2 --evidence-root .omo/evidence/kimi-agent-bench/latest',
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
    expect(text).toContain('LLM-wiki evidence  ready');
    expect(text).toContain('Knowledge-map evidence  ready');
    expect(text).toContain('Browser-use evidence  ready');
    expect(text).toContain('Computer-use evidence  ready');
    expect(text).toContain('Ready gates  8/8; blocked none');
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
    expect(text).toContain('Loop command  node scripts/kimi-agent-bench.mjs --loop --max-iterations 2');
    expect(text).toContain('Loop evidence  .omo/evidence/kimi-agent-bench');
    expect(text).toContain('Loop rerun  node scripts/kimi-agent-bench.mjs --loop --max-iterations 2 --evidence-root .omo/evidence/kimi-agent-bench/latest');
    expect(text).toContain('Loop inspect  .omo/evidence/kimi-agent-bench/latest/loop-summary.json');
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
      evidencePath: '.omo/evidence/kimi-agent-bench/latest/loop-summary.json',
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
      evidencePath: '.omo/evidence/kimi-agent-bench/latest/loop-summary.json',
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
    expect(text).toContain('Loop rerun  node scripts/kimi-agent-bench.mjs --loop --max-iterations 2 --evidence-root .omo/evidence/kimi-agent-bench/latest');
    expect(text).toContain('Loop inspect  .omo/evidence/kimi-agent-bench/latest/loop-summary.json');
    expect(text).toContain('Loop next  implement_proposal_then_rerun_loop');
  });

  it('degrades honestly without claiming readiness and redacts secret-looking text', () => {
    const status = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.omo/evidence/malformed/summary.json',
        status: 'UNAVAILABLE',
        noSecret: false,
        nextAction: 'Run node scripts/kimi-agent-bench.mjs, then open /bench again.',
        warnings: ['No bench evidence found at /repo/.omo/evidence/malformed/summary.json'],
      },
      memory: {
        stats: memoryStats({ total: 0, active: 0 }),
        query: 'api_key=secret-value KIMI_MODEL_API_KEY sk-proj-1234567890abcdef',
        searchResults: [],
        evidence: {
          sourceRoot: '/repo/.omo/evidence',
          llmWiki: {
            ready: false,
            matchCount: 0,
            summary: 'No llm-wiki or durable-memory evidence found.',
          },
          knowledgeMap: {
            ready: false,
            matchCount: 0,
            summary: 'No Kimi Knowledge Map evidence found.',
          },
          browserUse: {
            ready: false,
            matchCount: 0,
            summary: 'No browser-use evidence found.',
          },
          computerUse: {
            ready: false,
            matchCount: 0,
            summary: 'No computer-use evidence found.',
          },
          warnings: ['Malformed evidence ignored: /repo/.omo/evidence/browser-use.json'],
        },
      },
      freshness: preflightFreshness('missing'),
      refreshRun: {
        status: 'BLOCKED',
        evidencePath: '.omo/evidence/super-kimi-preflight-refresh',
        durationMs: 742,
        completedAt: new Date(Date.now() - 10 * 1000).toISOString(),
        bench: refreshBench(),
        readinessGates: {
          total: 5,
          passed: 1,
          blocked: ['llmWiki', 'knowledgeMap', 'browserUse', 'computerUse'],
          nextAction: 'refresh_runtime_evidence',
        },
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
    expect(text).toContain('Ready gates  0/8; blocked bench,memory,recall,llmWiki,knowledgeMap,browserUse,computerUse,freshness');
    expect(text).toContain('Freshness  blocked; window 24h');
    expect(text).toContain('Bench age  missing');
    expect(text).toContain('Boundary  review evidence before sharing');
    expect(text).toContain('No-web  browser UI excluded');
    expect(text).toContain('Next  Run node scripts/kimi-agent-bench.mjs, then open /bench again.');
    expect(text).toContain('Loop cue  refresh_now; refresh_due 23h');
    expect(text).toContain('Loop command  node scripts/kimi-preflight-refresh.mjs');
    expect(text).toContain('Loop evidence  .omo/evidence/super-kimi-preflight-refresh (bench + runtime audit)');
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
    expect(text).toContain('Refresh command  node scripts/kimi-preflight-refresh.mjs');
    expect(text).toContain('--runtime-evidence-root .omo/evidence/preflight-readiness');
    expect(text).toContain('Refresh evidence  .omo/evidence/super-kimi-preflight-refresh');
    expect(text).toContain('Refresh last  BLOCKED; elapsed 742ms; missing llmWiki,knowledgeMap,browserUse,computerUse');
    expect(text).toContain('Refresh age  fresh; 0m; due 23h');
    expect(text).toContain('Refresh bench  score 1.00; passRate 100%; tasks 1/1 passed; q 1; cost 2ms; tok 53; cmd 1');
    expect(text).toContain('Refresh gates  1/5; blocked llmWiki,knowledgeMap,browserUse,computerUse; next refresh_runtime_evidence');
    expect(text).toContain('Refresh last evidence  .omo/evidence/super-kimi-preflight-refresh');
    expect(text).not.toContain('Refresh verify');
    expect(text).toContain('Warning  memory: Malformed evidence ignored');
    expect(text).not.toContain('secret-value');
    expect(text).not.toContain('KIMI_MODEL_API_KEY');
    expect(text).not.toContain('sk-proj-1234567890abcdef');
  });

  it('blocks otherwise ready preflight state when evidence is stale', () => {
    const status = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.omo/evidence/bench/summary.json',
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
          sourceRoot: '/repo/.omo/evidence',
          llmWiki: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/llm-wiki.md',
            summary: 'evidence found',
          },
          knowledgeMap: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/kimi-knowledge-map.json',
            summary: 'evidence found',
          },
          browserUse: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/browser-use.json',
            summary: 'evidence found',
          },
          computerUse: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/computer-use-state.json',
            summary: 'evidence found',
          },
          warnings: [],
        },
      },
      freshness: preflightFreshness('stale'),
      refreshRun: {
        status: 'PASS',
        evidencePath: '.omo/evidence/super-kimi-preflight-refresh',
        durationMs: 1500,
        completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        bench: refreshBench(),
        readinessGates: {
          total: 5,
          passed: 5,
          blocked: [],
          nextAction: 'ready',
        },
        missingChannels: [],
      },
    });
    const text = buildPreflightLines(status).join('\n');

    expect(status.ready).toBe(false);
    expect(text).toContain('Unified status  blocked');
    expect(text).toContain('Ready gates  7/8; blocked freshness');
    expect(text).toContain('Freshness  blocked; window 24h');
    expect(text).toContain('Bench age  stale; 2d');
    expect(text).toContain('Next  Run the Refresh commands below, recapture runtime evidence, then rerun /preflight.');
    expect(text).toMatch(/Loop cue  refresh_now; expired (24h|1d)/);
    expect(text).toContain('Loop command  node scripts/kimi-preflight-refresh.mjs');
    expect(text).toContain('Loop evidence  .omo/evidence/super-kimi-preflight-refresh (bench + runtime audit)');
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
    expect(text).toContain('Refresh command  node scripts/kimi-preflight-refresh.mjs');
    expect(text).toContain('--runtime-evidence-root .omo/evidence/preflight-readiness');
    expect(text).toContain('Refresh evidence  .omo/evidence/super-kimi-preflight-refresh');
    expect(text).toContain('Refresh last  PASS; elapsed 1.5s; runtime ok');
    expect(text).toMatch(/Refresh age  stale; 2d; expired (24h|1d)/);
    expect(text).toContain('Refresh bench  score 1.00; passRate 100%; tasks 1/1 passed; q 1; cost 2ms; tok 53; cmd 1');
    expect(text).toContain('Refresh gates  5/5; blocked none; next ready');
    expect(text).toContain('Refresh last evidence  .omo/evidence/super-kimi-preflight-refresh');
    expect(text).not.toContain('Refresh verify');
  });

  it('keeps older refresh summaries without readiness gates compatible', () => {
    const status = buildPreflightStatus({
      bench: {
        sourcePath: '/repo/.omo/evidence/bench/summary.json',
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
          sourceRoot: '/repo/.omo/evidence',
          llmWiki: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/llm-wiki.md',
            summary: 'evidence found',
          },
          knowledgeMap: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/kimi-knowledge-map.json',
            summary: 'evidence found',
          },
          browserUse: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/browser-use.json',
            summary: 'evidence found',
          },
          computerUse: {
            ready: true,
            matchCount: 1,
            sourcePath: '/repo/.omo/evidence/computer-use-state.json',
            summary: 'evidence found',
          },
          warnings: [],
        },
      },
      freshness: preflightFreshness('fresh'),
      refreshRun: {
        status: 'PASS',
        evidencePath: '.omo/evidence/super-kimi-preflight-refresh',
        durationMs: 61,
        bench: refreshBench(),
        missingChannels: [],
      },
    });
    const text = buildPreflightLines(status).join('\n');

    expect(text).toContain('Refresh last  PASS; elapsed 61ms; runtime ok');
    expect(text).toContain('Loop cue  review_refresh_summary; age unknown');
    expect(text).toContain('Loop command  node scripts/kimi-preflight-refresh.mjs');
    expect(text).toContain('Loop evidence  .omo/evidence/super-kimi-preflight-refresh (bench + runtime audit)');
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

  it('handles malformed refresh summary as a warning instead of crashing preflight', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-preflight-refresh-'));
    try {
      const refreshRoot = join(workDir, '.omo/evidence/super-kimi-preflight-refresh');
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
      const refreshRoot = join(workDir, '.omo/evidence/super-kimi-preflight-refresh');
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
      }), 'utf8');

      const refreshRun = loadPreflightRefreshRun(workDir);
      expect(refreshRun?.readinessGates).toEqual({
        total: 5,
        passed: 1,
        blocked: ['llmWiki', 'knowledgeMap', 'browserUse'],
        nextAction: 'refresh_runtime_evidence',
      });
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('loads the latest bounded loop summary for preflight', () => {
    const workDir = mkdtempSync(join(tmpdir(), 'kimi-preflight-loop-'));
    try {
      const loopRoot = join(workDir, '.omo/evidence/kimi-agent-bench/latest');
      mkdirSync(loopRoot, { recursive: true });
      writeFileSync(join(loopRoot, 'loop-summary.json'), JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop',
        status: 'BLOCKED',
        stopReason: 'quarantine_pending',
        bestScore: 1,
        maxIterations: 2,
        rerun: {
          command: 'node scripts/kimi-agent-bench.mjs --loop --max-iterations 2 --evidence-root .omo/evidence/kimi-agent-bench/latest',
          evidenceRoot: '.omo/evidence/kimi-agent-bench/latest',
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
        evidencePath: '.omo/evidence/kimi-agent-bench/latest/loop-summary.json',
        evidenceRoot: '.omo/evidence/kimi-agent-bench/latest',
        rerunCommand: 'node scripts/kimi-agent-bench.mjs --loop --max-iterations 2 --evidence-root .omo/evidence/kimi-agent-bench/latest',
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
      const loopRoot = join(workDir, '.omo/evidence/kimi-agent-bench/latest');
      mkdirSync(loopRoot, { recursive: true });
      writeFileSync(join(loopRoot, 'loop-summary.json'), '{not-json', 'utf8');

      const loopRun = loadPreflightLoopRun(workDir);
      expect(loopRun?.status).toBe('UNREADABLE');
      expect(loopRun?.warning).toContain('unreadable loop summary');

      const status = buildPreflightStatus({
        bench: {
          sourcePath: '/repo/.omo/evidence/bench/summary.json',
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
            sourceRoot: '/repo/.omo/evidence/preflight-readiness',
            llmWiki: {
              ready: true,
              matchCount: 1,
              sourcePath: '/repo/.omo/evidence/llm-wiki.json',
              summary: 'evidence found',
            },
            knowledgeMap: {
              ready: true,
              matchCount: 1,
              sourcePath: '/repo/.omo/evidence/kimi-knowledge-map.json',
              summary: 'evidence found',
            },
            browserUse: {
              ready: true,
              matchCount: 1,
              sourcePath: '/repo/.omo/evidence/browser-use.json',
              summary: 'evidence found',
            },
            computerUse: {
              ready: true,
              matchCount: 1,
              sourcePath: '/repo/.omo/evidence/computer-use.json',
              summary: 'evidence found',
            },
            warnings: [],
          },
        },
        freshness: preflightFreshness('fresh'),
        loopRun,
      });
      const text = buildPreflightLines(status).join('\n');
      expect(text).toContain('Loop delta  inspect_loop_summary .omo/evidence/kimi-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop rerun  inspect_loop_summary .omo/evidence/kimi-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop inspect  inspect_loop_summary .omo/evidence/kimi-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop scope  inspect_loop_summary .omo/evidence/kimi-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop guard  inspect_loop_summary .omo/evidence/kimi-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop files  inspect_loop_summary .omo/evidence/kimi-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop age  inspect_loop_summary .omo/evidence/kimi-agent-bench/latest/loop-summary.json');
      expect(text).toContain('Loop next  inspect_loop_summary .omo/evidence/kimi-agent-bench/latest/loop-summary.json');
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
      sourcePath: '/repo/.omo/evidence/bench/summary.json',
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
        sourceRoot: '/repo/.omo/evidence',
        llmWiki: {
          ready: true,
          matchCount: 1,
          sourcePath: '/repo/.omo/evidence/llm-wiki.md',
          summary: 'evidence found',
        },
        knowledgeMap: {
          ready: true,
          matchCount: 1,
          sourcePath: '/repo/.omo/evidence/kimi-knowledge-map.json',
          summary: 'evidence found',
        },
        browserUse: {
          ready: true,
          matchCount: 1,
          sourcePath: '/repo/.omo/evidence/browser-use.json',
          summary: 'evidence found',
        },
        computerUse: {
          ready: true,
          matchCount: 1,
          sourcePath: '/repo/.omo/evidence/computer-use-state.json',
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
    sourcePath: state === 'missing' ? undefined : '/repo/.omo/evidence/source.json',
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
