import type { PermissionPolicyContext } from '../types';

/**
 * Built-in tool names that are inherently read-only — they never mutate files,
 * runstate, or scheduled work. This set is the authoritative source for
 * name-based read-only classification; tools should also declare `readOnly:
 * true` on their execution, but this set covers tools that have not been
 * migrated yet and provides a safe default for MCP/user tools.
 */
export const READ_ONLY_TOOL_NAMES = new Set<string>([
  'Read',
  'ReadMediaFile',
  'Grep',
  'Glob',
  'LioraContext',
  'LioraRead',
  'LioraSearch',
  'LioraTree',
  'LioraSymbol',
  'LioraCallgraph',
  'LioraExpand',
  'LioraIndex',
  'WebSearch',
  'FetchURL',
  'Context7Resolve',
  'Context7Docs',
  'SearchSkill',
  'Skill',
  'SearchExpert',
  'TodoList',
  'TaskList',
  'TaskOutput',
]);

/**
 * MCP server name patterns (the segment between `mcp__` and the tool name)
 * that are known to be read-only documentation/search/fetch servers. MCP
 * tools matching these patterns are allowed in read-only plan phases. All
 * other MCP tools are treated as potentially mutating (safe default).
 */
export const READ_ONLY_MCP_PATTERNS: readonly RegExp[] = [
  /^mcp__[\w-]*context7[\w-]*__/i,
  /^mcp__[\w-]*docs?[\w-]*__/i,
  /^mcp__[\w-]*search[\w-]*__/i,
  /^mcp__[\w-]*fetch[\w-]*__/i,
];

/**
 * Determine whether a tool is read-only for permission-gating purposes.
 *
 * Order of checks (first decisive result wins):
 * 1. Explicit `readOnly` flag on the execution — trusted author declaration.
 * 2. `accesses` with a write/readwrite operation or `kind: 'all'` → definitely
 *    mutating, return false.
 * 3. Name in the static `READ_ONLY_TOOL_NAMES` set (and accesses has no
 *    mutation) → read-only.
 * 4. Name matches a `READ_ONLY_MCP_PATTERNS` entry → read-only.
 * 5. Otherwise → not read-only (safe default).
 *
 * CRITICAL: `accesses: none()` (empty array) does NOT imply read-only. Tools
 * like `Agent` and `BrowserObserve` declare `none()` because they have no file-
 * concurrency conflicts, but they still have side effects (launching subagents,
 * controlling a browser). Only the explicit flag or static set membership
 * classifies a tool as read-only.
 */
export function isReadOnlyTool(context: PermissionPolicyContext): boolean {
  const execution = context.execution;
  const toolName = context.toolCall.name;

  // 1. Explicit declaration wins.
  if (execution.readOnly === true) return true;
  if (execution.readOnly === false) return false;

  // 2. accesses proves mutation → definitely not read-only.
  if (hasMutatingAccesses(execution.accesses)) return false;

  // 3. Static name set (core classification for builtins without the flag yet).
  if (READ_ONLY_TOOL_NAMES.has(toolName)) return true;

  // 4. Known read-only MCP pattern.
  if (isReadOnlyMcpTool(toolName)) return true;

  // 5. Unknown / potentially side-effecting.
  return false;
}

function hasMutatingAccesses(
  accesses: PermissionPolicyContext['execution']['accesses'],
): boolean {
  if (accesses === undefined) return false;
  return accesses.some((access) => {
    if (access.kind === 'all') return true;
    return access.operation === 'write' || access.operation === 'readwrite';
  });
}

function isReadOnlyMcpTool(toolName: string): boolean {
  return READ_ONLY_MCP_PATTERNS.some((pattern) => pattern.test(toolName));
}
