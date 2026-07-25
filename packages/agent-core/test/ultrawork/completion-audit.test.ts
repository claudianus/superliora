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
    stage: 'implement',
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
            node({ id: 'ac_1', status: 'done' }),
            node({ id: 'ac_2', status: 'queued' }),
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
              status: 'done',
              verificationStatus: 'failed',
            }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('verification_failed');
  });

  it('passes when all nodes done without requiredEvidence', () => {
    const result = auditUltraworkCompletion({
      run: baseRun({
        workGraph: {
          id: 'g1',
          runId: 'run-audit-1',
          nodes: [
            node({ id: 'ac_1', status: 'done' }),
            node({ id: 'ac_2', status: 'done' }),
          ],
        },
      }),
    });
    expect(result.ok).toBe(true);
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
});
