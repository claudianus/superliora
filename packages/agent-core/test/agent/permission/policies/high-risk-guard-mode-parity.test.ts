/**
 * H4 regression: auto and yolo are prompt-free postures.
 *
 * Before this fix, `YoloHighRiskAskPermissionPolicy` asked on every `yolo`
 * session, so an auto-mode run that spawned a child with
 * `permissionMode: yolo` (`subagent-child-config.ts`) stalled on a dialog it
 * could never answer. The guard is now opt-in via
 * `SUPERLIORA_PERMISSION_HIGH_RISK_GUARD`.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  YoloHighRiskAskPermissionPolicy,
  isHighRiskGuardEnabled,
  isUnattendedMode,
} from '#/agent/permission/policies/yolo-high-risk-ask';
import { PERMISSION_HIGH_RISK_GUARD_ENV } from '#/agent/permission/types';
import type { Agent } from '#/agent';

const DESTRUCTIVE = 'rm -rf /tmp/h4-guard-probe';

function policy(mode: string): YoloHighRiskAskPermissionPolicy {
  return new YoloHighRiskAskPermissionPolicy({
    permission: { mode },
  } as unknown as Agent);
}

function bashContext(command: string) {
  return {
    toolCall: { name: 'Bash', id: 'tc-1' },
    args: { command },
  } as never;
}

function evaluate(mode: string, command: string) {
  return policy(mode).evaluate(bashContext(command));
}

afterEach(() => {
  delete process.env[PERMISSION_HIGH_RISK_GUARD_ENV];
});

describe('H4 — guard default is OFF', () => {
  it('reports disabled when the env flag is unset', () => {
    delete process.env[PERMISSION_HIGH_RISK_GUARD_ENV];
    expect(isHighRiskGuardEnabled()).toBe(false);
  });

  it.each(['1', 'true', 'on', 'yes', 'TRUE', ' On '])(
    'reports enabled for truthy flag %j',
    (value) => {
      process.env[PERMISSION_HIGH_RISK_GUARD_ENV] = value;
      expect(isHighRiskGuardEnabled()).toBe(true);
    },
  );

  it.each(['', '0', 'false', 'no', 'off', 'maybe'])(
    'reports disabled for non-truthy flag %j',
    (value) => {
      process.env[PERMISSION_HIGH_RISK_GUARD_ENV] = value;
      expect(isHighRiskGuardEnabled()).toBe(false);
    },
  );
});

describe('H4 — modes that must never prompt', () => {
  it.each(['auto', 'yolo'])('does not ask in %s mode with the guard off', (mode) => {
    delete process.env[PERMISSION_HIGH_RISK_GUARD_ENV];
    expect(evaluate(mode, DESTRUCTIVE)).toBeUndefined();
  });

  it('treats auto and yolo as one unattended class', () => {
    expect(isUnattendedMode('auto')).toBe(true);
    expect(isUnattendedMode('yolo')).toBe(true);
    expect(isUnattendedMode('manual')).toBe(false);
  });
});

describe('H4 — guard ON in auto and yolo asks', () => {
  it.each(['auto', 'yolo'])('asks on rm -rf in %s mode', (mode) => {
    process.env[PERMISSION_HIGH_RISK_GUARD_ENV] = '1';
    const result = evaluate(mode, DESTRUCTIVE);
    expect(result?.kind).toBe('ask');
    expect(result?.reason).toMatchObject({
      yolo_high_risk: true,
      risk: 'recursive force delete',
    });
  });

  it.each(['auto', 'yolo'])('stays silent for safe commands in %s mode', (mode) => {
    process.env[PERMISSION_HIGH_RISK_GUARD_ENV] = '1';
    expect(evaluate(mode, 'ls -la')).toBeUndefined();
  });
});

describe('H4 — manual mode is unaffected', () => {
  it('never asks even with the guard on (manual already asks elsewhere)', () => {
    process.env[PERMISSION_HIGH_RISK_GUARD_ENV] = '1';
    expect(evaluate('manual', DESTRUCTIVE)).toBeUndefined();
  });
});
