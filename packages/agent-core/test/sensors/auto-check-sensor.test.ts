import { afterEach, describe, expect, it } from 'vitest';

import {
  AUTO_CHECK_ENV,
  AUTO_CHECK_PREFIX,
  AUTO_CHECK_SPAWN_ENV,
  AUTO_CHECK_SPAWN_MAX_PER_SESSION,
  AUTO_CHECK_SPAWN_MIN_INTERVAL_MS,
  AUTO_CHECK_SPAWN_PREFIX,
  appendAutoCheckSpawnBlock,
  createAutoCheckSpawnState,
  decideAutoCheckSpawn,
  formatAutoCheckDirective,
  formatAutoCheckSpawnResult,
  isAutoCheckEnabled,
  isAutoCheckSpawnEnabled,
  recordAutoCheckSpawn,
  resolveAutoCheckPackageDir,
  wasRecentAutoCheckSpawnOk,
  withAutoCheckDirective,
} from '../../src/sensors/auto-check-sensor';
import {
  MUTATION_VERIFY_NUDGE,
  buildPendingMutationSoftTips,
  createMutationVerificationLedger,
  formatMutationVerifyNudge,
  observeFileMutationToolResult,
  recordFileMutation,
} from '../../src/sensors/mutation-verification-sensor';
import { evaluateStopSensor } from '../../src/sensors/stop-sensor';
import { createVerificationSensorLedger } from '../../src/sensors/verification-sensor-ledger';

const PRIOR = process.env[AUTO_CHECK_ENV];

afterEach(() => {
  if (PRIOR === undefined) {
    delete process.env[AUTO_CHECK_ENV];
  } else {
    process.env[AUTO_CHECK_ENV] = PRIOR;
  }
});

describe('auto-check-sensor', () => {
  it('is off by default and on for SUPERLIORA_AUTO_CHECK=1', () => {
    delete process.env[AUTO_CHECK_ENV];
    expect(isAutoCheckEnabled({})).toBe(false);
    expect(isAutoCheckEnabled({ [AUTO_CHECK_ENV]: '1' })).toBe(true);
    expect(isAutoCheckEnabled({ auto_check: 'true' })).toBe(true);
  });

  it('formats package-scoped and unscoped directives', () => {
    expect(formatAutoCheckDirective({ packageDir: 'packages/agent-core' })).toContain(
      'packageDir=packages/agent-core',
    );
    expect(formatAutoCheckDirective({ packageDir: 'packages/agent-core' })).toContain(
      AUTO_CHECK_PREFIX,
    );
    expect(formatAutoCheckDirective({})).toContain('checks=["test","typecheck"]');
  });

  it('withAutoCheckDirective is a no-op when disabled', () => {
    expect(withAutoCheckDirective(MUTATION_VERIFY_NUDGE, 'packages/agent-core', {})).toBe(
      MUTATION_VERIFY_NUDGE,
    );
  });

  it('withAutoCheckDirective appends directive when enabled', () => {
    const out = withAutoCheckDirective(MUTATION_VERIFY_NUDGE, 'packages/agent-core', {
      [AUTO_CHECK_ENV]: '1',
    });
    expect(out).toContain(MUTATION_VERIFY_NUDGE);
    expect(out).toContain(AUTO_CHECK_PREFIX);
    expect(out).toContain('packageDir=packages/agent-core');
  });

  it('resolveAutoCheckPackageDir requires unanimous scope', () => {
    expect(resolveAutoCheckPackageDir(['packages/agent-core', 'packages/agent-core'])).toBe(
      'packages/agent-core',
    );
    expect(resolveAutoCheckPackageDir(['packages/agent-core', 'apps/liora'])).toBeUndefined();
    expect(resolveAutoCheckPackageDir([undefined, undefined])).toBeUndefined();
  });

  it('PostToolUse nudge gains AUTO_CHECK line when env is on', () => {
    process.env[AUTO_CHECK_ENV] = '1';
    const text = formatMutationVerifyNudge('packages/agent-core');
    expect(text).toContain(AUTO_CHECK_PREFIX);
    expect(text).toContain('packageDir=packages/agent-core');

    const ledger = createMutationVerificationLedger();
    const result = observeFileMutationToolResult(
      ledger,
      'Edit',
      { output: 'ok' },
      { path: 'packages/agent-core/src/foo.ts' },
    );
    expect(typeof result.output === 'string' ? result.output : '').toContain(AUTO_CHECK_PREFIX);
  });

  it('Goal soft tips include AUTO_CHECK when env is on', () => {
    process.env[AUTO_CHECK_ENV] = '1';
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    const ledger = createMutationVerificationLedger();
    recordFileMutation(ledger, 'Edit', now - 1_000, 'packages/agent-core');
    const tips = buildPendingMutationSoftTips(ledger, now);
    expect(tips.join('\n')).toContain(AUTO_CHECK_PREFIX);
  });

  it('Stop sensor appends AUTO_CHECK directive when env is on', () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    const mutationLedger = createMutationVerificationLedger();
    recordFileMutation(mutationLedger, 'Write', now - 50, 'packages/agent-core');
    const body = evaluateStopSensor({
      mutationLedger,
      verificationLedger: createVerificationSensorLedger(),
      nowMs: now,
      env: { [AUTO_CHECK_ENV]: '1' },
    });
    expect(body).not.toBeNull();
    expect(body).toContain(AUTO_CHECK_PREFIX);
    expect(body).toContain('packageDir=packages/agent-core');
  });

  it('Stop sensor stays generic when auto-check is off', () => {
    const now = Date.UTC(2026, 6, 31, 12, 0, 0);
    const mutationLedger = createMutationVerificationLedger();
    recordFileMutation(mutationLedger, 'Write', now - 50, 'packages/agent-core');
    const body = evaluateStopSensor({
      mutationLedger,
      verificationLedger: createVerificationSensorLedger(),
      nowMs: now,
      env: {},
    });
    expect(body).not.toBeNull();
    expect(body).not.toContain(AUTO_CHECK_PREFIX);
  });
});

describe('auto-check-spawn (Loop19a)', () => {
  const SPAWN_PRIOR = process.env[AUTO_CHECK_SPAWN_ENV];

  afterEach(() => {
    if (SPAWN_PRIOR === undefined) {
      delete process.env[AUTO_CHECK_SPAWN_ENV];
    } else {
      process.env[AUTO_CHECK_SPAWN_ENV] = SPAWN_PRIOR;
    }
  });

  it('is off by default and on for SUPERLIORA_AUTO_CHECK_SPAWN=1', () => {
    expect(isAutoCheckSpawnEnabled({})).toBe(false);
    expect(isAutoCheckSpawnEnabled({ [AUTO_CHECK_SPAWN_ENV]: '1' })).toBe(true);
  });

  it('decideAutoCheckSpawn requires env + packageDir + rate limits', () => {
    const state = createAutoCheckSpawnState();
    expect(
      decideAutoCheckSpawn({
        state,
        packageDir: 'packages/agent-core',
        env: {},
      }),
    ).toEqual({ spawn: false, reason: `${AUTO_CHECK_SPAWN_ENV} off` });

    expect(
      decideAutoCheckSpawn({
        state,
        packageDir: undefined,
        env: { [AUTO_CHECK_SPAWN_ENV]: '1' },
      }).spawn,
    ).toBe(false);

    const allow = decideAutoCheckSpawn({
      state,
      packageDir: 'packages/agent-core',
      env: { [AUTO_CHECK_SPAWN_ENV]: '1' },
      nowMs: 1_000,
    });
    expect(allow).toEqual({
      spawn: true,
      packageDir: 'packages/agent-core',
      checks: ['test', 'typecheck'],
    });

    recordAutoCheckSpawn(state, 1_000);
    const cooled = decideAutoCheckSpawn({
      state,
      packageDir: 'packages/agent-core',
      env: { [AUTO_CHECK_SPAWN_ENV]: '1' },
      nowMs: 1_000 + AUTO_CHECK_SPAWN_MIN_INTERVAL_MS - 1,
    });
    expect(cooled.spawn).toBe(false);

    const afterCooldown = decideAutoCheckSpawn({
      state,
      packageDir: 'packages/agent-core',
      env: { [AUTO_CHECK_SPAWN_ENV]: '1' },
      nowMs: 1_000 + AUTO_CHECK_SPAWN_MIN_INTERVAL_MS,
    });
    expect(afterCooldown.spawn).toBe(true);
  });

  it('decideAutoCheckSpawn respects session cap', () => {
    const state = createAutoCheckSpawnState();
    state.spawnCount = AUTO_CHECK_SPAWN_MAX_PER_SESSION;
    const decision = decideAutoCheckSpawn({
      state,
      packageDir: 'packages/agent-core',
      env: { [AUTO_CHECK_SPAWN_ENV]: '1' },
      nowMs: Date.now(),
    });
    expect(decision.spawn).toBe(false);
    if (!decision.spawn) {
      expect(decision.reason).toContain('session cap');
    }
  });

  it('formatAutoCheckSpawnResult and append are idempotent on prefix', () => {
    const block = formatAutoCheckSpawnResult({
      packageDir: 'packages/agent-core',
      checks: ['test'],
      isError: false,
      outputText: 'exitCode: 0',
    });
    expect(block).toContain(AUTO_CHECK_SPAWN_PREFIX);
    expect(block).toContain('OK');
    expect(block).toContain('packageDir=packages/agent-core');
    const once = appendAutoCheckSpawnBlock('nudge', block);
    const twice = appendAutoCheckSpawnBlock(once, block);
    expect(twice.split(AUTO_CHECK_SPAWN_PREFIX).length - 1).toBe(1);
  });

  it('wasRecentAutoCheckSpawnOk tracks green spawn window (Loop20b)', () => {
    const state = createAutoCheckSpawnState();
    expect(wasRecentAutoCheckSpawnOk(state, 10_000)).toBe(false);
    recordAutoCheckSpawn(state, 10_000, { ok: true });
    expect(wasRecentAutoCheckSpawnOk(state, 10_000)).toBe(true);
    expect(
      wasRecentAutoCheckSpawnOk(state, 10_000 + AUTO_CHECK_SPAWN_MIN_INTERVAL_MS),
    ).toBe(true);
    expect(
      wasRecentAutoCheckSpawnOk(state, 10_000 + AUTO_CHECK_SPAWN_MIN_INTERVAL_MS + 1),
    ).toBe(false);
    recordAutoCheckSpawn(state, 20_000, { ok: false });
    expect(wasRecentAutoCheckSpawnOk(state, 20_000)).toBe(false);
  });
});
