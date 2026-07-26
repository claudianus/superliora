import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearStaffingOutcomes,
  getOutcome,
  hydrateStaffingOutcomesFromDisk,
  persistStaffingOutcomesToDisk,
  recordOutcome,
  recordOutcomesFromSwarmResults,
  resetStaffingOutcomesForTests,
  resolveStaffingOutcomesPath,
  scoreBoost,
  setStaffingOutcomesPersistPathForTests,
} from '../../src/expert-agents/staffing-outcome';

let tempDir: string | undefined;

afterEach(() => {
  resetStaffingOutcomesForTests();
  setStaffingOutcomesPersistPathForTests(null);
  clearStaffingOutcomes();
  if (tempDir !== undefined) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    tempDir = undefined;
  }
});

function useTempPersistFile(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'staffing-outcomes-'));
  const path = join(tempDir, 'staffing-outcomes.json');
  setStaffingOutcomesPersistPathForTests(path);
  clearStaffingOutcomes();
  return path;
}

describe('staffing-outcome', () => {
  it('defaults scoreBoost to 1.0 with no history', () => {
    setStaffingOutcomesPersistPathForTests(null);
    expect(scoreBoost('unknown-expert')).toBe(1);
  });

  it('records accepted outcomes and boosts score', () => {
    setStaffingOutcomesPersistPathForTests(null);
    recordOutcome('exp-a', { accepted: true });
    recordOutcome('exp-a', { accepted: true });
    const record = getOutcome('exp-a');
    expect(record).toMatchObject({ accepted: 2, rejected: 0, samples: 2 });
    expect(scoreBoost('exp-a')).toBeGreaterThan(1);
  });

  it('penalizes rejections and conflicts', () => {
    setStaffingOutcomesPersistPathForTests(null);
    recordOutcome('exp-b', { accepted: false, conflict: true });
    recordOutcome('exp-b', { accepted: false, conflict: true });
    expect(scoreBoost('exp-b')).toBeLessThan(1);
    expect(getOutcome('exp-b')?.conflicts).toBe(2);
  });

  it('applies a soft wastedTokens penalty', () => {
    setStaffingOutcomesPersistPathForTests(null);
    recordOutcome('exp-c', { accepted: true, wastedTokens: 50_000 });
    const withWaste = scoreBoost('exp-c');
    clearStaffingOutcomes();
    setStaffingOutcomesPersistPathForTests(null);
    recordOutcome('exp-c', { accepted: true, wastedTokens: 0 });
    const clean = scoreBoost('exp-c');
    expect(withWaste).toBeLessThan(clean);
  });

  it('rejects empty expertId', () => {
    setStaffingOutcomesPersistPathForTests(null);
    expect(() => recordOutcome('  ', { accepted: true })).toThrow(/non-empty/);
  });

  it('recordOutcomesFromSwarmResults maps verdicts into priors', () => {
    setStaffingOutcomesPersistPathForTests(null);
    recordOutcomesFromSwarmResults([
      { expertId: 'e-pass', verdict: 'PASS' },
      { expertId: 'e-fail', verdict: 'FAIL', status: 'completed' },
      { expertId: 'e-abort', verdict: 'ABORTED', status: 'aborted' },
    ]);
    expect(getOutcome('e-pass')).toMatchObject({ accepted: 1, rejected: 0 });
    expect(getOutcome('e-fail')).toMatchObject({ accepted: 0, rejected: 1, conflicts: 1 });
    expect(getOutcome('e-abort')?.samples).toBe(1);
    expect(scoreBoost('e-pass')).toBeGreaterThan(scoreBoost('e-fail'));
  });

  it('persists outcomes to disk and rehydrates after memory clear', () => {
    const path = useTempPersistFile();
    recordOutcome('exp-persist', { accepted: true });
    recordOutcome('exp-persist', { accepted: true });
    expect(persistStaffingOutcomesToDisk()).toBe(true);

    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as { schema: number; records: unknown[] };
    expect(parsed.schema).toBe(1);
    expect(parsed.records.length).toBe(1);

    // Simulate process restart: wipe memory, keep file. Next read hydrates.
    clearStaffingOutcomes();
    expect(hydrateStaffingOutcomesFromDisk()).toBe(true);
    expect(getOutcome('exp-persist')).toMatchObject({ accepted: 2, samples: 2 });
    expect(scoreBoost('exp-persist')).toBeGreaterThan(1);
    expect(resolveStaffingOutcomesPath()).toBe(path);
  });

  it('scoreBoost hydrates automatically after simulated restart', () => {
    useTempPersistFile();
    recordOutcome('exp-auto', { accepted: false, conflict: true });
    clearStaffingOutcomes();
    // scoreBoost should load disk without explicit hydrate call
    expect(scoreBoost('exp-auto')).toBeLessThan(1);
  });
});
