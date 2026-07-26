import { describe, expect, it } from 'vitest';

import type { WorkGraphNode } from '@superliora/protocol';

import {
  applyEvidenceHardGate,
  evaluateEvidenceHardGate,
  evidenceMatchesToken,
  findEvidenceHardGateViolation,
  isCheckLikeEvidenceToken,
  isPathLikeEvidenceToken,
  requiresNonEmptyRequiredEvidence,
  withDefaultRequiredEvidence,
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
  it('allows done without requiredEvidence for non-policy nodes', () => {
    expect(
      evaluateEvidenceHardGate(
        node({
          id: 'research_1',
          kind: 'research',
          stage: 'research',
          status: 'done',
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('blocks done without requiredEvidence for acceptance_criterion', () => {
    const result = evaluateEvidenceHardGate(
      node({
        id: 'ac_1',
        kind: 'acceptance_criterion',
        stage: 'swarm',
        status: 'done',
        requiredEvidence: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingRequiredEvidencePolicy).toBe(true);
    expect(result.reason).toMatch(/policy requires non-empty/i);
  });

  it('blocks done without requiredEvidence for stage=verify', () => {
    const result = evaluateEvidenceHardGate(
      node({
        id: 'verify_1',
        kind: 'other',
        stage: 'verify',
        status: 'done',
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingRequiredEvidencePolicy).toBe(true);
  });

  it('blocks done without requiredEvidence for id prefix ac_', () => {
    const result = evaluateEvidenceHardGate(
      node({ id: 'ac_99', stage: 'swarm', status: 'done' }),
    );
    expect(result.ok).toBe(false);
  });

  it('withDefaultRequiredEvidence injects test token for AC nodes', () => {
    const seeded = withDefaultRequiredEvidence(
      node({ id: 'ac_2', kind: 'acceptance_criterion', stage: 'swarm' }),
    );
    expect(seeded.requiredEvidence).toEqual(['test']);
    expect(requiresNonEmptyRequiredEvidence(seeded)).toBe(true);
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

  it('blocks done mutators that claim check-like evidence without match (bypass regression)', () => {
    // Simulates UltraSwarm / mirror writing done without going through UltraworkGraph tool.
    const mapped = [
      node({
        id: 'ac_bypass',
        status: 'done',
        requiredEvidence: ['RunProjectChecks', 'test'],
        evidenceIds: ['handoff-only'],
        verificationSummary: 'UltraSwarm completed 1 expert result(s)',
      }),
    ];
    const gated = applyEvidenceHardGate(mapped);
    expect(gated.violations.length).toBeGreaterThan(0);
    expect(gated.nodes[0]?.status).toBe('blocked');
    expect(gated.nodes[0]?.verificationStatus).toBe('blocked');
    expect(gated.nodes[0]?.verificationSummary).toMatch(/cannot be done|RunProjectChecks|test/i);
  });

  it('allows needs_integration without requiredEvidence (swarm intermediate state)', () => {
    expect(
      evaluateEvidenceHardGate(
        node({
          status: 'needs_integration',
          requiredEvidence: ['RunProjectChecks'],
          evidenceIds: [],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('treats path-like requiredEvidence as check-like and requires a match (AC-A4)', () => {
    const pathToken = 'packages/agent-core/test/agent/goal-predicate.test.ts';
    expect(isCheckLikeEvidenceToken(pathToken)).toBe(true);
    expect(isPathLikeEvidenceToken(pathToken)).toBe(true);

    const blocked = evaluateEvidenceHardGate(
      node({
        id: 'ac_path',
        status: 'done',
        requiredEvidence: [pathToken],
        evidenceIds: ['handoff-only'],
        verificationSummary: 'looks done',
      }),
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.unmatchedCheckTokens).toContain(pathToken);
    }

    const ok = evaluateEvidenceHardGate(
      node({
        id: 'ac_path_ok',
        status: 'done',
        requiredEvidence: [pathToken],
        evidenceIds: [pathToken],
        verificationSummary: 'vitest green',
      }),
    );
    expect(ok).toEqual({ ok: true });
  });
});
