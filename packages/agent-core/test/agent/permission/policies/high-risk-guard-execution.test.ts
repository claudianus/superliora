/**
 * H4 execution evidence: the guard decides whether a real destructive command
 * runs. Unlike the pure parity test, this actually performs
 * `mkdir -p <tmp> && rm -rf <tmp>` and asserts on the filesystem result.
 *
 * - guard OFF (default): no `ask` → command executes → directory is gone.
 * - guard ON: `ask` → the harness would block → command is not executed →
 *   directory survives.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { YoloHighRiskAskPermissionPolicy } from '#/agent/permission/policies/yolo-high-risk-ask';
import { PERMISSION_HIGH_RISK_GUARD_ENV } from '#/agent/permission/types';
import type { Agent } from '#/agent';

function decide(mode: string, command: string) {
  const policy = new YoloHighRiskAskPermissionPolicy({
    permission: { mode },
  } as unknown as Agent);
  return policy.evaluate({
    toolCall: { name: 'Bash', id: 'tc-1' },
    args: { command },
  } as never);
}

/** Build an isolated probe dir with a sentinel file inside. */
function makeProbe(): { readonly dir: string; readonly file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'h4-guard-probe-'));
  const file = join(dir, 'sentinel.txt');
  mkdirSync(join(dir, 'nested'), { recursive: true });
  execFileSync('/bin/bash', ['-c', `printf 'x' > ${JSON.stringify(file)}`]);
  return { dir, file };
}

function runRmRf(dir: string): void {
  execFileSync('/bin/bash', ['-c', `rm -rf ${JSON.stringify(dir)}`]);
}

afterEach(() => {
  delete process.env[PERMISSION_HIGH_RISK_GUARD_ENV];
});

describe('H4 evidence — auto mode, guard OFF (default)', () => {
  it('lets `rm -rf` complete with no confirmation dialog', () => {
    delete process.env[PERMISSION_HIGH_RISK_GUARD_ENV];
    const probe = makeProbe();
    const command = `rm -rf ${probe.dir}`;

    // Permission layer: no `ask` means the harness never raises a prompt.
    const decision = decide('auto', command);
    expect(decision).toBeUndefined();

    // Behavior layer: the destructive command actually ran to completion.
    runRmRf(probe.dir);
    expect(existsSync(probe.file)).toBe(false);
    expect(existsSync(probe.dir)).toBe(false);
  });

  it('lets a bulk delete under yolo complete too (mode parity)', () => {
    delete process.env[PERMISSION_HIGH_RISK_GUARD_ENV];
    const probe = makeProbe();
    expect(decide('yolo', `rm -rf ${probe.dir}`)).toBeUndefined();
    runRmRf(probe.dir);
    expect(existsSync(probe.dir)).toBe(false);
  });
});

describe('H4 evidence — guard ON blocks the same command', () => {
  it('raises ask in auto mode, so the delete never runs', () => {
    process.env[PERMISSION_HIGH_RISK_GUARD_ENV] = '1';
    const probe = makeProbe();
    const command = `rm -rf ${probe.dir}`;

    const decision = decide('auto', command);
    expect(decision?.kind).toBe('ask');

    // A blocked tool call is never executed — the directory is still intact.
    expect(existsSync(probe.file)).toBe(true);
    expect(existsSync(probe.dir)).toBe(true);

    rmSync(probe.dir, { recursive: true, force: true });
  });

  it('raises ask in yolo mode with the same risk label', () => {
    process.env[PERMISSION_HIGH_RISK_GUARD_ENV] = '1';
    const probe = makeProbe();
    const decision = decide('yolo', `rm -rf ${probe.dir}`);
    expect(decision?.kind).toBe('ask');
    expect(decision?.reason?.['risk']).toBe('recursive force delete');
    rmSync(probe.dir, { recursive: true, force: true });
  });
});
