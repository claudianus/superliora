import type { Agent } from '../..';
import { isConductorBashCommandReadOnly } from '#/agent/conductor-bash-policy';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { isReadOnlyTool } from './tool-read-only';

/**
 * Delegation and lifecycle tools that must be denied in ask mode even though
 * `isReadOnlyTool` would let them through. `TaskOutput` is in
 * `READ_ONLY_TOOL_NAMES` because it only reads a buffer, but it can block on a
 * worker, and ask mode exists precisely so no worker starts.
 */
const ASK_MODE_BLOCKED_TOOLS = new Set<string>([
  'Agent',
  'TaskOutput',
  'TaskStop',
  'JobCreate',
  'JobSteer',
  'JobCancel',
  'JobResume',
  'JobSchedule',
  'MergeJob',
  'CreateGoal',
  'UpdateGoal',
  'SetGoalBudget',
  'EnterPlanMode',
]);

export class AskModeGuardDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'ask-mode-guard-deny';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (!this.agent.askMode.isActive) return;

    const toolName = context.toolCall.name;

    if (ASK_MODE_BLOCKED_TOOLS.has(toolName)) {
      return { kind: 'deny', message: askModeDeniedMessage(toolName, 'delegates or commits work') };
    }

    // Clarifying questions are the point of ask mode — AskUserQuestion mutates
    // nothing in the workspace (accesses: all() is only for concurrency), so
    // let it through before the read-only gate.
    if (toolName === 'AskUserQuestion') return;

    // Bash is read-only only for inspection commands; reuse the conductor
    // classifier so `rg` / `git log` / `ls` still work but installs and
    // redirection do not.
    if (toolName === 'Bash') {
      const command = context.toolCall.arguments;
      const commandText =
        command !== null && typeof command === 'object'
          ? (command as { readonly command?: unknown }).command
          : undefined;
      if (isConductorBashCommandReadOnly(commandText)) return;
      return {
        kind: 'deny',
        message:
          'Ask mode is active, so Bash is unavailable for this command. ' +
          'File contents: use Read or RepoQuery (not cat/pager/jq dumps). ' +
          'Search: use Grep or Glob. Shell inspection only (git log, ls, rg, and similar). ' +
          'The user leaves ask mode when they want mutating work done.',
      };
    }

    if (isReadOnlyTool(context)) return;

    return { kind: 'deny', message: askModeDeniedMessage(toolName, 'is not read-only') };
  }
}

function askModeDeniedMessage(toolName: string, reason: string): string {
  return `Ask mode is active, so ${toolName} is unavailable because it ${reason}. Ask mode is for investigating and answering: read files, search, and look things up, then report what you found. The user leaves ask mode when they want the work done.`;
}
