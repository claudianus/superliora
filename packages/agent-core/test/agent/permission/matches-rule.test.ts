import { describe, expect, it } from 'vitest';

import {
  matchPermissionRule,
  parsePattern,
  type PermissionRuleMatchExecution,
} from '#/agent/permission/matches-rule';
import type { PermissionRule } from '#/agent/permission/types';

const rule = (pattern: string): PermissionRule =>
  ({ decision: 'allow', scope: 'user', pattern });

const exec = (matchesRule: PermissionRuleMatchExecution['matchesRule'] = undefined): PermissionRuleMatchExecution =>
  matchesRule ? { matchesRule } : {};

describe('agent/permission/matches-rule — parsePattern', () => {
  it('parses a tool-name-only pattern', () => {
    expect(parsePattern('Bash')).toEqual({ toolName: 'Bash' });
  });

  it('trims surrounding whitespace', () => {
    expect(parsePattern('  SessionControl  ')).toEqual({ toolName: 'SessionControl' });
  });

  it('parses a tool + arg-pattern into toolName and argPattern', () => {
    expect(parsePattern('Bash(git *)')).toEqual({
      toolName: 'Bash',
      argPattern: 'git *',
    });
  });

  it('keeps the leading "!" on a negative arg-pattern', () => {
    expect(parsePattern('Bash(!rm *)')).toEqual({
      toolName: 'Bash',
      argPattern: '!rm *',
    });
  });

  it('treats an empty native argument pattern as tool-name-only', () => {
    expect(parsePattern('SessionControl()')).toEqual({ toolName: 'SessionControl' });
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
      matchPermissionRule({ rule: rule('Bash'), toolName: 'SessionControl', execution: exec() }),
    ).toBeUndefined();
  });

  it('matches every tool when the pattern is "*"', () => {
    const match = matchPermissionRule({ rule: rule('*'), toolName: 'SessionControl', execution: exec() });
    expect(match?.strategy).toBe('tool_name_only');
  });


  it('uses execution.matchesRule for arg-pattern matching when provided', () => {
    const matchesRule = (pattern: string) => pattern === 'safe';
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

