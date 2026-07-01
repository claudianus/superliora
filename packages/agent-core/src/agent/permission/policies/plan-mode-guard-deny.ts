import type { Agent } from '../..';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { writeFileAccesses } from './file-access-ask';

export class PlanModeGuardDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'plan-mode-guard-deny';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (!this.agent.planMode.isActive) return;

    const toolName = context.toolCall.name;
    const { isUltraMode, phase } = this.agent.planMode;

    // Ultra Plan Mode: phase-aware tool restrictions
    if (isUltraMode) {
      const phaseResult = this.evaluateUltraPhase(context, phase);
      if (phaseResult !== undefined) return phaseResult;
    }

    // Normal plan mode guards (and ultra write-phase plan-file guard)
    if (toolName === 'Write' || toolName === 'Edit') {
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
    switch (phase) {
      case 'interview': {
        if (toolName === 'AskUserQuestion') {
          this.agent.planMode.incrementInterviewRound();
          return;
        }
        if (toolName === 'NextPhase') return;
        if (toolName === 'EnterPlanMode') {
          return {
            kind: 'deny',
            message:
              'EnterPlanMode is already active in Ultra Plan interview. Use NextPhase to advance to Design; do not call EnterPlanMode with a phase argument.',
          };
        }
        if (toolName === 'ExitPlanMode') {
          return {
            kind: 'deny',
            message: 'ExitPlanMode is blocked in Interview phase. Use AskUserQuestion until the UltraGoal is true/false verifiable, then call NextPhase.',
          };
        }
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Interview phase. Only AskUserQuestion and NextPhase are allowed. NextPhase will remain blocked until the UltraGoal is true/false verifiable and required Seed gaps are closed.`,
        };
      }
      case 'design': {
        // Read-only exploration
        const designAllowed = ['Read', 'Grep', 'Glob', 'WebSearch', 'FetchURL', 'Bash', 'NextPhase'];
        if (designAllowed.includes(toolName)) return;
        if (toolName === 'ExitPlanMode') {
          return {
            kind: 'deny',
            message: 'ExitPlanMode is blocked in Design phase. Use NextPhase to advance to Review or Write when your design is complete.',
          };
        }
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Design phase. Only read-only tools are allowed (Read, Grep, Glob, WebSearch, FetchURL, Bash). Use NextPhase to advance when ready.`,
        };
      }
      case 'review': {
        const reviewAllowed = ['Read', 'Grep', 'Glob', 'NextPhase'];
        if (reviewAllowed.includes(toolName)) return;
        if (toolName === 'Bash') {
          if (isReadOnlyReviewBash(context)) return;
          return {
            kind: 'deny',
            message:
              'Bash is blocked in Review phase unless it is a simple read-only workspace inspection command (pwd, ls, git status, git diff --stat/name-only/check). Use Read, Grep, Glob, or NextPhase when ready.',
          };
        }
        if (toolName === 'ExitPlanMode') {
          return {
            kind: 'deny',
            message: 'ExitPlanMode is blocked in Review phase. Use NextPhase to advance to Write when verification is complete.',
          };
        }
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Review phase. Only Read, Grep, Glob, read-only Bash workspace inspection, and NextPhase are allowed. Use NextPhase to advance when ready.`,
        };
      }
      case 'write': {
        // Write/Edit allowed only for plan file (handled by normal plan mode guard above)
        // But also block Bash, TaskStop, Cron in write phase
        if (toolName === 'Bash') {
          return {
            kind: 'deny',
            message: 'Bash is blocked in Write phase. Focus on writing the plan file. Use NextPhase to advance to Exit when the plan is complete.',
          };
        }
        if (toolName === 'TaskStop' || toolName === 'CronCreate' || toolName === 'CronDelete') {
          return {
            kind: 'deny',
            message: `${toolName} is blocked in Write phase. Focus on writing the plan file.`,
          };
        }
        return;
      }
      case 'exit': {
        // ExitPlanMode may report a missing required section. Allow plan-file
        // edits so the agent can repair the plan instead of getting trapped.
        if (toolName === 'Write' || toolName === 'Edit') return;
        if (toolName === 'ExitPlanMode') return;
        return {
          kind: 'deny',
          message: `${toolName} is blocked in Exit phase. Only ExitPlanMode or plan-file edits are allowed.`,
        };
      }
      default:
        return;
    }
  }
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
  return (
    `Plan mode is active. You may only write to the current plan file: ${planFilePath ?? '(no plan file selected yet)'}. ` +
    'Call ExitPlanMode to exit plan mode before editing other files.'
  );
}

function isReadOnlyReviewBash(context: PermissionPolicyContext): boolean {
  const command = bashCommand(context)?.trim();
  if (command === undefined || command.length === 0) return false;
  if (hasShellControlSyntax(command)) return false;

  return (
    command === 'pwd' ||
    /^ls(?:\s+.+)?$/.test(command) ||
    /^git\s+status(?:\s+(?:--short|--porcelain|--branch|--untracked-files(?:=\S+)?|-s|-sb|-uno))*$/.test(command) ||
    /^git\s+diff(?:\s+--(?:stat|name-only|check))*$/.test(command) ||
    /^git\s+branch\s+--show-current$/.test(command) ||
    /^git\s+rev-parse\s+--(?:show-toplevel|show-prefix)$/.test(command)
  );
}

function bashCommand(context: PermissionPolicyContext): string | undefined {
  const args = context.args;
  if (args === null || typeof args !== 'object') return undefined;
  const command = (args as { command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

function hasShellControlSyntax(command: string): boolean {
  return /[\n\r;&|<>`]/.test(command) || command.includes('$(');
}
