import { describe, expect, it } from 'vitest';

import type { WorkGraphNode } from '@superliora/protocol';

import {
  applyEvidenceHardGate,
  evaluateEvidenceHardGate,
  findEvidenceHardGateViolation,
} from '../../src/session/swarm-evidence-gate';

function node(overrides: Partial<WorkGraphNode> = {}): WorkGraphNode {
  return {
    id: 'ac_1',
    title: 'Ship feature',
    stage: 'swarm',
    status: 'queued',
    ...overrides,
  };
}

describe('swarm-evidence-gate', () => {
  it('allows done without requiredEvidence', () => {
    expect(evaluateEvidenceHardGate(node({ status: 'done' }))).toEqual({ ok: true });
  });

  it('allows non-done statuses even with requiredEvidence', () => {
    expect(
      evaluateEvidenceHardGate(
        node({ status: 'running', requiredEvidence: ['unit test'], evidenceIds: [] }),
      ),
    ).toEqual({ ok: true });
  });

  it('blocks done when requiredEvidence is set but evidenceIds empty', () => {
    const result = evaluateEvidenceHardGate(
      node({
        status: 'done',
        requiredEvidence: ['unit test', 'screenshot'],
        evidenceIds: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.suggestedStatus).toBe('blocked');
    expect(result.reason).toContain('cannot be done');
    expect(result.reason).toContain('unit test');
  });

  it('blocks done when requiredEvidence is set and evidenceIds missing', () => {
    const result = evaluateEvidenceHardGate(
      node({
        status: 'done',
        requiredEvidence: ['unit test'],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('allows done when requiredEvidence is set and evidenceIds present', () => {
    expect(
      evaluateEvidenceHardGate(
        node({
          status: 'done',
          requiredEvidence: ['unit test'],
          evidenceIds: ['ev-1'],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('finds the first violation in a list', () => {
    const violation = findEvidenceHardGateViolation([
      node({ id: 'ok', status: 'done', evidenceIds: ['e'] }),
      node({
        id: 'bad',
        status: 'done',
        requiredEvidence: ['test'],
        evidenceIds: [],
      }),
    ]);
    expect(violation?.nodeId).toBe('bad');
  });

  it('applyEvidenceHardGate rewrites violating done nodes to blocked', () => {
    const { nodes, violations } = applyEvidenceHardGate([
      node({
        id: 'bad',
        status: 'done',
        requiredEvidence: ['unit test'],
      }),
      node({ id: 'ok', status: 'done', evidenceIds: ['e1'] }),
    ]);
    expect(violations).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: 'bad',
      status: 'blocked',
      verificationStatus: 'blocked',
    });
    expect(nodes[0]?.verificationSummary).toContain('cannot be done');
    expect(nodes[1]?.status).toBe('done');
  });
});
