import type { WorkGraph } from '@superliora/protocol';
import { describe, expect, it } from 'vitest';

import {
  inferEffectiveUltraworkStage,
  summarizeWorkGraphProgress,
  isUltraworkWorkflowReportWritePath,
  todosFromWorkGraph,
} from '#/mission';

describe('harness friction fixes (H1–H4)', () => {
  it('keeps all-done WorkGraph auto-stage below verify/done', () => {
    const graph: WorkGraph = {
      id: 'g1',
      runId: 'r1',
      nodes: [
        {
          id: 'n1',
          title: 'Implement',
          stage: 'verify',
          status: 'done',
        },
        {
          id: 'n2',
          title: 'Ship',
          stage: 'done',
          status: 'done',
        },
      ],
    };

    expect(inferEffectiveUltraworkStage('plan', graph)).toBe('integrate');
    expect(inferEffectiveUltraworkStage('swarm', graph)).toBe('integrate');
  });

  it('treats cancelled nodes as terminal progress (not resume targets)', () => {
    const graph: WorkGraph = {
      id: 'g1',
      runId: 'r1',
      nodes: [
        { id: 'n1', title: 'Implement', stage: 'integrate', status: 'done' },
        { id: 'n2', title: 'Dropped scope', stage: 'swarm', status: 'cancelled' },
      ],
    };
    const progress = summarizeWorkGraphProgress(graph);
    expect(progress.pendingCount).toBe(0);
    expect(progress.nextPendingNode).toBeUndefined();
    expect(progress.doneCount).toBe(1);
    expect(progress.cancelledCount).toBe(1);
    expect(progress.failedCount).toBe(0);
    // Same auto-stage floor as all-done graphs.
    expect(inferEffectiveUltraworkStage('swarm', graph)).toBe('integrate');
  });

  it('counts failed nodes separately while keeping them out of pending', () => {
    const graph: WorkGraph = {
      id: 'g1',
      runId: 'r1',
      nodes: [
        { id: 'n1', title: 'Implement', stage: 'integrate', status: 'done' },
        { id: 'n2', title: 'Broken verify', stage: 'verify', status: 'failed' },
        { id: 'n3', title: 'Open work', stage: 'integrate', status: 'running' },
      ],
    };
    const progress = summarizeWorkGraphProgress(graph);
    expect(progress.doneCount).toBe(1);
    expect(progress.failedCount).toBe(1);
    expect(progress.pendingCount).toBe(1);
    expect(progress.nextPendingNode?.id).toBe('n3');
  });

  it('still resumes at verify when open verify work remains', () => {
    const graph: WorkGraph = {
      id: 'g1',
      runId: 'r1',
      nodes: [
        { id: 'n1', title: 'Scaffold', stage: 'integrate', status: 'done' },
        { id: 'n2', title: 'Performance', stage: 'verify', status: 'running' },
      ],
    };
    expect(inferEffectiveUltraworkStage('research', graph)).toBe('verify');
  });

  it('maps needs_integration todos to in_progress', () => {
    const graph: WorkGraph = {
      id: 'g1',
      runId: 'r1',
      nodes: [
        {
          id: 'n1',
          title: 'Integrate swarm work',
          stage: 'integrate',
          status: 'needs_integration',
        },
      ],
    };

    expect(todosFromWorkGraph(graph)).toEqual([
      { title: '[n1] Integrate swarm work', status: 'in_progress' },
    ]);
  });

  it('allows workflow-report and wiki paths under evidence roots', () => {
    expect(
      isUltraworkWorkflowReportWritePath(
        '/work/.superliora/evidence/ultrawork-runs/run-1/workflow-report.md',
        '.superliora/evidence/ultrawork-runs/run-1',
        '/work',
      ),
    ).toBe(true);
    expect(
      isUltraworkWorkflowReportWritePath(
        '/work/.superliora/wiki/runs/run-1.md',
        '.superliora/evidence/ultrawork-runs/run-1',
        '/work',
      ),
    ).toBe(true);
    expect(
      isUltraworkWorkflowReportWritePath(
        '/work/packages/agent-core/src/foo.ts',
        '.superliora/evidence/ultrawork-runs/run-1',
        '/work',
      ),
    ).toBe(false);
  });
});
