import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { AskModeGuardDenyPermissionPolicy } from '#/agent/permission/policies/ask-mode-guard-deny';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const ctx = (
  name: string,
  args: Record<string, unknown> = {},
  execution: Record<string, unknown> = {},
): PermissionPolicyContext => {
  const controller = new AbortController();
  return {
    toolCall: { id: 't1', name, arguments: args },
    execution,
    signal: controller.signal,
  } as unknown as PermissionPolicyContext;
};

const policyWith = (isActive: boolean): AskModeGuardDenyPermissionPolicy =>
  new AskModeGuardDenyPermissionPolicy({ askMode: { isActive } } as unknown as Agent);

describe('agent/permission/policies/ask-mode-guard-deny', () => {
  it('has no opinion when ask mode is off', () => {
    const policy = policyWith(false);
    expect(policy.evaluate(ctx('Write'))).toBeUndefined();
    expect(policy.evaluate(ctx('Agent'))).toBeUndefined();
    expect(policy.evaluate(ctx('Bash', { command: 'rm -rf build' }))).toBeUndefined();
  });

  it('allows reading, searching, and web lookups', () => {
    const policy = policyWith(true);
    for (const name of ['Read', 'Grep', 'Glob', 'WebSearch', 'FetchURL', 'SearchSkill']) {
      expect(policy.evaluate(ctx(name)), name).toBeUndefined();
    }
  });

  it('denies edits and other mutating tools', () => {
    const policy = policyWith(true);
    for (const name of ['Write', 'Edit', 'ApplyPatch', 'CronCreate']) {
      expect(policy.evaluate(ctx(name))?.kind, name).toBe('deny');
    }
  });

  it('denies worker delegation, including the read-only-looking TaskOutput', () => {
    const policy = policyWith(true);
    for (const name of ['Agent', 'TaskOutput', 'JobCreate', 'JobSteer', 'CreateGoal']) {
      expect(policy.evaluate(ctx(name))?.kind, name).toBe('deny');
    }
  });

  it('splits Bash by whether the command inspects or changes the workspace', () => {
    const policy = policyWith(true);
    expect(policy.evaluate(ctx('Bash', { command: 'git log --oneline -5' }))).toBeUndefined();
    expect(policy.evaluate(ctx('Bash', { command: 'pnpm install' }))?.kind).toBe('deny');
    expect(policy.evaluate(ctx('Bash', {}))?.kind).toBe('deny');
  });

  it('honours an explicit readOnly declaration on unknown tools', () => {
    const policy = policyWith(true);
    expect(policy.evaluate(ctx('mcp__x__peek', {}, { readOnly: true }))).toBeUndefined();
    expect(policy.evaluate(ctx('mcp__x__poke', {}, { readOnly: false }))?.kind).toBe('deny');
  });
});
