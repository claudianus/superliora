import { describe, expect, it } from 'vitest';

import {
  SWARM_RUN_LEDGER_DIR,
  buildSwarmRunLedgerFromResults,
  createSwarmRunLedger,
  expertsFromSwarmResults,
  finalizeSwarmRunLedger,
  isWastedWorker,
  serializeSwarmRunLedger,
  swarmRunLedgerAbsolutePath,
  swarmRunLedgerRelativePath,
  type SwarmRunLedgerExpert,
  type SwarmRunLedgerResultLike,
} from '#/fleet';

function makeResult(over: Partial<SwarmRunLedgerResultLike> & { expertId: string }): SwarmRunLedgerResultLike {
  return {
    status: 'completed',
    verdict: 'PASS',
    spec: { expertId: over.expertId, expertName: over.spec?.expertName, phase: over.spec?.phase },
    ...over,
  };
}

describe('swarm-run-ledger.ts — isWastedWorker', () => {
  it('flags failed/aborted status and FAIL/ABORTED verdict', () => {
    expect(isWastedWorker('failed', 'PASS', ['e-1'])).toBe(true);
    expect(isWastedWorker('aborted', undefined, [])).toBe(true);
    expect(isWastedWorker('completed', 'FAIL', ['e-1'])).toBe(true);
    expect(isWastedWorker('completed', 'ABORTED', [])).toBe(true);
  });

  it('flags completed-no-evidence with SKIPPED or undefined verdict', () => {
    expect(isWastedWorker('completed', 'SKIPPED', [])).toBe(true);
    expect(isWastedWorker('completed', undefined, [])).toBe(true);
  });

  it('does not flag a completed worker that produced evidence', () => {
    expect(isWastedWorker('completed', 'PASS', ['e-1'])).toBe(false);
  });

  it('does not flag a completed worker that produced a non-empty evidence list with verdict REVISE', () => {
    expect(isWastedWorker('completed', 'REVISE', ['e-1'])).toBe(false);
  });
});

describe('swarm-run-ledger.ts — createSwarmRunLedger / finalizeSwarmRunLedger', () => {
  it('derives phases, evidenceIds, and wasted flags from experts when not provided', () => {
    const experts: SwarmRunLedgerExpert[] = [
      { expertId: 'a', phase: 'plan', evidenceIds: ['e-1'] },
      { expertId: 'b', phase: 'implement', evidenceIds: ['e-2'], wasted: true },
      { expertId: 'c', phase: 'review' },
    ];
    const ledger = createSwarmRunLedger({ runId: 'r1', experts });
    expect(ledger.phases).toEqual(['plan', 'implement', 'review']);
    expect(ledger.evidenceIds).toEqual(['e-1', 'e-2']);
    expect(ledger.wastedWorkerFlags).toEqual(['b']);
    expect(ledger.finishedAt).toBeUndefined();
  });

  it('honors explicit overrides for phases / evidenceIds / wastedWorkerFlags', () => {
    const ledger = createSwarmRunLedger({
      runId: 'r1',
      experts: [{ expertId: 'a', phase: 'plan', evidenceIds: ['e-1'], wasted: true }],
      phases: ['override'],
      evidenceIds: ['override-evidence'],
      wastedWorkerFlags: ['override-wasted'],
    });
    expect(ledger.phases).toEqual(['override']);
    expect(ledger.evidenceIds).toEqual(['override-evidence']);
    expect(ledger.wastedWorkerFlags).toEqual(['override-wasted']);
  });

  it('finalizeSwarmRunLedger defaults finishedAt and merges patch overrides', () => {
    const base = createSwarmRunLedger({ runId: 'r1' });
    const finalized = finalizeSwarmRunLedger(base, {
      experts: [{ expertId: 'a', phase: 'plan', evidenceIds: ['e-1'] }],
      phases: ['plan'],
      evidenceIds: ['e-1'],
      tokens: { input: 10, output: 5, total: 15 },
      finishedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(finalized.finishedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(finalized.phases).toEqual(['plan']);
    expect(finalized.evidenceIds).toEqual(['e-1']);
    expect(finalized.tokens).toEqual({ input: 10, output: 5, total: 15 });
  });

  it('finalizeSwarmRunLedger auto-populates finishedAt when omitted', () => {
    const base = createSwarmRunLedger({ runId: 'r1' });
    const finalized = finalizeSwarmRunLedger(base, {});
    expect(finalized.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('swarm-run-ledger.ts — expertsFromSwarmResults / buildSwarmRunLedgerFromResults', () => {
  it('expertsFromSwarmResults projects results and flags wasted workers', () => {
    const rows = expertsFromSwarmResults([
      makeResult({ expertId: 'a', evidenceIds: ['e-1'] }),
      makeResult({ expertId: 'b', status: 'failed', verdict: 'FAIL' }),
      makeResult({ expertId: 'c', status: 'completed', verdict: 'SKIPPED' }),
    ]);
    expect(rows[0]?.wasted).toBe(false);
    expect(rows[1]?.wasted).toBe(true);
    expect(rows[2]?.wasted).toBe(true);
  });

  it('buildSwarmRunLedgerFromResults folds results + tokens + conflicts + finishedAt', () => {
    const ledger = buildSwarmRunLedgerFromResults({
      runId: 'r1',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      tokens: { input: 1, output: 2, total: 3 },
      conflicts: [{ kind: 'overlap', path: 'src/a.ts' }],
      results: [
        makeResult({ expertId: 'a', evidenceIds: ['e-1'] }),
        makeResult({ expertId: 'b', status: 'failed', verdict: 'FAIL' }),
      ],
    });
    expect(ledger.runId).toBe('r1');
    expect(ledger.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(ledger.finishedAt).toBe('2026-01-01T00:01:00.000Z');
    expect(ledger.tokens).toEqual({ input: 1, output: 2, total: 3 });
    expect(ledger.conflicts).toEqual([{ kind: 'overlap', path: 'src/a.ts' }]);
    expect(ledger.wastedWorkerFlags).toEqual(['b']);
  });
});

describe('swarm-run-ledger.ts — path / serialization helpers', () => {
  it('swarmRunLedgerRelativePath sanitizes unsafe characters and pins the dir constant', () => {
    expect(SWARM_RUN_LEDGER_DIR).toBe('.superliora/swarm-ledgers');
    expect(swarmRunLedgerRelativePath('run/with spaces!@#')).toBe(
      `${SWARM_RUN_LEDGER_DIR}/run_with_spaces_.json`,
    );
  });

  it('swarmRunLedgerAbsolutePath joins workDir + relative path', () => {
    expect(swarmRunLedgerAbsolutePath('/tmp/work', 'r1')).toBe(
      `/tmp/work/${SWARM_RUN_LEDGER_DIR}/r1.json`,
    );
  });

  it('serializeSwarmRunLedger emits pretty JSON with a trailing newline', () => {
    const ledger = createSwarmRunLedger({ runId: 'r1' });
    const out = serializeSwarmRunLedger(ledger);
    expect(out.endsWith('\n')).toBe(true);
    expect(JSON.parse(out).runId).toBe('r1');
  });
});
