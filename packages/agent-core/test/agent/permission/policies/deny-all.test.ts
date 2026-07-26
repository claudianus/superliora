import { describe, expect, it } from 'vitest';

import { DenyAllPermissionPolicy } from '#/agent/permission/policies/deny-all';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const makeContext = (name = 'Bash'): PermissionPolicyContext =>
  ({ toolCall: { id: 't1', name, arguments: {} } }) as PermissionPolicyContext;

describe('agent/permission/policies/deny-all', () => {
  it('always denies every tool call', () => {
    const policy = new DenyAllPermissionPolicy();
    expect(policy.evaluate(makeContext('Bash'))).toMatchObject({ kind: 'deny' });
    expect(policy.evaluate(makeContext('Read'))).toMatchObject({ kind: 'deny' });
    expect(policy.evaluate(makeContext('Write'))).toMatchObject({ kind: 'deny' });
  });

  it('uses the documented policy name', () => {
    expect(new DenyAllPermissionPolicy().name).toBe('deny-all');
  });

  it('does not throw on undefined context', () => {
    const policy = new DenyAllPermissionPolicy();
    expect(policy.evaluate(undefined as never)).toMatchObject({ kind: 'deny' });
  });
});
