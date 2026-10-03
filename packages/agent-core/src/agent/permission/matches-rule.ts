import picomatch from 'picomatch';

import type { RunnableToolExecution } from '../../loop/types';
import type { PermissionRule } from './types';

/**
 * DSL parser for PermissionRule `pattern` strings.
 *
 * Grammar:
 *   pattern    := toolName ( "(" argPattern ")" )?
 *   toolName   := native tool name (`Bash`, `SessionControl`) or a glob
 *   argPattern := any string interpreted only by a tool-provided matcher
 *
 * Examples:
 *   "SessionControl"  -> { toolName: "SessionControl" }
 *   "Bash(git *)"     -> { toolName: "Bash", argPattern: "git *" }
 *   "Bash(!rm *)"     -> { toolName: "Bash", argPattern: "!rm *" }
 *   "*"               -> { toolName: "*" }
 */
export interface ParsedPattern {
  readonly toolName: string;
  readonly argPattern?: string;
}

export interface PermissionRuleMatchExecution {
  readonly matchesRule?: RunnableToolExecution['matchesRule'];
}

export type PermissionRuleMatchStrategy = 'tool_name_only' | 'matches_rule';

export interface PermissionRuleMatch {
  readonly rule: PermissionRule;
  readonly strategy: PermissionRuleMatchStrategy;
  readonly hasRuleArgs: boolean;
}

export interface PermissionRuleMatchInput {
  readonly rule: PermissionRule;
  readonly toolName: string;
  readonly execution: PermissionRuleMatchExecution;
}

/**
 * Parse a DSL pattern. Throws on malformed input (missing closing paren,
 * empty tool name). The parser is the single source of truth for DSL syntax.
 */
export function parsePattern(pattern: string): ParsedPattern {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    throw new Error('permission pattern: empty string');
  }

  const openIdx = trimmed.indexOf('(');
  if (openIdx === -1) {
    return { toolName: trimmed };
  }

  if (!trimmed.endsWith(')')) {
    throw new Error(`permission pattern: missing closing paren in "${pattern}"`);
  }

  const toolName = trimmed.slice(0, openIdx);
  const argPattern = trimmed.slice(openIdx + 1, -1);
  if (toolName.length === 0) {
    throw new Error(`permission pattern: empty tool name in "${pattern}"`);
  }
  // An empty argument pattern is a tool-name-only rule.
  if (argPattern.length === 0) {
    return { toolName };
  }
  return { toolName, argPattern };
}

export function matchPermissionRule({
  rule,
  toolName,
  execution,
}: PermissionRuleMatchInput): PermissionRuleMatch | undefined {
  let parsed;
  try {
    parsed = parsePattern(rule.pattern);
  } catch {
    return undefined;
  }

  if (parsed.toolName !== '*' && !picomatch.isMatch(toolName, parsed.toolName)) {
    return undefined;
  }

  if (parsed.argPattern === undefined) {
    return { rule, strategy: 'tool_name_only', hasRuleArgs: false };
  }

  return execution.matchesRule?.(parsed.argPattern) === true
    ? { rule, strategy: 'matches_rule', hasRuleArgs: true }
    : undefined;
}
