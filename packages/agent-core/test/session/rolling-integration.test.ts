import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { Kaos } from '@superliora/kaos';

import { checkPackageTypecheck } from '../../src/session/contract-check';
import {
  clearRollingIntegration,
  getRollingIntegration,
  maybeRunRollingCheck,
  recordChildCompletion,
  takeRollingIntegrationWarning,
} from '../../src/session/rolling-integration';

interface FakeProcOptions {
  readonly exitCode: number;
  readonly stderr?: string;
}

function fakeProc(options: FakeProcOptions) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  return {
    stdin: { end: (): void => {} },
    stdout,
    stderr,
    pid: 4242,
    exitCode: null as number | null,
    wait: async (): Promise<number> => {
      if (options.stderr !== undefined && options.stderr.length > 0) {
        stderr.write(options.stderr);
      }
      stdout.end();
      stderr.end();
      return options.exitCode;
    },
    kill: async (): Promise<void> => {},
  };
}

function fakeKaos(exitCode: number, stderr?: string): {
  kaos: Kaos;
  calls: ReadonlyArray<readonly string[]>;
} {
  const calls: string[][] = [];
  const kaos = {
    exec: async (command: string, ...args: string[]) => {
      calls.push([command, ...args]);
      return fakeProc({ exitCode, stderr });
    },
  } as unknown as Kaos;
  return { kaos, calls };
}

// This package always owns a package.json, so the rolling check resolves
// a real package directory while exec stays faked.
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

let runSeq = 0;
function nextRunId(): string {
  runSeq += 1;
  return `rolling-test-run-${String(runSeq)}`;
}

describe('rolling integration check (T3-3d)', () => {
  it('skips the check when no completion changed files', () => {
    const runId = nextRunId();
    const { kaos, calls } = fakeKaos(0);
    recordChildCompletion(runId, []);
    expect(maybeRunRollingCheck(runId, kaos, PACKAGE_DIR)).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(getRollingIntegration(runId)?.completedCount).toBe(1);
    clearRollingIntegration(runId);
  });

  it('typechecks the parent package after a changing completion', async () => {
    const runId = nextRunId();
    const { kaos, calls } = fakeKaos(0);
    recordChildCompletion(runId, ['src/a.ts']);
    const state = await maybeRunRollingCheck(runId, kaos, PACKAGE_DIR);
    expect(state?.lastStatus).toBe('passed');
    expect(state?.checkCount).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('tsc');
    // No new changes since the check: the next call is a no-op.
    expect(maybeRunRollingCheck(runId, kaos, PACKAGE_DIR)).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(takeRollingIntegrationWarning(runId)).toBeUndefined();
    expect(getRollingIntegration(runId)).toBeUndefined();
  });

  it('flags a failed parent typecheck and clears state on take', async () => {
    const runId = nextRunId();
    const { kaos } = fakeKaos(2, 'src/x.ts(3,1): error TS2322: boom');
    recordChildCompletion(runId, ['src/x.ts']);
    const state = await maybeRunRollingCheck(runId, kaos, PACKAGE_DIR);
    expect(state?.lastStatus).toBe('failed');
    const warning = takeRollingIntegrationWarning(runId);
    expect(warning).toContain('rolling_integration: WARNING');
    expect(warning).toContain('compile-failed');
    expect(warning).toContain('TS2322');
    expect(getRollingIntegration(runId)).toBeUndefined();
  });

  it('shares one in-flight check between concurrent completions', async () => {
    const runId = nextRunId();
    const { kaos, calls } = fakeKaos(0);
    recordChildCompletion(runId, ['src/a.ts']);
    const first = maybeRunRollingCheck(runId, kaos, PACKAGE_DIR);
    const second = maybeRunRollingCheck(runId, kaos, PACKAGE_DIR);
    expect(first).toBe(second);
    await first;
    expect(calls).toHaveLength(1);
    clearRollingIntegration(runId);
  });

  it('passes without exec when no package owns the base dir', async () => {
    const isolated = mkdtempSync(join(tmpdir(), 'rolling-no-pkg-'));
    const { kaos, calls } = fakeKaos(0);
    const outcome = await checkPackageTypecheck(kaos, isolated);
    expect(outcome).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });
});
