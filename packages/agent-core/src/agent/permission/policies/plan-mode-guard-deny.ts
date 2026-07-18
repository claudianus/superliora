import type { Agent } from '../..';
import { isUltraworkWorkflowReportWritePath } from '../../../ultrawork/workflow-report';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { writeFileAccesses } from './file-access-ask';
import { isReadOnlyTool } from './tool-read-only';

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

    // Ultra Plan Mode: workflow gates only (research questions, phase exit,
    // interview bookkeeping). Inspection/mutation tool approval follows the
    // user's permission mode after this policy returns undefined.
    if (isUltraMode) {
      const phaseResult = this.evaluateUltraPhase(context, phase);
      if (phaseResult !== undefined) return phaseResult;
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

    if (toolName === 'TaskStop') {
      return {
        kind: 'deny',
        message:
          'TaskStop is not available in plan mode. Call ExitPlanMode to exit plan mode before stopping a background task.',
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

  private evaluateUltraPhase(
    context: PermissionPolicyContext,
    phase: string,
  ): PermissionPolicyResult | undefined {
    const toolName = context.toolCall.name;

    // Read-only tools never hit plan hard-denies. Approval still follows the
    // user's permission mode (auto/yolo approve; manual default-approve for
    // read-only tools). This avoids thrashing on millions of inspection calls.
    if (isReadOnlyTool(context)) return;

    // Interview product Write/Edit is intentionally open; sensitive paths are
    // handled later by SensitiveFileAccessDeny/Ask.
    if ((toolName === 'Write' || toolName === 'Edit') && phase === 'interview') {
      return;
    }

    // Non-interview Write/Edit fall through to the plan-file-only outer guard.
    if (toolName === 'Write' || toolName === 'Edit') {
      return;
    }

    // Interview bookkeeping (not a permission-mode concern).
    if (toolName === 'AskUserQuestion' && phase === 'interview') {
      this.agent.planMode.incrementInterviewRound();
      return;
    }

    if (toolName === 'RecordInterviewFinding') {
      if (phase !== 'interview') {
        return {
          kind: 'deny',
          message:
            'RecordInterviewFinding is only available during Ultra Plan interview. Use AskUserQuestion or NextPhase instead.',
        };
      }
      // Dialectic Rhythm Guard: after 3 consecutive non-user answers,
      // force the next question to the user via AskUserQuestion.
      const consecutive = this.agent.planMode.ultraEngine.interviewState.consecutiveNonUserAnswers;
      if (consecutive >= 3) {
        return {
          kind: 'deny',
          message:
            'Rhythm Guard: 3 consecutive findings were recorded without user input. Use AskUserQuestion next to confirm a decision with the user directly. Do not use RecordInterviewFinding again until the user has answered at least one question.',
        };
      }
      return;
    }

    // Workflow-only gates (not tool-permission spam). Everything else — Bash,
    // Agent, Browser, unknown MCP, test runners — defers to the user's
    // permission mode so auto/yolo stay unblocked and manual only shows prompts.
    if (toolName === 'AskUserQuestion' && phase === 'research') {
      return {
        kind: 'deny',
        message:
          'AskUserQuestion is blocked in Research phase. Gather current evidence first, then call NextPhase({ phase: "interview" }) before asking the user.',
      };
    }

    if (toolName === 'EnterPlanMode') {
      return {
        kind: 'deny',
        message:
          'EnterPlanMode is already active in Ultra Plan. Use NextPhase to advance phases; do not call EnterPlanMode with a phase argument.',
      };
    }

    if (toolName === 'ExitPlanMode' && phase !== 'write' && phase !== 'exit') {
      const phaseLabel = `${phase.charAt(0).toUpperCase()}${phase.slice(1)}`;
      const nextHint =
        phase === 'research'
          ? 'Build a source-backed evidence pack, then use NextPhase to advance to Interview.'
          : phase === 'interview'
            ? 'Use AskUserQuestion until the UltraGoal is true/false verifiable, then call NextPhase.'
            : phase === 'design'
              ? 'Use NextPhase to advance to Review when the design is ready.'
              : phase === 'review'
                ? 'Use NextPhase to advance to Write when verification is complete.'
                : 'Use NextPhase to advance when ready.';
      return {
        kind: 'deny',
        message: `ExitPlanMode is blocked in ${phaseLabel} phase. ${nextHint}`,
      };
    }

    // Bash / Agent / Browser / MCP / NextPhase / background tools: allow at the
    // plan-guard layer. User permission mode decides approve vs ask.
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
