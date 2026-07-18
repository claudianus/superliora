import type { WorkGraph } from '@superliora/protocol';
import { describe, expect, it } from 'vitest';

import {
  buildUltraSwarmIntegrationReportXml,
  type UltraSwarmIntegrationReportInput,
} from '../../src/tools/builtin/collaboration/ultra-swarm-integration-report';
import { inferVerdict } from '../../src/tools/builtin/collaboration/ultra-swarm-helpers';
import { workNodeOutcome } from '../../src/tools/builtin/collaboration/ultra-swarm-phase';
import { todosFromWorkGraph } from '../../src/tools/builtin/state/ultrawork-graph';
import { inferEffectiveUltraworkStage } from '../../src/ultrawork/stage-progress';
import { isUltraworkWorkflowReportWritePath } from '../../src/ultrawork/workflow-report';

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

  it('marks successful swarm outcomes as needs_integration, not done', () => {
    const outcome = workNodeOutcome([
      {
        spec: {
          index: 1,
          expertId: 'impl-1',
          expertName: 'Implementer',
          assignmentPrompt: 'do it',
          phase: 'implement',
          focus: 'implement',
          emoji: 'x',
          color: '#fff',
          runId: 'r1',
          requiredForCompletion: true,
          workNodeIds: ['n1'],
        },
        status: 'completed',
        result: 'VERDICT: PASS\nevidence: packages/agent-core/src/foo.ts',
        verdict: 'PASS',
        evidenceIds: ['packages/agent-core/src/foo.ts'],
      } as const,
    ]);

    expect(outcome.status).toBe('needs_integration');
    expect(outcome.verificationStatus).toBe('pending');
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

  it('classifies plan-only PASS without artifacts as PASS_WITH_ADVICE', () => {
    expect(inferVerdict('completed', 'VERDICT: PASS\nAdvice only', undefined, 'plan')).toBe(
      'PASS_WITH_ADVICE',
    );
    expect(
      inferVerdict(
        'completed',
        'VERDICT: PASS\nartifact_paths: packages/agent-core/src/foo.ts',
        undefined,
        'implement',
      ),
    ).toBe('PASS');
    expect(inferVerdict('completed', 'VERDICT: PASS_WITH_ADVICE', undefined, 'research')).toBe(
      'PASS_WITH_ADVICE',
    );
  });

  it('splits integration headline by phase instead of one PASS bucket', () => {
    const rendered: UltraSwarmIntegrationReportInput[] = [
      {
        spec: {
          expertId: 'planner',
          expertName: 'Planner',
          emoji: 'p',
          phase: 'plan',
          focus: 'plan',
          workNodeIds: [],
        },
        status: 'completed',
        verdict: 'PASS_WITH_ADVICE',
        evidenceIds: [],
        result: '## Summary\nplan only',
      },
      {
        spec: {
          expertId: 'impl',
          expertName: 'Implementer',
          emoji: 'i',
          phase: 'implement',
          focus: 'implement',
          workNodeIds: ['n1'],
        },
        status: 'completed',
        verdict: 'PASS',
        evidenceIds: ['packages/agent-core/src/foo.ts'],
        result: '## Summary\nimplemented',
      },
    ];

    const xml = buildUltraSwarmIntegrationReportXml(rendered, 'run-1');
    expect(xml).toContain('implement_pass="1"');
    expect(xml).toContain('plan_pass="1"');
    expect(xml).toContain('implement 1/1 PASS');
    expect(xml).toContain('plan 1 PASS');
    expect(xml).toContain('PASS_WITH_ADVICE');
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
