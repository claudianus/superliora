import { describe, expect, it } from 'vitest';

import {
  buildTestFailureSoftTips,
  createVerificationSensorLedger,
  filterRecentVerificationFailures,
  formatGoalSoftAdvisoryOpsLine,
  goalSoftAdvisoryFromLedger,
  isCheckLikeBashCommand,
  isTuiVisualSmokeCommand,
  observeVerificationToolResult,
  recordVerificationFailure,
  recordVerificationPass,
  VERIFICATION_SENSOR_GOAL_DONE_TIP,
  VERIFICATION_SENSOR_RECENCY_MS,
} from '../../src/sensors/verification-sensor-ledger';

describe('verification-sensor-ledger', () => {
  it('detects check-like bash commands including typecheck/lint/tsc', () => {
    expect(isCheckLikeBashCommand('pnpm test apps/liora')).toBe(true);
    expect(isCheckLikeBashCommand('pnpm run typecheck')).toBe(true);
    expect(isCheckLikeBashCommand('pnpm -C packages/agent-core run lint')).toBe(true);
    expect(isCheckLikeBashCommand('pnpm -C packages/agent-core exec vitest run foo')).toBe(true);
    expect(isCheckLikeBashCommand('tsc -p packages/agent-core')).toBe(true);
    expect(isCheckLikeBashCommand('eslint src/')).toBe(true);
    expect(isCheckLikeBashCommand('turbo run build')).toBe(true);
    expect(isCheckLikeBashCommand('bun test')).toBe(true);
    expect(isCheckLikeBashCommand('git status')).toBe(false);
    expect(isCheckLikeBashCommand('pnpm install')).toBe(false);
  });

  it('stamps visual=passed on green TUI smoke:visual Bash', () => {
    expect(isTuiVisualSmokeCommand('pnpm -C apps/liora run smoke:visual')).toBe(true);
    const ledger = createVerificationSensorLedger();
    observeVerificationToolResult(
      ledger,
      'Bash',
      { command: 'pnpm -C apps/liora run smoke:visual' },
      { output: 'ok' },
    );
    expect(ledger.visualVerdict).toBe('passed');
    expect(ledger.failures).toHaveLength(0);
  });

  it('clears failure ledger on green check-like Bash', () => {
    const ledger = createVerificationSensorLedger();
    observeVerificationToolResult(
      ledger,
      'Bash',
      { command: 'pnpm test' },
      { isError: true, output: 'FAIL' },
    );
    expect(ledger.failures).toHaveLength(1);
    observeVerificationToolResult(
      ledger,
      'Bash',
      { command: 'pnpm run typecheck' },
      { output: 'ok' },
    );
    expect(ledger.failures).toHaveLength(0);
    expect(ledger.lastPassAtMs).toBeTypeOf('number');
  });

  it('records RunProjectChecks failure and clears on pass', () => {
    const ledger = createVerificationSensorLedger();
    observeVerificationToolResult(
      ledger,
      'RunProjectChecks',
      {},
      {
        isError: true,
        output: JSON.stringify({
          exitCode: 1,
          checks: [{ name: 'test', exitCode: 1, durationMs: 10 }],
          summary: 'Project checks failed (1 check(s), 0 passed, 1 failed): test.',
        }),
      },
    );
    expect(ledger.failures).toHaveLength(1);
    expect(ledger.failures[0]?.toolName).toBe('RunProjectChecks');

    observeVerificationToolResult(ledger, 'RunProjectChecks', {}, { output: '{"exitCode":0}' });
    expect(ledger.failures).toHaveLength(0);
    expect(ledger.lastPassAtMs).toBeTypeOf('number');
  });

  it('records only check-like Bash failures', () => {
    const ledger = createVerificationSensorLedger();
    observeVerificationToolResult(
      ledger,
      'Bash',
      { command: 'vitest run foo.test.ts' },
      { isError: true, output: 'AssertionError' },
    );
    expect(ledger.failures).toHaveLength(1);

    const noop = createVerificationSensorLedger();
    observeVerificationToolResult(
      noop,
      'Bash',
      { command: 'git status' },
      { isError: true, output: 'fatal' },
    );
    expect(noop.failures).toHaveLength(0);
  });

  it('ignores stale failures outside recency window', () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    const ledger = createVerificationSensorLedger();
    recordVerificationFailure(ledger, {
      toolName: 'RunProjectChecks',
      summary: 'tests red',
      recordedAtMs: now - VERIFICATION_SENSOR_RECENCY_MS - 1,
    });
    expect(filterRecentVerificationFailures(ledger.failures, now)).toHaveLength(0);
    expect(buildTestFailureSoftTips(ledger.failures, now)).toHaveLength(0);
  });

  it('builds soft tips for recent failures', () => {
    const ledger = createVerificationSensorLedger();
    recordVerificationPass(ledger);
    recordVerificationFailure(ledger, {
      toolName: 'RunProjectChecks',
      summary: 'Project checks failed: test.',
    });
    const tips = buildTestFailureSoftTips(ledger.failures);
    expect(tips.join('\n')).toContain('recent test/command failure evidence');
    expect(tips.join('\n')).toContain('RunProjectChecks');
    expect(tips.join('\n')).toContain('swarm-evidence-gate');
  });

  it('formats compact Ops Goal soft advisory line from recent failures', () => {
    const ledger = createVerificationSensorLedger();
    recordVerificationFailure(ledger, {
      toolName: 'RunProjectChecks',
      summary: 'Project checks failed: test.',
    });
    expect(formatGoalSoftAdvisoryOpsLine(ledger.failures)).toBe(
      'Soft sensor: RunProjectChecks failed — Project checks failed: test.',
    );
    expect(goalSoftAdvisoryFromLedger(ledger)).toBe(
      'Soft sensor: RunProjectChecks failed — Project checks failed: test.',
    );
  });

  it('falls back to W6 soft tip when no recent failures', () => {
    expect(formatGoalSoftAdvisoryOpsLine([])).toBe(VERIFICATION_SENSOR_GOAL_DONE_TIP);
    expect(goalSoftAdvisoryFromLedger(createVerificationSensorLedger())).toBeNull();
  });
});
