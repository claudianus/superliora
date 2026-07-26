import { describe, expect, it } from 'vitest';

import {
  matchPermissionRule,
  parsePattern,
  type PermissionRuleMatchExecution,
} from '#/agent/permission/matches-rule';
import type { PermissionRule } from '#/agent/permission/types';

const rule = (pattern: string): PermissionRule =>
  ({ action: 'allow', pattern } as unknown as PermissionRule);

const exec = (matchesRule: PermissionRuleMatchExecution['matchesRule'] = undefined): PermissionRuleMatchExecution =>
  matchesRule ? { matchesRule } : {};

describe('agent/permission/matches-rule — parsePattern', () => {
  it('parses a tool-name-only pattern', () => {
    expect(parsePattern('Bash')).toEqual({ toolName: 'Bash' });
  });

  it('trims surrounding whitespace', () => {
    expect(parsePattern('  Write  ')).toEqual({ toolName: 'Write' });
  });

  it('parses a tool + arg-pattern into toolName and argPattern', () => {
    expect(parsePattern('Read(/etc/**)')).toEqual({
      toolName: 'Read',
      argPattern: '/etc/**',
    });
  });

  it('keeps the leading "!" on a negative arg-pattern', () => {
    expect(parsePattern('Bash(!rm *)')).toEqual({
      toolName: 'Bash',
      argPattern: '!rm *',
    });
  });

  it('treats "Tool()" as tool-name-only with no arg pattern', () => {
    expect(parsePattern('Tool()')).toEqual({ toolName: 'Tool' });
  });

  it('throws on an empty pattern', () => {
    expect(() => parsePattern('   ')).toThrow(/empty/);
  });

  it('throws on a pattern with a missing closing paren', () => {
    expect(() => parsePattern('Bash(rm *')).toThrow(/missing closing paren/);
  });

  it('throws on a pattern with an empty tool name', () => {
    expect(() => parsePattern('(/etc/**)')).toThrow(/empty tool name/);
  });

  it('parses an mcp__server__* glob as the literal toolName', () => {
    expect(parsePattern('mcp__github__*')).toEqual({ toolName: 'mcp__github__*' });
  });
});

describe('agent/permission/matches-rule — matchPermissionRule', () => {
  it('matches a plain tool-name-only pattern', () => {
    const match = matchPermissionRule({ rule: rule('Bash'), toolName: 'Bash', execution: exec() });
    expect(match).toEqual({
      rule: rule('Bash'),
      strategy: 'tool_name_only',
      hasRuleArgs: false,
    });
  });

  it('returns undefined when the tool name does not match the literal pattern', () => {
    expect(
      matchPermissionRule({ rule: rule('Bash'), toolName: 'Read', execution: exec() }),
    ).toBeUndefined();
  });

  it('matches every tool when the pattern is "*"', () => {
    const match = matchPermissionRule({ rule: rule('*'), toolName: 'Anything', execution: exec() });
    expect(match?.strategy).toBe('tool_name_only');
  });

  it('matches mcp__server__* style globs', () => {
    const match = matchPermissionRule({
      rule: rule('mcp__github__*'),
      toolName: 'mcp__github__create_issue',
      execution: exec(),
    });
    expect(match?.strategy).toBe('tool_name_only');
  });

  it('uses execution.matchesRule for arg-pattern matching when provided', () => {
    const matchesRule = vi_fn((p: string) => p === 'safe');
    const match = matchPermissionRule({
      rule: rule('Bash(safe)'),
      toolName: 'Bash',
      execution: { matchesRule },
    });
    expect(match).toEqual({
      rule: rule('Bash(safe)'),
      strategy: 'matches_rule',
      hasRuleArgs: true,
    });
  });

  it('returns undefined when execution.matchesRule is missing and the pattern has args', () => {
    expect(
      matchPermissionRule({ rule: rule('Bash(safe)'), toolName: 'Bash', execution: {} }),
    ).toBeUndefined();
  });

  it('returns undefined when execution.matchesRule returns false', () => {
    expect(
      matchPermissionRule({
        rule: rule('Bash(safe)'),
        toolName: 'Bash',
        execution: { matchesRule: () => false },
      }),
    ).toBeUndefined();
  });

  it('returns undefined for a malformed pattern (does not throw)', () => {
    expect(
      matchPermissionRule({ rule: rule('Bash(rm *'), toolName: 'Bash', execution: {} }),
    ).toBeUndefined();
  });
});

// Tiny inline stub for `vi` without importing the full vitest runtime in this file
function vi_fn<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
