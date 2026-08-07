import type { Agent } from '../..';
import { isPlanPhaseAllowedWrite } from '#/agent/plan/plan-write-paths';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { writeFileAccesses } from './file-access-ask';

/**
 * Approves plan-phase writes that the guard already allows (the plan file) so
 * Manual mode does not approval-bomb them. Product-tree mutation still falls
 * through to deny/ask policies.
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

      if (
        isPlanPhaseAllowedWrite(writePaths, {
          planFilePath: this.agent.planMode.planFilePath,
          workDir: this.agent.config.cwd,
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
