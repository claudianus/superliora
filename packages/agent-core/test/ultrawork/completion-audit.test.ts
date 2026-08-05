import { describe, expect, it } from 'vitest';

import type { UltraworkRun, WorkGraphNode } from '@superliora/protocol';

import {
  auditUltraworkCompletion,
  formatCompletionAuditRejection,
} from '#/mission';

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
      // Match recovery-triangle seed wording.
      expect(result.nextActions.some((a) => /Seed WorkGraph via UltraworkGraph/i.test(a))).toBe(
        true,
      );
    }
  });

  it('rejects empty node list', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: { id: 'g1', runId: 'run-audit-1', nodes: [] },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('empty_work_graph');
      expect(result.nextActions.some((a) => /Seed WorkGraph via UltraworkGraph/i.test(a))).toBe(
        true,
      );
    }
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
      expect(result.nextActions.some((a) => /Close evidence hard-gate on node\(s\)/i.test(a))).toBe(
        true,
      );
      expect(
        result.nextActions.some(
          (a) => a.includes('ac_1') && a.includes('requiredEvidence: vitest recovery'),
        ),
      ).toBe(true);
      expect(result.nextActions.some((a) => /evidence hard gate remaps/i.test(a))).toBe(true);
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
    if (!result.ok) {
      expect(result.code).toBe('verification_failed');
      expect(result.nextActions.some((a) => /Close verification gaps on node\(s\)/i.test(a))).toBe(
        true,
      );
      expect(result.nextActions.some((a) => a.includes('ac_1') && a.includes('verify=failed'))).toBe(true);
    }
  });

  it('rejects done nodes without any real verification action', () => {
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
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('verification_action_missing');
    }
  });

  it.each([
    ['verify-later'],
    ['could not verify yet'],
    ['typecheck skipped'],
    ['lint-failed-but-ignored'],
    ['smoke signal only'],
    ['pnpm test not run'],
  ])(
    'rejects keyword-only evidence %j without verificationStatus=passed',
    (fakeEvidence) => {
      const result = auditUltraworkCompletion({
        run: baseRun({
          workGraph: {
            id: 'g1',
            runId: 'run-audit-1',
            nodes: [
              node({
                id: 'impl_1',
                kind: 'other',
                stage: 'swarm',
                status: 'done',
                evidenceIds: [fakeEvidence],
                verificationSummary: fakeEvidence,
              }),
            ],
          },
        }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('verification_action_missing');
      }
    },
  );

  it('passes when non-policy nodes are done with verificationStatus=passed', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'research_1',
              kind: 'research',
              stage: 'research',
              status: 'done',
              verificationStatus: 'passed',
            }),
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
      expect(result.reasons.some((r) => r.includes('ac_timeout[timeout]'))).toBe(true);
      // Match recovery-prompt shared failed-node next_actions wording.
      expect(
        result.nextActions.some(
          (a) =>
            a.includes('Repair failed WorkGraph node(s) first: ac_timeout') &&
            a.includes('ac_timeout[timeout]'),
        ),
      ).toBe(true);
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
            node({
              id: 'research_1',
              kind: 'research',
              stage: 'research',
              status: 'done',
              verificationStatus: 'passed',
            }),
            node({ id: 'dropped_1', kind: 'other', stage: 'swarm', status: 'cancelled' }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it('allows all-cancelled graphs without verification action', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [node({ id: 'dropped_1', kind: 'other', stage: 'swarm', status: 'cancelled' })],
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
            node({ id: 'impl_1', kind: 'implementation', stage: 'swarm', status: 'failed' }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('node_failed');
      expect(result.openNodeIds).toContain('impl_1');
      expect(result.reasons.some((r) => r.includes('impl_1[unknown]'))).toBe(true);
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
      expect(result.nextActions.some((a) => /Close verification gaps on node\(s\)/i.test(a))).toBe(
        true,
      );
      expect(result.nextActions.some((a) => a.includes('verify_1') && a.includes('verify=blocked'))).toBe(
        true,
      );
    }
  });

  it('attaches verification-gap nextActions for verification_pending rejects', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_pending',
              kind: 'acceptance_criterion',
              status: 'done',
              requiredEvidence: ['smoke'],
              evidenceIds: ['smoke'],
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('verification_pending');
      expect(result.openNodeIds).toContain('ac_pending');
      expect(result.nextActions.some((a) => /Close verification gaps on node\(s\)/i.test(a))).toBe(
        true,
      );
      expect(result.nextActions.some((a) => a.includes('ac_pending'))).toBe(true);
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
              title: 'Merge specialist handoff',
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
      // Match recovery-prompt id+(title) formatting.
      expect(
        result.nextActions.some(
          (a) =>
            /Integrate specialist handoffs/i.test(a) &&
            a.includes('integrate_1 (Merge specialist handoff)'),
        ),
      ).toBe(true);
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
      expect(result.reasons.some((r) => r.includes('ac_fail[timeout]'))).toBe(true);
      expect(
        result.nextActions.some(
          (a) =>
            a.includes('Repair failed WorkGraph node(s) first: ac_fail') &&
            a.includes('ac_fail[timeout]'),
        ),
      ).toBe(true);
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

  it('merges evidence-gate reasons when both node_blocked and remap-from-done exist', () => {
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
              id: 'ac_done_no_evidence',
              kind: 'acceptance_criterion',
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
      expect(result.code).toBe('node_blocked');
      // Original blocked still primary
      expect(result.openNodeIds).toContain('ac_block');
      // Evidence-gate remap id surfaced so user can repair both tracks
      expect(result.openNodeIds).toContain('ac_done_no_evidence');
      // Reasons include the remap violation
      expect(
        result.reasons.some(
          (r) => r.includes('ac_done_no_evidence') && /cannot be done|requiredEvidence/.test(r),
        ),
      ).toBe(true);
      // Next actions surface the evidence-gate repair step
      expect(
        result.nextActions.some((a) => /Close evidence hard-gate on node\(s\)/i.test(a)),
      ).toBe(true);
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

  it('hints queued dependsOn waits in incomplete nextActions', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_dep',
              kind: 'acceptance_criterion',
              status: 'running',
              ownerExpertId: 'expert-1',
            }),
            node({
              id: 'ac_wait',
              kind: 'acceptance_criterion',
              status: 'queued',
              dependsOn: ['ac_dep'],
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('incomplete_nodes');
      expect(result.nextActions.some((a) => /Queued node\(s\) waiting on dependsOn/i.test(a))).toBe(
        true,
      );
      expect(result.nextActions.some((a) => a.includes('ac_wait') && a.includes('dependsOn: ac_dep'))).toBe(
        true,
      );
    }
  });

  it('hints owned stuck running nodes in incomplete nextActions', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_owned_stuck',
              kind: 'acceptance_criterion',
              status: 'running',
              ownerExpertId: 'expert-1',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('incomplete_nodes');
      expect(result.nextActions.some((a) => /Circuit-break stuck WorkGraph/i.test(a))).toBe(true);
      expect(result.nextActions.some((a) => a.includes('ac_owned_stuck[running]'))).toBe(true);
      // ownerless path must not fire for owned nodes
      expect(result.nextActions.some((a) => /orphan running/i.test(a))).toBe(false);
    }
  });

  it('hints verification gaps on open nodes in incomplete nextActions', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_gap',
              kind: 'acceptance_criterion',
              status: 'running',
              ownerExpertId: 'expert-1',
              requiredEvidence: ['vitest'],
              evidenceIds: [],
              verificationStatus: 'pending',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('incomplete_nodes');
      expect(result.nextActions.some((a) => /Close verification gaps on node\(s\)/i.test(a))).toBe(
        true,
      );
      expect(
        result.nextActions.some((a) => a.includes('ac_gap') && a.includes('missing evidence: vitest')),
      ).toBe(true);
      expect(result.nextActions.some((a) => a.includes('verify=pending'))).toBe(true);
    }
  });

  it('promotes high-resume oscillation and long-running stage on incomplete audits', () => {
    const now = Date.now();
    const result = auditUltraworkCompletion({
      run: baseRun({
        stage: 'integrate',
        stageHistory: [
          {
            stage: 'integrate',
            enteredAt: new Date(now - 20 * 60_000).toISOString(),
            reason: 'interrupt: context pressure',
          },
          {
            stage: 'integrate',
            enteredAt: new Date(now - 19 * 60_000).toISOString(),
            reason: 'crash recovery',
          },
          {
            stage: 'integrate',
            enteredAt: new Date(now - 18 * 60_000).toISOString(),
            reason: 'blocked on dependency',
          },
        ],
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({
              id: 'ac_open',
              kind: 'acceptance_criterion',
              stage: 'integrate',
              status: 'running',
              ownerExpertId: 'expert-1',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('incomplete_nodes');
      expect(result.nextActions.some((a) => /Break oscillation|high resume count/i.test(a))).toBe(
        true,
      );
      expect(result.nextActions.some((a) => /Advance or split long-running stage/i.test(a))).toBe(
        true,
      );
    }
  });

  it('formats blocked dependsOn with comma+space like recovery-prompt', () => {
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
              dependsOn: ['dep_a', 'dep_b', 'dep_c'],
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('node_blocked');
      expect(
        result.nextActions.some(
          (a) => a.includes('dependsOn: dep_a, dep_b, dep_c') && /Unblock WorkGraph/i.test(a),
        ),
      ).toBe(true);
    }
  });
});
