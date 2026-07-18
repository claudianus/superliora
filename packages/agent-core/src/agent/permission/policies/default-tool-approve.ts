import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';
import { isReadOnlyTool } from './tool-read-only';

const DEFAULT_APPROVE_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'ReadMediaFile',
  'SetTodoList',
  'TodoList',
  'TaskList',
  'TaskOutput',
  'CronList',
  'WebSearch',
  'FetchURL',
  'BrowserStatus',
  'BrowserObserve',
  'BrowserScreenshot',
  'ComputerCapture',
  'ComputerStatus',
  'Agent',
  'AskUserQuestion',
  'Skill',
  // Goal control tools have no side effects on the world: GetGoal reads, and
  // mutation tools only record the goal's own runtime state.
  'GetGoal',
  'GetCurrentTime',
  'SetGoalBudget',
  'UpdateGoal',
  // Ultra Plan / research inspection tools — follow user permission mode without
  // per-call prompts in manual when the tool is inherently read-only.
  'LioraRead',
  'LioraTree',
  'LioraSymbol',
  'LioraCallgraph',
  'LioraExpand',
  'Context7Resolve',
  'Context7Docs',
  'SearchSkill',
  'SearchExpert',
  'NextPhase',
  'RecordInterviewFinding',
]);

export class DefaultToolApprovePermissionPolicy implements PermissionPolicy {
  readonly name = 'default-tool-approve';

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    if (DEFAULT_APPROVE_TOOLS.has(context.toolCall.name)) {
      return {
        kind: 'approve',
      };
    }
    // Keep default-approve in sync with plan-mode read-only classification so
    // Ultra Plan research never stalls on manual prompts for inspection tools
    // (including known read-only MCP servers).
    if (isReadOnlyTool(context)) {
      return {
        kind: 'approve',
      };
    }
    return;
  }
}
