import { describe, expect, it } from 'vitest';

import {
  buildSwarmRunLedgerFromResults,
  createSwarmRunLedger,
  expertsFromSwarmResults,
  finalizeSwarmRunLedger,
  isWastedWorker,
  serializeSwarmRunLedger,
  swarmRunLedgerRelativePath,
} from '../../src/session/swarm-run-ledger';

describe('swarm-run-ledger', () => {
  it('creates a ledger with defaults and finalizes finishedAt', () => {
    const started = createSwarmRunLedger({
      runId: 'run-1',
      startedAt: '2026-07-25T00:00:00.000Z',
      experts: [{ expertId: 'a', phase: 'implement', status: 'completed', evidenceIds: ['e1'] }],
    });

    expect(started.runId).toBe('run-1');
    expect(started.finishedAt).toBeUndefined();
    expect(started.phases).toEqual(['implement']);
    expect(started.evidenceIds).toEqual(['e1']);
    expect(started.conflicts).toEqual([]);

    const finished = finalizeSwarmRunLedger(started, {
      finishedAt: '2026-07-25T00:01:00.000Z',
      tokens: { total: 42 },
    });
    expect(finished.finishedAt).toBe('2026-07-25T00:01:00.000Z');
    expect(finished.tokens).toEqual({ total: 42 });
    expect(finished.startedAt).toBe(started.startedAt);
  });

  it('marks failed and empty-evidence SKIPPED workers as wasted', () => {
    expect(isWastedWorker('failed', 'FAIL', [])).toBe(true);
    expect(isWastedWorker('aborted', 'ABORTED', ['x'])).toBe(true);
    expect(isWastedWorker('completed', 'SKIPPED', [])).toBe(true);
    expect(isWastedWorker('completed', 'PASS', ['e1'])).toBe(false);
    expect(isWastedWorker('completed', 'PASS', [])).toBe(false);
  });

  it('builds experts and aggregate ledger from swarm results', () => {
    const results = [
      {
        status: 'completed',
        verdict: 'PASS',
        agentId: 'agent-a',
        evidenceIds: ['ev-1'],
        spec: { expertId: 'impl-1', expertName: 'Impl', phase: 'implement' },
      },
      {
        status: 'failed',
        verdict: 'FAIL',
        evidenceIds: [],
        spec: { expertId: 'review-1', expertName: 'Review', phase: 'review' },
      },
      {
        status: 'completed',
        verdict: 'SKIPPED',
        evidenceIds: [],
        spec: { expertId: 'plan-1', expertName: 'Plan', phase: 'plan' },
      },
    ] as const;

    const experts = expertsFromSwarmResults(results);
    expect(experts.map((e) => e.wasted)).toEqual([false, true, true]);

    const ledger = buildSwarmRunLedgerFromResults({
      runId: 'run-2',
      startedAt: '2026-07-25T10:00:00.000Z',
      finishedAt: '2026-07-25T10:05:00.000Z',
      results,
      conflicts: [{ kind: 'file_lease', path: '/tmp/a.ts', holderId: 'impl-1' }],
    });

    expect(ledger.phases).toEqual(['implement', 'review', 'plan']);
    expect(ledger.evidenceIds).toEqual(['ev-1']);
    expect(ledger.wastedWorkerFlags).toEqual(['review-1', 'plan-1']);
    expect(ledger.conflicts).toHaveLength(1);
    expect(ledger.finishedAt).toBe('2026-07-25T10:05:00.000Z');
  });

  it('serializes JSON and builds a stable relative path', () => {
    const ledger = createSwarmRunLedger({ runId: 'run/with spaces', startedAt: 't0' });
    const json = serializeSwarmRunLedger(ledger);
    expect(json).toContain('"runId": "run/with spaces"');
    expect(json.endsWith('\n')).toBe(true);
    expect(swarmRunLedgerRelativePath('run/with spaces')).toBe(
      '.superliora/swarm-ledgers/run_with_spaces.json',
    );
  });
});
