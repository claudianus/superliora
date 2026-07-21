import type { Agent } from '../..';
import { isUltraworkWorkflowReportWritePath } from '../../../ultrawork/workflow-report';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { writeFileAccesses } from './file-access-ask';

export class PlanModeGuardDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'plan-mode-guard-deny';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (!this.agent.planMode.isActive) return;

    const toolName = context.toolCall.name;
    const { isUltraMode, phase } = this.agent.planMode;

    if (
      (toolName === 'Write' || toolName === 'Edit') &&
      writesOnlyUltraworkWorkflowReport(context, this.agent)
    ) {
      return;
    }

    // Ultra Plan Mode: the phase workflow is guidance, not enforcement. The
    // only harness-side bookkeeping left is counting interview rounds when the
    // model asks the user; every tool approval follows the user's permission
    // mode (auto/yolo approve, manual prompts).
    if (isUltraMode && phase === 'interview' && toolName === 'AskUserQuestion') {
      this.agent.planMode.incrementInterviewRound();
    }

    // Normal plan mode guards (and ultra write/exit plan-file guard).
    // Ultra interview product Write/Edit already returned undefined above.
    if (
      (toolName === 'Write' || toolName === 'Edit') &&
      !(isUltraMode && phase === 'interview')
    ) {
      const planFilePath = this.agent.planMode.planFilePath;
      if (planFilePath === null) {
        return {
          kind: 'deny',
          message: planModeWriteDeniedMessage(planFilePath),
        };
      }
      if (writesOnlyPlanFile(context, planFilePath)) {
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

function writesOnlyUltraworkWorkflowReport(
  context: PermissionPolicyContext,
  agent: Agent,
): boolean {
  const ultrawork = agent.ultrawork;
  if (ultrawork === undefined) return false;

  const activation = ultrawork.getActivation();
  if (activation === undefined || ultrawork.getRun() === null) return false;

  const writeAccesses = writeFileAccesses(context);
  if (writeAccesses.length === 0) return false;

  const workDir =
    activation.workDir.length > 0 ? activation.workDir : agent.config.cwd;
  return writeAccesses.every((access) =>
    isUltraworkWorkflowReportWritePath(access.path, activation.evidenceRoot, workDir),
  );
}

function writesOnlyPlanFile(
  context: PermissionPolicyContext,
  planFilePath: string,
): boolean {
  const writeAccesses = writeFileAccesses(context);
  if (writeAccesses.length === 0) return false;
  return writeAccesses.every((access) => access.path === planFilePath);
}

function planModeWriteDeniedMessage(planFilePath: string | null): string {
  return `Plan mode is active. You may only write to the current plan file: ${
    planFilePath ?? '(no plan file selected yet)'
  }. Call ExitPlanMode to exit plan mode before editing other files.`;
}
