import type { ToolCall } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '#/agent';
import type { PermissionPolicyContext } from '#/agent/permission';
import { PlanModeToolApprovePermissionPolicy } from '#/agent/permission/policies/plan-mode-tool-approve';
import { PlanModeGuardDenyPermissionPolicy } from '#/agent/permission/policies/plan-mode-guard-deny';
import { ToolAccesses } from '../../src/loop';

function policyContext(
  toolName: string,
  args: Record<string, unknown>,
  accesses = ToolAccesses.none(),
): PermissionPolicyContext {
  return {
    toolCall: {
      id: 't1',
      name: toolName,
      arguments: args,
    } as ToolCall,
    mode: 'manual',
    execution: {
      accesses,
      description: toolName,
      approvalRule: toolName,
      execute: async () => ({ output: 'ok' }),
    },
  };
}

function missionPlanAgent(planPath: string, evidenceRoot: string) {
  return {
    config: { cwd: '/workspace/project' },
    planMode: {
      isActive: true,
      isUltraMode: true,
      phase: 'write',
      planFilePath: planPath,
      incrementInterviewRound: vi.fn(),
    },
    ultrawork: {
      getRun: () => ({ id: 'run-1', status: 'running' }),
      getActivation: () => ({
        source: 'manual',
        replaceGoal: false,
        evidenceRoot,
        workDir: '/workspace/project',
      }),
    },
  } as unknown as Agent;
}

describe('Mission plan-phase permission profile', () => {
  const planPath = '/home/u/.superliora/plans/m1.md';
  const evidenceRoot = '.superliora/evidence/ultrawork-runs/run-1';
  const reportPath = `${evidenceRoot}/workflow-report.md`;

  it('approves plan file and evidence writes under Manual (no ask)', () => {
    const agent = missionPlanAgent(planPath, evidenceRoot);
    const approve = new PlanModeToolApprovePermissionPolicy(agent);

    const planWrite = approve.evaluate(
      policyContext('Write', { path: planPath, content: '# plan' }, [
        { kind: 'file', operation: 'write', path: planPath },
      ]),
    );
    expect(planWrite).toEqual({ kind: 'approve' });

    const evidenceWrite = approve.evaluate(
      policyContext('Edit', { path: reportPath, old_string: 'a', new_string: 'b' }, [
        { kind: 'file', operation: 'write', path: reportPath },
      ]),
    );
    expect(evidenceWrite).toEqual({ kind: 'approve' });
  });

  it('does not approve product mutation; guard denies it', () => {
    const agent = missionPlanAgent(planPath, evidenceRoot);
    const approve = new PlanModeToolApprovePermissionPolicy(agent);
    const guard = new PlanModeGuardDenyPermissionPolicy(agent);

    const productPath = '/workspace/project/src/main.ts';
    const ctx = policyContext('Write', { path: productPath, content: 'x' }, [
      { kind: 'file', operation: 'write', path: productPath },
    ]);

    expect(approve.evaluate(ctx)).toBeUndefined();
    const denied = guard.evaluate(ctx);
    expect(denied?.kind).toBe('deny');
  });

  it('guard allows plan + evidence paths', () => {
    const agent = missionPlanAgent(planPath, evidenceRoot);
    const guard = new PlanModeGuardDenyPermissionPolicy(agent);

    expect(
      guard.evaluate(
        policyContext('Write', { path: planPath, content: 'x' }, [
          { kind: 'file', operation: 'write', path: planPath },
        ]),
      ),
    ).toBeUndefined();

    expect(
      guard.evaluate(
        policyContext('Write', { path: reportPath, content: 'x' }, [
          { kind: 'file', operation: 'write', path: reportPath },
        ]),
      ),
    ).toBeUndefined();
  });
});
