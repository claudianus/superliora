import type { Agent } from '../..';
import {
  isPlanPhaseAllowedWrite,
  type PlanWriteContext,
} from '#/agent/plan/plan-write-paths';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { writeFileAccesses } from './file-access-ask';

export class PlanModeGuardDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'plan-mode-guard-deny';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (!this.agent.planMode.isActive) return;

    const toolName = context.toolCall.name;
    const { isUltraMode, phase } = this.agent.planMode;

    // Ultra interview: still count rounds when the model asks the user.
    if (isUltraMode && phase === 'interview' && toolName === 'AskUserQuestion') {
      this.agent.planMode.incrementInterviewRound();
    }

    if (toolName === 'Write' || toolName === 'Edit') {
      const planFilePath = this.agent.planMode.planFilePath;
      const writeAccesses = writeFileAccesses(context);
      const writePaths =
        writeAccesses.length > 0
          ? writeAccesses.map((access) => access.path)
          : extractWritePathsFromArgs(context);

      if (writePaths.length === 0) {
        return {
          kind: 'deny',
          message: planModeWriteDeniedMessage(planFilePath),
        };
      }

      const allowCtx = missionWriteContext(this.agent, planFilePath);
      if (isPlanPhaseAllowedWrite(writePaths, allowCtx)) {
        return;
      }

      // Legacy ultra-interview product-write exception removed: Mission plan phases
      // only allow plan file + evidence root until ExitPlanMode.
      return {
        kind: 'deny',
        message: planModeWriteDeniedMessage(planFilePath),
      };
    }

    if (toolName === 'CronCreate' || toolName === 'CronDelete') {
      return {
        kind: 'deny',
        message:
          `${toolName} is not available in plan mode because it would mutate scheduled work that runs after plan exit. Call ExitPlanMode first.`,
      };
    }

    return;
  }
}

function missionWriteContext(
  agent: Agent,
  planFilePath: string | null,
): PlanWriteContext {
  const activation = agent.ultrawork?.getActivation();
  const workDir =
    activation?.workDir !== undefined && activation.workDir.length > 0
      ? activation.workDir
      : (agent.config?.cwd ?? '');
  return {
    planFilePath,
    evidenceRoot: activation?.evidenceRoot,
    workDir,
  };
}

function extractWritePathsFromArgs(context: PermissionPolicyContext): string[] {
  const args = context.toolCall.arguments;
  if (args === null || typeof args !== 'object') return [];
  const path = (args as { readonly path?: unknown }).path;
  return typeof path === 'string' && path.length > 0 ? [path] : [];
}

function planModeWriteDeniedMessage(planFilePath: string | null): string {
  return `Plan mode is active. You may only write to the current plan file or Mission evidence root: ${
    planFilePath ?? '(no plan file selected yet)'
  }. Call ExitPlanMode before editing product source.`;
}
