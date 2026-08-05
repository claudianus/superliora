/**
 * Shared tool-name policy used by full compaction planning, micro clearing,
 * and swarm boundary compaction (Claude Code–style exclude_tools set).
 */

/**
 * Tools whose results are treated as stateful / control-plane for compaction
 * planning (exclude from clearable tool-result groups).
 */
const KNOWN_MUTATING_TOOLS = new Set([
  'Agent',
  'AgentSwarm',
  'AskUserQuestion',
  'Bash',
  'CreateGoal',
  'CronCreate',
  'CronDelete',
  'Edit',
  'EnterPlanMode',
  'ExitPlanMode',
  'Fleet',
  'Memory',
  'NextPhase',
  'RecordInterviewFinding',
  'SetGoalBudget',
  'Skill',
  'TaskStop',
  'TodoList',
  'UltraSwarm',
  'UltraworkGraph',
  'UpdateGoal',
  'Write',
]);

export const ARCHIVE_RECOVER_TOOL = 'Expand';

/** Archive recovery has one public tool name. */
export function resolveArchiveRecoverToolName(availableTools: Iterable<string>): string {
  void availableTools;
  return ARCHIVE_RECOVER_TOOL;
}

export function isStatefulOrMutatingTool(toolName: string): boolean {
  return KNOWN_MUTATING_TOOLS.has(toolName);
}

export function isKnownMutatingTool(toolName: string): boolean {
  return isStatefulOrMutatingTool(toolName);
}
