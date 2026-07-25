import { describe, expect, it } from 'vitest';

import type { WorkGraphNode } from '@superliora/protocol';

import {
  applyEvidenceHardGate,
  evaluateEvidenceHardGate,
  evidenceMatchesToken,
  findEvidenceHardGateViolation,
  isCheckLikeEvidenceToken,
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

  it('allows done when requiredEvidence is set and evidenceIds present (non-check token)', () => {
    expect(
      evaluateEvidenceHardGate(
        node({
          status: 'done',
          requiredEvidence: ['design-doc'],
          evidenceIds: ['ev-1'],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('blocks done when check-like token has no matching evidence id/title', () => {
    const result = evaluateEvidenceHardGate(
      node({
        status: 'done',
        requiredEvidence: ['RunProjectChecks'],
        evidenceIds: ['ev-unrelated-42'],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unmatchedCheckTokens).toContain('RunProjectChecks');
    expect(result.reason).toContain('RunProjectChecks');
  });

  it('allows done when evidenceIds best-effort match RunProjectChecks', () => {
    expect(
      evaluateEvidenceHardGate(
        node({
          status: 'done',
          requiredEvidence: ['RunProjectChecks'],
          evidenceIds: ['tool:RunProjectChecks:pass'],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('allows done when verificationSummary mentions VerifySurface', () => {
    expect(
      evaluateEvidenceHardGate(
        node({
          status: 'done',
          requiredEvidence: ['VerifySurface'],
          evidenceIds: [],
          verificationSummary: 'VerifySurface ran on /dashboard — ok',
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('allows done when screenshot token matches evidence title', () => {
    expect(
      evaluateEvidenceHardGate(
        node({
          status: 'done',
          requiredEvidence: ['screenshot'],
          evidenceIds: ['browser-screenshot-home.png'],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('allows done when test token matches unit-test evidence', () => {
    expect(
      evaluateEvidenceHardGate(
        node({
          status: 'done',
          requiredEvidence: ['test'],
          evidenceIds: ['unit-test-report'],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('classifies check-like tokens', () => {
    expect(isCheckLikeEvidenceToken('RunProjectChecks')).toBe(true);
    expect(isCheckLikeEvidenceToken('VerifySurface')).toBe(true);
    expect(isCheckLikeEvidenceToken('screenshot')).toBe(true);
    expect(isCheckLikeEvidenceToken('unit test')).toBe(true);
    expect(isCheckLikeEvidenceToken('design-doc')).toBe(false);
  });

  it('evidenceMatchesToken is best-effort substring', () => {
    expect(evidenceMatchesToken('screenshot', ['BrowserScreenshot-1'])).toBe(true);
    expect(evidenceMatchesToken('RunProjectChecks', ['ev-1'])).toBe(false);
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
