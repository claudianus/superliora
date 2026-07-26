import { describe, expect, it } from 'vitest';

import { SensitiveFileAccessDenyPermissionPolicy } from '#/agent/permission/policies/sensitive-file-access-deny';
import type { Agent } from '#/agent';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const autoAgent = (): Agent => ({ permission: { mode: 'auto' } }) as unknown as Agent;

const fileContext = (
  path: string,
  operation: 'read' | 'write' | 'readwrite' = 'read',
): PermissionPolicyContext => ({
  toolCall: { id: 't1', name: 'Read', arguments: {} },
  execution: {
    toolName: 'Read',
    accesses: [{ kind: 'file', operation, path }],
  },
} as unknown as PermissionPolicyContext);

describe('agent/permission/policies/sensitive-file-access-deny', () => {
  it('denies access to a .env file in the working directory (auto mode)', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(autoAgent());
    const decision = policy.evaluate(fileContext('/work/.env'));
    expect(decision).toMatchObject({ kind: 'deny' });
  });

  it('denies access to a file inside ~/.ssh (auto mode)', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(autoAgent());
    const decision = policy.evaluate(fileContext('/Users/me/.ssh/id_rsa'));
    expect(decision).toMatchObject({ kind: 'deny' });
  });

  it('denies access to a file inside .aws/ (auto mode)', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(autoAgent());
    const decision = policy.evaluate(fileContext('/Users/me/.aws/credentials'));
    expect(decision).toMatchObject({ kind: 'deny' });
  });

  it('returns undefined for an ordinary source file (auto mode)', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(autoAgent());
    expect(policy.evaluate(fileContext('/work/src/index.ts'))).toBeUndefined();
  });

  it('returns undefined when no accesses are declared (auto mode)', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(autoAgent());
    const ctx = {
      toolCall: { id: 't1', name: 'Bash', arguments: {} },
      execution: { toolName: 'Bash', accesses: [] },
    } as unknown as PermissionPolicyContext;
    expect(policy.evaluate(ctx)).toBeUndefined();
  });

  it('uses the documented policy name', () => {
    expect(new SensitiveFileAccessDenyPermissionPolicy(autoAgent()).name).toBe(
      'sensitive-file-access-deny',
    );
  });
});
