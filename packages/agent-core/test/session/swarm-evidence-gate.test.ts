import type { WorkGraphNode } from '@superliora/protocol';
import { describe, expect, it } from 'vitest';

import {
  applyEvidenceHardGate,
  evaluateEvidenceHardGate,
  evidenceMatchesToken,
  findEvidenceHardGateViolation,
  isCheckLikeEvidenceToken,
  isPathLikeEvidenceToken,
  normalizeEvidenceToken,
  requiresNonEmptyRequiredEvidence,
  withDefaultRequiredEvidence,
  type EvidenceGateNode,
} from '#/fleet';

function node(over: Partial<EvidenceGateNode> & { id: string }): EvidenceGateNode {
  return {
    id: over.id,
    status: over.status ?? 'done',
    kind: over.kind,
    stage: over.stage,
    requiredEvidence: over.requiredEvidence,
    evidenceIds: over.evidenceIds,
    verificationSummary: over.verificationSummary,
  };
}

describe('swarm-evidence-gate.ts — requiresNonEmptyRequiredEvidence', () => {
  it('flags acceptance_criterion / verification / stage=verify / ac_-prefixed ids', () => {
    expect(requiresNonEmptyRequiredEvidence(node({ id: 'a', kind: 'acceptance_criterion' }))).toBe(true);
    expect(requiresNonEmptyRequiredEvidence(node({ id: 'a', kind: 'verification' }))).toBe(true);
    expect(requiresNonEmptyRequiredEvidence(node({ id: 'a', stage: 'verify' }))).toBe(true);
    expect(requiresNonEmptyRequiredEvidence(node({ id: 'ac_1' }))).toBe(true);
    expect(requiresNonEmptyRequiredEvidence(node({ id: 'AC-9' }))).toBe(true);
  });

  it('does not flag implementation nodes without a verify signal', () => {
    expect(requiresNonEmptyRequiredEvidence(node({ id: 'impl-1', kind: 'implementation' }))).toBe(false);
  });
});

describe('swarm-evidence-gate.ts — withDefaultRequiredEvidence', () => {
  it('is a no-op for non-policy nodes', () => {
    const n = node({ id: 'impl-1', kind: 'implementation' });
    expect(withDefaultRequiredEvidence(n)).toEqual(n);
  });

  it('seeds the default token when a policy node has no requiredEvidence', () => {
    const n = node({ id: 'ac_1', kind: 'acceptance_criterion' });
    const out = withDefaultRequiredEvidence(n);
    expect(out.requiredEvidence).toEqual(['test']);
  });

  it('does not invent VerifySurface from UI-shaped AC ids (explicit evidence only)', () => {
    const n = node({ id: 'ac_ui_hero', kind: 'acceptance_criterion' });
    const out = withDefaultRequiredEvidence(n);
    // Same default as non-UI AC — keyword/id regex must not invent web proof.
    expect(out.requiredEvidence).toEqual(['test']);
  });

  it('returns the input unchanged when requiredEvidence already has any non-empty token', () => {
    // The seeder must not mutate the input — the trim pass is only used
    // to decide whether to inject the default token.
    const n: EvidenceGateNode = {
      id: 'ac_1',
      status: 'done',
      kind: 'acceptance_criterion',
      requiredEvidence: ['  ', 'run-vitest'],
    };
    const out = withDefaultRequiredEvidence(n);
    expect(out).toEqual(n);
  });
});

describe('swarm-evidence-gate.ts — evaluateEvidenceHardGate', () => {
  it('always returns ok for non-done nodes', () => {
    const n: EvidenceGateNode = {
      id: 'ac_1',
      status: 'queued',
      kind: 'acceptance_criterion',
    };
    expect(evaluateEvidenceHardGate(n).ok).toBe(true);
  });

  it('blocks a policy-bound node with empty requiredEvidence', () => {
    const n: EvidenceGateNode = {
      id: 'ac_1',
      status: 'done',
      kind: 'acceptance_criterion',
      requiredEvidence: [],
    };
    const result = evaluateEvidenceHardGate(n);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.suggestedStatus).toBe('blocked');
      expect(result.missingRequiredEvidencePolicy).toBe(true);
    }
  });

  it('blocks a non-policy node when requiredEvidence is set but evidenceIds are empty', () => {
    const n: EvidenceGateNode = {
      id: 'impl-1',
      status: 'done',
      kind: 'implementation',
      requiredEvidence: ['plain text'],
    };
    const result = evaluateEvidenceHardGate(n);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('evidenceIds is empty or missing');
    }
  });

  it('passes a non-check requiredEvidence when at least one evidence id exists', () => {
    const n: EvidenceGateNode = {
      id: 'impl-1',
      status: 'done',
      kind: 'implementation',
      requiredEvidence: ['plain'],
      evidenceIds: ['e-1'],
    };
    expect(evaluateEvidenceHardGate(n).ok).toBe(true);
  });

  it('passes a non-check requiredEvidence when only verificationSummary is set', () => {
    const n: EvidenceGateNode = {
      id: 'impl-1',
      status: 'done',
      kind: 'implementation',
      requiredEvidence: ['plain'],
      verificationSummary: 'summary text',
    };
    expect(evaluateEvidenceHardGate(n).ok).toBe(true);
  });

  it('blocks a check-like requiredEvidence with no matching token in evidence or summary', () => {
    const n: EvidenceGateNode = {
      id: 'ac_1',
      status: 'done',
      kind: 'acceptance_criterion',
      requiredEvidence: ['RunProjectChecks'],
      evidenceIds: ['something-unrelated'],
    };
    const result = evaluateEvidenceHardGate(n);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unmatchedCheckTokens).toEqual(['RunProjectChecks']);
    }
  });

  it('passes a check-like requiredEvidence when the token matches evidence (best-effort normalize)', () => {
    const n: EvidenceGateNode = {
      id: 'ac_1',
      status: 'done',
      kind: 'acceptance_criterion',
      requiredEvidence: ['RunProjectChecks'],
      evidenceIds: ['run-project-checks-script'],
    };
    expect(evaluateEvidenceHardGate(n).ok).toBe(true);
  });
});

describe('swarm-evidence-gate.ts — token helpers', () => {
  it('isPathLikeEvidenceToken recognises absolute, home-relative, workspace, and explicit relative paths', () => {
    expect(isPathLikeEvidenceToken('/abs/path/foo.ts')).toBe(true);
    expect(isPathLikeEvidenceToken('~/code/foo.ts')).toBe(true);
    expect(isPathLikeEvidenceToken('C:\\Windows\\foo.txt')).toBe(true);
    expect(isPathLikeEvidenceToken('./foo.ts')).toBe(true);
    expect(isPathLikeEvidenceToken('../foo.ts')).toBe(true);
    expect(isPathLikeEvidenceToken('packages/agent-core/src/foo.ts')).toBe(true);
    expect(isPathLikeEvidenceToken('src/foo.test.ts')).toBe(true);
  });

  it('isPathLikeEvidenceToken rejects free prose and short strings', () => {
    expect(isPathLikeEvidenceToken('ab')).toBe(false);
    expect(isPathLikeEvidenceToken('just prose')).toBe(false);
    expect(isPathLikeEvidenceToken('https://example.com/foo')).toBe(false);
  });

  it('isCheckLikeEvidenceToken flags known tool names and the documented file suffixes', () => {
    expect(isCheckLikeEvidenceToken('RunProjectChecks')).toBe(true);
    expect(isCheckLikeEvidenceToken('VerifySurface')).toBe(true);
    expect(isCheckLikeEvidenceToken('unit-test')).toBe(true); // bidirectional
    expect(isCheckLikeEvidenceToken('packages/x/foo.test.ts')).toBe(true); // path
    expect(isCheckLikeEvidenceToken('plain word')).toBe(false);
  });

  it('normalizeEvidenceToken lowercases and strips non-alphanumerics', () => {
    expect(normalizeEvidenceToken('RunProject-Checks_2')).toBe('runprojectchecks2');
  });

  it('evidenceMatchesToken does bidirectional substring match on normalized form', () => {
    expect(evidenceMatchesToken('RunProjectChecks', ['run-project-checks'])).toBe(true);
    expect(evidenceMatchesToken('RunProjectChecks', ['plain'])).toBe(false);
  });
});

describe('swarm-evidence-gate.ts — findEvidenceHardGateViolation / applyEvidenceHardGate', () => {
  it('returns undefined when every node passes the gate', () => {
    const nodes: EvidenceGateNode[] = [
      { id: 'a', status: 'done' },
      { id: 'b', status: 'done', requiredEvidence: ['plain'], evidenceIds: ['e-1'] },
    ];
    expect(findEvidenceHardGateViolation(nodes)).toBeUndefined();
  });

  it('returns the first failing node', () => {
    const nodes: EvidenceGateNode[] = [
      { id: 'a', status: 'done', requiredEvidence: ['plain'] },
      { id: 'b', status: 'done', kind: 'acceptance_criterion' },
    ];
    const v = findEvidenceHardGateViolation(nodes);
    expect(v?.ok).toBe(false);
    if (v && !v.ok) expect(v.nodeId).toBe('a');
  });

  it('applyEvidenceHardGate demotes failing done nodes to blocked and appends the reason', () => {
    // Node 'a' is policy-bound (ac_) with no requiredEvidence — the
    // policy block fires before any other rule.
    const nodes: WorkGraphNode[] = [
      {
        id: 'ac_1',
        status: 'done',
        kind: 'acceptance_criterion',
        requiredEvidence: [],
        verificationSummary: 'before',
      } as unknown as WorkGraphNode,
      {
        id: 'b',
        status: 'done',
        kind: 'implementation',
        requiredEvidence: ['plain'],
        evidenceIds: ['e-1'],
      } as unknown as WorkGraphNode,
    ];
    const out = applyEvidenceHardGate(nodes);
    expect(out.violations).toHaveLength(1);
    const a = out.nodes[0]!;
    expect(a.status).toBe('blocked');
    expect(a.verificationStatus).toBe('blocked');
    expect(a.verificationSummary).toMatch(/^before \| /);
    const b = out.nodes[1]!;
    expect(b.status).toBe('done');
  });
});
