import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBenchStatusLines,
  loadBenchStatus,
  redactBenchStatusText,
} from '#/tui/commands/bench';

describe('bench slash command status surface', () => {
  it('builds a concise redacted status transcript from gate evidence', () => {
    const lines = buildBenchStatusLines({
      sourcePath: '/repo/.omo/evidence/gate-summary.json',
      status: 'APPROVE',
      score: 1,
      passRate: 1,
      budget: 'FAIL',
      budgetExceeded: 2,
      budgetTasks: [
        {
          id: 'seed.budget-overrun.v1',
          violations: ['wallMs 44 > 1', 'commands 2 > 0'],
        },
      ],
      budgetInspect: '/repo/.omo/evidence/run/tasks/seed.budget-overrun.v1/result.json',
      budgetRerun: 'node scripts/kimi-agent-bench.mjs --suite seed --runner fixture',
      holdout: 'active',
      providerBlock: 'blocked_missing_env: KIMI_MODEL_API_KEY',
      redaction: 'PASS',
      noSecret: true,
      nextAction: 'Unblock provider credentials, then rerun the provider holdout.',
      warnings: [],
    });

    expect(lines.join('\n')).toContain('Latest status  APPROVE');
    expect(lines.join('\n')).toContain('Score/passRate  1.00 / 100%');
    expect(lines.join('\n')).toContain('Holdout  active');
    expect(lines.join('\n')).toContain('Budget  FAIL; exceeded 2');
    expect(lines.join('\n')).toContain('Budget top  seed.budget-overrun.v1');
    expect(lines.join('\n')).toContain('Budget detail  wallMs 44 > 1; commands 2 > 0');
    expect(lines.join('\n')).toContain('Budget inspect  /repo/.omo/evidence/run/tasks/seed.budget-overrun.v1/result.json');
    expect(lines.join('\n')).toContain('Budget rerun  node scripts/kimi-agent-bench.mjs --suite seed --runner fixture');
    expect(lines.join('\n')).toContain('Provider  blocked_missing_env: [REDACTED_ENV]');
    expect(lines.join('\n')).toContain('Secrets  redaction PASS; no secret-looking strings displayed');
    expect(lines.join('\n')).toContain('Next  Unblock provider credentials, then rerun the provider holdout.');
    expect(lines.join('\n')).not.toContain('KIMI_MODEL_API_KEY');
  });

  it('loads the newest local evidence from the default bench root', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-test');
    const evidenceRoot = join(
      workDir,
      '.omo/evidence/super-kimi-provider-bench/final-quality-gate',
    );
    mkdirSync(join(evidenceRoot, 'older-provider'), { recursive: true });
    mkdirSync(join(evidenceRoot, 'newer-loop'), { recursive: true });
    writeFileSync(
      join(evidenceRoot, 'older-provider', 'summary.json'),
      JSON.stringify({
        status: 'FAIL',
        completedAt: '2026-06-28T00:00:00.000Z',
        metrics: { score: 0, passRate: 0 },
      }),
    );
    writeFileSync(
      join(evidenceRoot, 'newer-loop', 'loop-summary.json'),
      JSON.stringify({
        status: 'PASS',
        completedAt: '2026-06-29T00:00:00.000Z',
        bestScore: 0.9,
        iterations: [{ passRate: 0.8, proposal: 'Keep fixtures redacted.' }],
      }),
    );

    const status = loadBenchStatus(workDir, '');

    expect(status.status).toBe('PASS');
    expect(status.score).toBe(0.9);
    expect(status.passRate).toBe(0.8);
    expect(status.nextAction).toBe('Keep fixtures redacted.');
    expect(status.sourceDisplayPath).toBe(
      '.omo/evidence/super-kimi-provider-bench/final-quality-gate/newer-loop/loop-summary.json',
    );
  });

  it('keeps external source paths absolute when evidence is outside the workdir', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-source-workdir-test');
    const evidenceRoot = join(process.cwd(), 'node_modules', '.tmp-bench-external-source-test');
    mkdirSync(workDir, { recursive: true });
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(
      join(evidenceRoot, 'summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench',
        status: 'PASS',
        completedAt: '2026-06-29T00:00:00.000Z',
        metrics: { score: 1, passRate: 1 },
      }),
    );

    const status = loadBenchStatus(workDir, evidenceRoot);
    const text = buildBenchStatusLines(status).join('\n');

    expect(status.sourceDisplayPath).toBe(join(evidenceRoot, 'summary.json'));
    expect(text).toContain(`Source  ${join(evidenceRoot, 'summary.json')}`);
  });

  it('surfaces bounded loop trend and rerun context from loop summaries', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-loop-trend-test');
    const evidenceRoot = join(workDir, '.omo/evidence/loop-trend');
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(
      join(evidenceRoot, 'loop-summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop',
        status: 'PASS',
        completedAt: '2026-06-29T00:00:00.000Z',
        bestScore: 0.8,
        wallClockMs: 4500,
        maxTotalMs: 600000,
        maxIterations: 2,
        stopReason: 'no_score_delta',
        guardrails: {
          bounded: true,
          executeCodeChanges: false,
        },
        rerun: {
          command:
            'node scripts/kimi-agent-bench.mjs --loop --task-dir .omo/bench/tasks --suite seed --runner fixture --max-total-ms 600000 --max-iterations 2 --evidence-root .omo/evidence/loop-trend',
          argv: [
            'node',
            'scripts/kimi-agent-bench.mjs',
            '--loop',
            '--task-dir',
            '.omo/bench/tasks',
            '--suite',
            'seed',
            '--runner',
            'fixture',
            '--max-total-ms',
            '600000',
            '--max-iterations',
            '2',
            '--evidence-root',
            '.omo/evidence/loop-trend',
          ],
        },
        iterations: [
          {
            index: 1,
            status: 'PASS',
            score: 0.5,
            passRate: 0.5,
            delta: 0,
            proposal: 'Start with seed smoke.',
          },
          {
            index: 2,
            status: 'PASS',
            score: 0.8,
            passRate: 0.75,
            delta: 0.3,
            counts: {
              selected: 4,
              scored: 3,
              failed: 1,
              blocked: 0,
            },
            focus: {
              status: 'attention',
              taxonomy: [{ name: 'check_failed', count: 1 }],
              tasks: [
                {
                  id: 'seed.fix-target.v1',
                  status: 'FAIL',
                  taxonomy: ['check_failed'],
                  reason: 'Check failed: expected config mode.',
                  action: 'cat .omo/evidence/loop-trend/iterations/02/tasks/seed.fix-target.v1/result.json',
                  displayPath: '.omo/evidence/loop-trend/iterations/02/tasks/seed.fix-target.v1/result.json',
                  resultPath: join(evidenceRoot, 'iterations/02/tasks/seed.fix-target.v1/result.json'),
                },
              ],
            },
            proposal: 'Tighten the next budget-sensitive task.',
          },
        ],
      }),
    );

    const status = loadBenchStatus(workDir, '.omo/evidence/loop-trend');
    const text = buildBenchStatusLines(status).join('\n');

    expect(text).toContain('Loop trend  iter 2; score 0.50 -> 0.80 (+0.30); best 0.80');
    expect(text).toContain('Loop latest  status PASS; passRate 75%; delta +0.30');
    expect(text).toContain('Loop focus  FAIL seed.fix-target.v1 (check_failed); top check_failed x1');
    expect(text).toContain('Loop reason  Check failed: expected config mode.');
    expect(text).toContain(
      'Loop action  cat .omo/evidence/loop-trend/iterations/02/tasks/seed.fix-target.v1/result.json',
    );
    expect(text).toContain(
      'Loop inspect  .omo/evidence/loop-trend/iterations/02/tasks/seed.fix-target.v1/result.json',
    );
    expect(text).toContain('Loop cost  wall 4.5s/10m; tasks 3/4; failed 1; blocked 0');
    expect(text).toContain('Loop guard  bounded true; maxIter 2; codeChanges false');
    expect(text).toContain('Loop stop  no_score_delta');
    expect(text).toContain(
      'Loop rerun  node scripts/kimi-agent-bench.mjs --loop --task-dir .omo/bench/tasks --suite seed --runner fixture --max-total-ms 600000 --max-iterations 2 --evidence-root .omo/evidence/loop-trend',
    );
    expect(text).toContain(
      'Loop replay  node scripts/kimi-agent-bench.mjs --replay-summary .omo/evidence/loop-trend/loop-summary.json --evidence-root .omo/evidence/loop-trend/replay',
    );
    expect(text).toContain('Next  Tighten the next budget-sensitive task.');
    expect(text).toContain('Source  .omo/evidence/loop-trend/loop-summary.json');
    expect(text).not.toContain(`Source  ${workDir}`);
  });

  it('shows replay only for local loop summaries with structured rerun argv', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-loop-replay-test');
    const legacyRoot = join(workDir, '.omo/evidence/legacy-loop');
    const externalRoot = join(process.cwd(), 'node_modules', '.tmp-bench-loop-replay-external-test');
    mkdirSync(legacyRoot, { recursive: true });
    mkdirSync(externalRoot, { recursive: true });
    const loopSummary = {
      benchmark: 'super-kimi-agent-bench-loop',
      status: 'PASS',
      bestScore: 1,
      rerun: {
        command: 'node scripts/kimi-agent-bench.mjs --loop --evidence-root .omo/evidence/loop',
      },
      iterations: [{ status: 'PASS', score: 1, passRate: 1 }],
    };
    writeFileSync(join(legacyRoot, 'loop-summary.json'), JSON.stringify(loopSummary));
    writeFileSync(
      join(externalRoot, 'loop-summary.json'),
      JSON.stringify({
        ...loopSummary,
        rerun: {
          ...loopSummary.rerun,
          argv: ['node', 'scripts/kimi-agent-bench.mjs', '--loop', '--evidence-root', 'old'],
        },
      }),
    );

    const legacyText = buildBenchStatusLines(loadBenchStatus(workDir, '.omo/evidence/legacy-loop')).join('\n');
    const externalText = buildBenchStatusLines(loadBenchStatus(workDir, externalRoot)).join('\n');

    expect(legacyText).toContain('Loop rerun  node scripts/kimi-agent-bench.mjs --loop --evidence-root .omo/evidence/loop');
    expect(legacyText).not.toContain('Loop replay');
    expect(externalText).toContain(`Source  ${join(externalRoot, 'loop-summary.json')}`);
    expect(externalText).not.toContain('Loop replay');
  });

  it('quotes local replay paths that need shell escaping', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-loop-replay-quote-test');
    const specialRoot = join(workDir, '.omo/evidence', "loop replay's path");
    mkdirSync(specialRoot, { recursive: true });
    writeFileSync(
      join(specialRoot, 'loop-summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop',
        status: 'PASS',
        bestScore: 1,
        rerun: {
          command: 'node scripts/kimi-agent-bench.mjs --loop --evidence-root .omo/evidence/loop',
          argv: ['node', 'scripts/kimi-agent-bench.mjs', '--loop', '--evidence-root', 'old'],
        },
        iterations: [{ status: 'PASS', score: 1, passRate: 1 }],
      }),
    );

    const text = buildBenchStatusLines(loadBenchStatus(workDir, ".omo/evidence/loop replay's path")).join('\n');

    expect(text).toContain(
      "Loop replay  node scripts/kimi-agent-bench.mjs --replay-summary '.omo/evidence/loop replay'\\''s path/loop-summary.json' --evidence-root '.omo/evidence/loop replay'\\''s path/replay'",
    );
  });

  it('surfaces replay wrapper evidence before child loop summaries', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-replay-wrapper-test');
    const replayRoot = join(workDir, '.omo/evidence/replay-root');
    const sourceRoot = join(workDir, '.omo/evidence/source-loop');
    mkdirSync(replayRoot, { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });
    const childLoopSummary = {
      benchmark: 'super-kimi-agent-bench-loop',
      status: 'PASS',
      bestScore: 1,
      iterations: [{ status: 'PASS', score: 1, passRate: 1 }],
    };
    writeFileSync(join(replayRoot, 'loop-summary.json'), JSON.stringify(childLoopSummary));
    writeFileSync(
      join(replayRoot, 'replay-summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop-replay',
        status: 'PASS',
        childExitCode: 0,
        childTimedOut: false,
        onlyEvidenceRootChanged: true,
        shellParsing: false,
        sourceSummaryPath: join(sourceRoot, 'loop-summary.json'),
        evidenceRoot: replayRoot,
        replayedLoopSummary: childLoopSummary,
      }),
    );

    const text = buildBenchStatusLines(loadBenchStatus(workDir, '.omo/evidence/replay-root')).join('\n');

    expect(text).toContain('Holdout  loop replay wrapper');
    expect(text).toContain('Replay  child PASS; exit 0; rootOnly true; shellParsing false; timeout false');
    expect(text).toContain(
      'Replay verdict  trusted; child PASS; exit 0; rootOnly true; shellParsing false; timeout false',
    );
    expect(text).toContain('Replay source  .omo/evidence/source-loop/loop-summary.json');
    expect(text).toContain('Replay evidence  .omo/evidence/replay-root');
    expect(text).toContain('Replay inspect  cat .omo/evidence/replay-root/loop-summary.json');
    expect(text).toContain('Replay log  cat .omo/evidence/replay-root/commands.jsonl');
    expect(text).toContain(
      'Replay diff  diff -u .omo/evidence/source-loop/loop-summary.json .omo/evidence/replay-root/loop-summary.json',
    );
    expect(text).toContain('Next  Replay verified; inspect child loop result PASS before the next improvement.');
    expect(text).toContain('Source  .omo/evidence/replay-root/replay-summary.json');
    expect(text).not.toContain('Source  .omo/evidence/replay-root/loop-summary.json');
  });

  it('classifies unsafe replay wrappers before trusting them', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-replay-verdict-test');
    const root = join(workDir, '.omo/evidence/replay-verdict');
    mkdirSync(root, { recursive: true });
    const childPass = {
      benchmark: 'super-kimi-agent-bench-loop',
      status: 'PASS',
      bestScore: 1,
      iterations: [{ status: 'PASS', score: 1, passRate: 1 }],
    };
    const childFail = {
      ...childPass,
      status: 'FAIL',
      bestScore: 0,
      iterations: [{ status: 'FAIL', score: 0, passRate: 0 }],
    };

    function writeReplay(name: string, value: Record<string, unknown>): string {
      const replayRoot = join(root, name);
      mkdirSync(replayRoot, { recursive: true });
      writeFileSync(join(replayRoot, 'replay-summary.json'), JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop-replay',
        status: 'PASS',
        childExitCode: 0,
        childTimedOut: false,
        onlyEvidenceRootChanged: true,
        shellParsing: false,
        sourceSummaryPath: join(root, 'source-loop/loop-summary.json'),
        evidenceRoot: replayRoot,
        replayedLoopSummary: childPass,
        ...value,
      }));
      return `.omo/evidence/replay-verdict/${name}`;
    }

    const shellParsingText = buildBenchStatusLines(loadBenchStatus(workDir, writeReplay('shell-parsing', {
      shellParsing: true,
    }))).join('\n');
    const driftText = buildBenchStatusLines(loadBenchStatus(workDir, writeReplay('argv-drift', {
      onlyEvidenceRootChanged: false,
    }))).join('\n');
    const timeoutText = buildBenchStatusLines(loadBenchStatus(workDir, writeReplay('timeout', {
      status: 'BLOCKED',
      childExitCode: 124,
      childTimedOut: true,
    }))).join('\n');
    const nonzeroText = buildBenchStatusLines(loadBenchStatus(workDir, writeReplay('nonzero', {
      status: 'FAIL',
      childExitCode: 2,
      replayedLoopSummary: childFail,
    }))).join('\n');
    const missingText = buildBenchStatusLines(loadBenchStatus(workDir, writeReplay('missing', {
      childExitCode: undefined,
      childTimedOut: undefined,
      onlyEvidenceRootChanged: undefined,
      shellParsing: undefined,
      replayedLoopSummary: undefined,
    }))).join('\n');

    expect(shellParsingText).toContain('Replay verdict  suspect; shellParsing true');
    expect(driftText).toContain('Replay verdict  suspect; rootOnly false');
    expect(timeoutText).toContain('Replay verdict  blocked; wrapper BLOCKED; exit 124; timeout true');
    expect(nonzeroText).toContain('Replay verdict  blocked; wrapper FAIL; child FAIL; exit 2');
    expect(missingText).toContain(
      'Replay verdict  suspect; child UNKNOWN; exit unknown; timeout unknown; rootOnly unknown; shellParsing unknown',
    );
    for (const text of [shellParsingText, driftText, timeoutText, nonzeroText, missingText]) {
      expect(text).not.toContain('Replay verdict  trusted');
      expect(text).not.toContain('Next  Replay verified');
      expect(text).toContain(
        'Next  Inspect replay-summary.json and commands.jsonl before trusting this replay result.',
      );
    }
  });

  it('quotes replay inspect actions that need shell escaping', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-replay-action-quote-test');
    const replayRoot = join(workDir, '.omo/evidence', "replay root's path");
    const sourceRoot = join(workDir, '.omo/evidence/source-loop');
    mkdirSync(replayRoot, { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });
    const childLoopSummary = {
      benchmark: 'super-kimi-agent-bench-loop',
      status: 'PASS',
      bestScore: 1,
      iterations: [{ status: 'PASS', score: 1, passRate: 1 }],
    };
    writeFileSync(
      join(replayRoot, 'replay-summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop-replay',
        status: 'PASS',
        childExitCode: 0,
        childTimedOut: false,
        onlyEvidenceRootChanged: true,
        shellParsing: false,
        sourceSummaryPath: join(sourceRoot, 'loop-summary.json'),
        evidenceRoot: replayRoot,
        replayedLoopSummary: childLoopSummary,
      }),
    );

    const text = buildBenchStatusLines(loadBenchStatus(workDir, ".omo/evidence/replay root's path")).join('\n');

    expect(text).toContain(
      "Replay inspect  cat '.omo/evidence/replay root'\\''s path/loop-summary.json'",
    );
    expect(text).toContain(
      "Replay log  cat '.omo/evidence/replay root'\\''s path/commands.jsonl'",
    );
    expect(text).toContain(
      "Replay diff  diff -u .omo/evidence/source-loop/loop-summary.json '.omo/evidence/replay root'\\''s path/loop-summary.json'",
    );
  });

  it('hides replay diff actions when either compare side is missing', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-replay-diff-missing-test');
    const missingSourceRoot = join(workDir, '.omo/evidence/missing-source');
    const missingEvidenceRoot = join(workDir, '.omo/evidence/missing-evidence');
    mkdirSync(missingSourceRoot, { recursive: true });
    mkdirSync(missingEvidenceRoot, { recursive: true });
    const childLoopSummary = {
      benchmark: 'super-kimi-agent-bench-loop',
      status: 'PASS',
      bestScore: 1,
      iterations: [{ status: 'PASS', score: 1, passRate: 1 }],
    };
    writeFileSync(
      join(missingSourceRoot, 'replay-summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop-replay',
        status: 'PASS',
        childExitCode: 0,
        childTimedOut: false,
        onlyEvidenceRootChanged: true,
        shellParsing: false,
        evidenceRoot: missingSourceRoot,
        replayedLoopSummary: childLoopSummary,
      }),
    );
    writeFileSync(
      join(missingEvidenceRoot, 'replay-summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop-replay',
        status: 'PASS',
        childExitCode: 0,
        childTimedOut: false,
        onlyEvidenceRootChanged: true,
        shellParsing: false,
        sourceSummaryPath: join(workDir, '.omo/evidence/source-loop/loop-summary.json'),
        replayedLoopSummary: childLoopSummary,
      }),
    );

    const missingSourceText = buildBenchStatusLines(loadBenchStatus(workDir, '.omo/evidence/missing-source')).join('\n');
    const missingEvidenceText = buildBenchStatusLines(loadBenchStatus(workDir, '.omo/evidence/missing-evidence')).join('\n');

    expect(missingSourceText).not.toContain('Replay diff');
    expect(missingEvidenceText).not.toContain('Replay diff');
  });

  it('keeps clean and malformed loop focus evidence honest', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-loop-focus-edge-test');
    const cleanRoot = join(workDir, '.omo/evidence/clean-loop');
    const malformedRoot = join(workDir, '.omo/evidence/malformed-loop');
    const secretRoot = join(workDir, '.omo/evidence/secret-loop');
    mkdirSync(cleanRoot, { recursive: true });
    mkdirSync(malformedRoot, { recursive: true });
    mkdirSync(secretRoot, { recursive: true });
    writeFileSync(
      join(cleanRoot, 'loop-summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop',
        status: 'PASS',
        bestScore: 1,
        iterations: [
          {
            status: 'PASS',
            score: 1,
            passRate: 1,
            focus: { status: 'clean', taxonomy: [], tasks: [] },
          },
        ],
      }),
    );
    writeFileSync(
      join(malformedRoot, 'loop-summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop',
        status: 'BLOCKED',
        bestScore: 0,
        iterations: [
          {
            status: 'BLOCKED',
            score: 0,
            passRate: 0,
            focus: { status: 'attention', tasks: 'not-array', taxonomy: { environment_blocked: 1 } },
          },
        ],
      }),
    );
    writeFileSync(
      join(secretRoot, 'loop-summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop',
        status: 'BLOCKED',
        bestScore: 0,
        iterations: [
          {
            status: 'BLOCKED',
            score: 0,
            passRate: 0,
            focus: {
              status: 'attention',
              tasks: [
                {
                  id: 'seed.secret-probe.v1',
                  status: 'BLOCKED',
                  reason: 'token sk-proj-1234567890abcdef and api_key=secret-value KIMI_MODEL_API_KEY',
                  action: 'cat sk-proj-1234567890abcdef api_key=secret-value KIMI_MODEL_API_KEY',
                },
              ],
            },
          },
        ],
      }),
    );

    const cleanText = buildBenchStatusLines(loadBenchStatus(workDir, '.omo/evidence/clean-loop')).join('\n');
    const malformedText = buildBenchStatusLines(loadBenchStatus(workDir, '.omo/evidence/malformed-loop')).join('\n');
    const secretText = buildBenchStatusLines(loadBenchStatus(workDir, '.omo/evidence/secret-loop')).join('\n');

    expect(cleanText).not.toContain('Loop focus');
    expect(cleanText).not.toContain('Loop reason');
    expect(cleanText).not.toContain('Loop action');
    expect(cleanText).not.toContain('Loop inspect');
    expect(malformedText).toContain('Loop focus  attention task unknown; top environment_blocked x1');
    expect(malformedText).not.toContain('Loop reason');
    expect(malformedText).not.toContain('Loop action');
    expect(malformedText).not.toContain('Loop inspect');
    expect(secretText).toContain(
      'Loop reason  token [REDACTED_SECRET] and api_key=[REDACTED_SECRET] [REDACTED_ENV]',
    );
    expect(secretText).toContain(
      'Loop action  cat [REDACTED_SECRET] api_key=[REDACTED_SECRET] [REDACTED_ENV]',
    );
    expect(secretText).not.toContain('sk-proj');
    expect(secretText).not.toContain('secret-value');
    expect(secretText).not.toContain('KIMI_MODEL_API_KEY');
  });

  it('falls back to resultPath for older loop focus summaries', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-loop-focus-fallback-test');
    const evidenceRoot = join(workDir, '.omo/evidence/old-loop');
    const resultPath = join(evidenceRoot, 'tasks/seed.legacy.v1/result.json');
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(
      join(evidenceRoot, 'loop-summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench-loop',
        status: 'BLOCKED',
        bestScore: 0,
        iterations: [
          {
            status: 'BLOCKED',
            score: 0,
            passRate: 0,
            focus: {
              status: 'attention',
              tasks: [
                {
                  id: 'seed.legacy.v1',
                  status: 'BLOCKED',
                  resultPath,
                },
              ],
            },
          },
        ],
      }),
    );

    const text = buildBenchStatusLines(loadBenchStatus(workDir, '.omo/evidence/old-loop')).join('\n');

    expect(text).toContain(`Loop inspect  ${resultPath}`);
  });

  it('loads actionable budget violation details from bench summary evidence', () => {
    const workDir = join(process.cwd(), 'node_modules', '.tmp-bench-budget-test');
    const evidenceRoot = join(workDir, '.omo/evidence/budget-fail');
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(
      join(evidenceRoot, 'summary.json'),
      JSON.stringify({
        benchmark: 'super-kimi-agent-bench',
        status: 'FAIL',
        completedAt: '2026-06-29T00:00:00.000Z',
        evidenceRoot,
        taskDir: '/repo/.omo/bench/tasks',
        suite: 'seed',
        runner: 'fixture',
        metrics: { score: 0, passRate: 0 },
        budget: {
          status: 'FAIL',
          exceeded: 1,
          tasks: [
            {
              id: 'seed.budget-overrun.v1',
              violations: ['wallMs 44 > 1', 'commands 2 > 0'],
            },
          ],
        },
      }),
    );

    const status = loadBenchStatus(workDir, '.omo/evidence/budget-fail');
    const text = buildBenchStatusLines(status).join('\n');

    expect(text).toContain('Budget  FAIL; exceeded 1');
    expect(text).toContain('Budget top  seed.budget-overrun.v1');
    expect(text).toContain('Budget detail  wallMs 44 > 1; commands 2 > 0');
    expect(text).toContain(`Budget inspect  ${join(evidenceRoot, 'tasks/seed.budget-overrun.v1/result.json')}`);
    expect(text).toContain(
      `Budget rerun  node scripts/kimi-agent-bench.mjs --task-dir /repo/.omo/bench/tasks --suite seed --runner fixture --evidence-root ${evidenceRoot}`,
    );
    expect(text).not.toContain('Loop trend');
    expect(text).not.toContain('Loop reason');
    expect(text).not.toContain('Loop action');
    expect(text).not.toContain('Loop cost');
    expect(text).not.toContain('Loop guard');
  });

  it('degrades honestly for missing evidence', () => {
    const status = loadBenchStatus('/path/that/does/not/exist', '');

    expect(status.status).toBe('UNAVAILABLE');
    expect(status.warnings.join('\n')).toContain('No bench evidence found');
  });

  it('redacts secret-looking strings defensively', () => {
    expect(
      redactBenchStatusText(
        'token sk-proj-1234567890abcdef and api_key=secret-value KIMI_MODEL_API_KEY',
      ),
    ).toBe('token [REDACTED_SECRET] and api_key=[REDACTED_SECRET] [REDACTED_ENV]');
  });
});
