import type { Agent } from '../..';
import { isMissionPlanPhaseAllowedWrite } from '#/mission/plan-write-paths';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { writeFileAccesses } from './file-access-ask';

/**
 * Approves Mission/Ultra plan-phase writes that the guard already allows
 * (plan file + evidence root) so Manual mode does not approval-bomb them.
 * Product-tree mutation still falls through to deny/ask policies.
 */
export class PlanModeToolApprovePermissionPolicy implements PermissionPolicy {
  readonly name = 'plan-mode-tool-approve';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    const toolName = context.toolCall.name;
    if (toolName === 'EnterPlanMode') {
      return {
        kind: 'approve',
      };
    }

    if (
      (toolName === 'Write' || toolName === 'Edit') &&
      this.agent.planMode.isActive
    ) {
      const writeAccesses = writeFileAccesses(context);
      const writePaths =
        writeAccesses.length > 0
          ? writeAccesses.map((access) => access.path)
          : extractWritePathsFromArgs(context);
      if (writePaths.length === 0) return;

      const activation = this.agent.ultrawork?.getActivation();
      const workDir =
        activation?.workDir !== undefined && activation.workDir.length > 0
          ? activation.workDir
          : this.agent.config.cwd;
      if (
        isMissionPlanPhaseAllowedWrite(writePaths, {
          planFilePath: this.agent.planMode.planFilePath,
          evidenceRoot: activation?.evidenceRoot,
          workDir,
        })
      ) {
        return {
          kind: 'approve',
        };
      }
    }

    if (toolName === 'ExitPlanMode') {
      if (!this.agent.planMode.isActive) {
        return {
          kind: 'approve',
        };
      }
      if (context.execution.display?.kind !== 'plan_review') {
        return {
          kind: 'approve',
        };
      }
      if (context.execution.display.plan.trim().length > 0) return;
      return {
        kind: 'approve',
      };
    }
  }
}

function extractWritePathsFromArgs(context: PermissionPolicyContext): string[] {
  const args = context.toolCall.arguments;
  if (args === null || typeof args !== 'object') return [];
  const path = (args as { readonly path?: unknown }).path;
  return typeof path === 'string' && path.length > 0 ? [path] : [];
}
