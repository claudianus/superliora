import { describe, expect, it } from 'vitest';

import type { UltraworkRun, WorkGraphNode } from '@superliora/protocol';

import {
  auditUltraworkCompletion,
  formatCompletionAuditRejection,
} from '../../src/ultrawork/completion-audit';

function baseRun(overrides: Partial<UltraworkRun> = {}): UltraworkRun {
  return {
    id: 'run-audit-1',
    objective: 'Ship harness fix',
    status: 'running',
    stage: 'swarm',
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
    ...overrides,
  } as UltraworkRun;
}

function node(partial: Partial<WorkGraphNode> & Pick<WorkGraphNode, 'id' | 'status'>): WorkGraphNode {
  return {
    title: partial.title ?? partial.id,
    stage: partial.stage ?? 'implement',
    ...partial,
  } as WorkGraphNode;
}

describe('auditUltraworkCompletion', () => {
  it('allows missing run (plain goal, not ultrawork-bound)', () => {
    expect(auditUltraworkCompletion({ run: null }).ok).toBe(true);
    expect(auditUltraworkCompletion({ run: undefined }).ok).toBe(true);
  });

  it('allows already terminal runs', () => {
    expect(auditUltraworkCompletion({ run: baseRun({ status: 'done' }) }).ok).toBe(true);
    expect(auditUltraworkCompletion({ run: baseRun({ status: 'failed' }) }).ok).toBe(true);
  });

  it('rejects empty WorkGraph as false complete', () => {
    const result = auditUltraworkCompletion({ run: baseRun({ workGraph: undefined }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('empty_work_graph');
      expect(formatCompletionAuditRejection(result)).toContain('false complete');
    }
  });

  it('rejects empty node list', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: { id: 'g1', runId: 'run-audit-1', nodes: [] },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('empty_work_graph');
  });

  it('rejects incomplete nodes', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_1',
              kind: 'acceptance_criterion',
              status: 'done',
              requiredEvidence: ['test'],
              evidenceIds: ['unit-test-report'],
              verificationStatus: 'passed',
            }),
            node({ id: 'ac_2', kind: 'acceptance_criterion', status: 'queued' }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('incomplete_nodes');
      expect(result.openNodeIds).toContain('ac_2');
    }
  });

  it('rejects done without evidence when requiredEvidence set (evidence hard gate)', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_1',
              status: 'done',
              requiredEvidence: ['vitest recovery'],
              evidenceIds: [],
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('evidence_gate');
    }
  });

  it('rejects requiredEvidence without verificationStatus=passed', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_1',
              status: 'done',
              requiredEvidence: ['vitest recovery'],
              evidenceIds: ['vitest recovery'],
              // verificationStatus omitted → pending
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('verification_pending');
    }
  });

  it('rejects verificationStatus=failed even if status=done', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_1',
              kind: 'acceptance_criterion',
              status: 'done',
              requiredEvidence: ['test'],
              evidenceIds: ['unit-test-report'],
              verificationStatus: 'failed',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('verification_failed');
  });

  it('passes when non-policy nodes are done without requiredEvidence', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({ id: 'research_1', kind: 'research', stage: 'research', status: 'done' }),
            node({ id: 'other_1', kind: 'other', stage: 'swarm', status: 'done' }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it('rejects AC done nodes with empty requiredEvidence (policy hard gate)', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_1',
              kind: 'acceptance_criterion',
              stage: 'swarm',
              status: 'done',
              requiredEvidence: [],
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['evidence_gate', 'incomplete_nodes']).toContain(result.code);
      expect(result.reasons.join(' ')).toMatch(/policy requires non-empty|cannot be done|still/i);
    }
  });

  it('passes when requiredEvidence has matching evidenceIds and verificationStatus=passed', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_1',
              status: 'done',
              requiredEvidence: ['vitest recovery'],
              evidenceIds: ['vitest recovery', 'recovery.test.ts'],
              verificationStatus: 'passed',
              verificationSummary: 'vitest recovery green',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it('attaches analyzeFailedNodes category guidance for status=failed nodes', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_timeout',
              kind: 'acceptance_criterion',
              status: 'failed',
              verificationSummary: 'timeout after 120s',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('node_failed');
      expect(result.reasons.some((r) => /ac_timeout\[timeout\]/.test(r))).toBe(true);
      expect(result.nextActions.some((a) => /Repair ac_timeout \[timeout\]/.test(a))).toBe(true);
      expect(result.nextActions.some((a) => /Increase timeout|split/i.test(a))).toBe(true);
      const formatted = formatCompletionAuditRejection(result);
      expect(formatted).toContain('timeout');
      expect(formatted).toContain('ac_timeout');
    }
  });

  it('treats cancelled nodes as terminal (not incomplete)', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({ id: 'research_1', kind: 'research', stage: 'research', status: 'done' }),
            node({ id: 'dropped_1', kind: 'other', stage: 'swarm', status: 'cancelled' }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it('rejects status=failed nodes (failed is not success or cancelled)', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({ id: 'research_1', kind: 'research', stage: 'research', status: 'done' }),
            node({ id: 'impl_1', kind: 'implementation', stage: 'implement', status: 'failed' }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('node_failed');
      expect(result.openNodeIds).toContain('impl_1');
      expect(result.reasons.some((r) => /impl_1\[unknown\]/.test(r))).toBe(true);
    }
  });

  it('rejects verificationStatus=blocked even when node status is done', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'verify_1',
              kind: 'verification',
              stage: 'verify',
              status: 'done',
              verificationStatus: 'blocked',
              requiredEvidence: ['ev-runtime'],
              evidenceIds: ['ev-runtime'],
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('verification_blocked');
      expect(result.openNodeIds).toContain('verify_1');
      expect(result.reasons.some((r) => r.includes('verificationStatus=blocked'))).toBe(true);
    }
  });

  it('rejects needs_integration with dedicated audit code and integrate actions', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'integrate_1',
              kind: 'integration',
              stage: 'integrate',
              status: 'needs_integration',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('needs_integration');
      expect(result.openNodeIds).toContain('integrate_1');
      expect(result.nextActions.some((a) => /Integrate specialist handoffs/i.test(a))).toBe(true);
      expect(result.nextActions.some((a) => /integration evidence/i.test(a))).toBe(true);
    }
  });

  it('prioritizes node_failed over generic incomplete when both exist', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_fail',
              kind: 'acceptance_criterion',
              status: 'failed',
              verificationSummary: 'timeout after 30s',
            }),
            node({
              id: 'ac_queued',
              kind: 'acceptance_criterion',
              status: 'queued',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('node_failed');
      expect(result.openNodeIds).toContain('ac_fail');
      expect(result.openNodeIds).not.toContain('ac_queued');
      expect(result.reasons.some((r) => /ac_fail\[timeout\]/.test(r))).toBe(true);
      expect(result.nextActions.some((a) => /Repair ac_fail \[timeout\]/.test(a))).toBe(true);
    }
  });

  it('prioritizes needs_integration over generic incomplete when both exist', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_int',
              kind: 'acceptance_criterion',
              status: 'needs_integration',
            }),
            node({
              id: 'ac_queued',
              kind: 'acceptance_criterion',
              status: 'queued',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('needs_integration');
      expect(result.openNodeIds).toContain('ac_int');
      expect(result.openNodeIds).not.toContain('ac_queued');
      expect(result.nextActions.some((a) => /Integrate specialist handoffs/i.test(a))).toBe(true);
    }
  });

  it('rejects blocked nodes with dedicated node_blocked code and unblock actions', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_block',
              kind: 'acceptance_criterion',
              status: 'blocked',
              dependsOn: ['ac_dep'],
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('node_blocked');
      expect(result.openNodeIds).toContain('ac_block');
      expect(result.nextActions.some((a) => /Unblock WorkGraph/i.test(a))).toBe(true);
      expect(result.nextActions.some((a) => /dependsOn/i.test(a))).toBe(true);
    }
  });

  it('prioritizes node_blocked over generic incomplete when both exist', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_block',
              kind: 'acceptance_criterion',
              status: 'blocked',
            }),
            node({
              id: 'ac_queued',
              kind: 'acceptance_criterion',
              status: 'queued',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('node_blocked');
      expect(result.openNodeIds).toContain('ac_block');
      expect(result.openNodeIds).not.toContain('ac_queued');
    }
  });

  it('hints ownerless running nodes in incomplete nextActions', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_orphan',
              kind: 'acceptance_criterion',
              status: 'running',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('incomplete_nodes');
      expect(result.nextActions.some((a) => /Assign owner or re-queue orphan running/i.test(a))).toBe(
        true,
      );
      expect(result.nextActions.some((a) => a.includes('ac_orphan'))).toBe(true);
    }
  });
});
