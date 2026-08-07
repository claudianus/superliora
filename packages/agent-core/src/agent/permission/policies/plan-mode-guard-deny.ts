import type { Agent } from '../..';
import { isPlanPhaseAllowedWrite } from '#/agent/plan/plan-write-paths';
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

      if (
        isPlanPhaseAllowedWrite(writePaths, {
          planFilePath,
          workDir: this.agent.config?.cwd ?? '',
        })
      ) {
        return;
      }

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

function extractWritePathsFromArgs(context: PermissionPolicyContext): string[] {
  const args = context.toolCall.arguments;
  if (args === null || typeof args !== 'object') return [];
  const path = (args as { readonly path?: unknown }).path;
  return typeof path === 'string' && path.length > 0 ? [path] : [];
}

function planModeWriteDeniedMessage(planFilePath: string | null): string {
  return `Plan mode is active. You may only write to the current plan file: ${
    planFilePath ?? '(no plan file selected yet)'
  }. Call ExitPlanMode before editing product source.`;
}
