import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import {
  GitControlPathAccessAskPermissionPolicy,
  SensitiveFileAccessAskPermissionPolicy,
  fileAccesses,
  writeFileAccesses,
} from '#/agent/permission/policies/file-access-ask';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const ctx = (name: string, execution?: unknown): PermissionPolicyContext => {
  const controller = new AbortController();
  return {
    toolCall: { id: 't1', name, arguments: {} },
    signal: controller.signal,
    execution,
  } as PermissionPolicyContext;
};

describe('agent/permission/policies/file-access-ask — names', () => {
  it('SensitiveFileAccessAskPermissionPolicy uses the documented policy name', () => {
    const policy = new SensitiveFileAccessAskPermissionPolicy();
    expect(policy.name).toBe('sensitive-file-access-ask');
  });

  it('GitControlPathAccessAskPermissionPolicy uses the documented policy name', () => {
    const policy = new GitControlPathAccessAskPermissionPolicy({} as Agent);
    expect(policy.name).toBe('git-control-path-access-ask');
  });
});

describe('agent/permission/policies/file-access-ask — fileAccesses()', () => {
  it('returns an empty array when execution is missing', () => {
    expect(fileAccesses(ctx('Bash', {}))).toEqual([]);
  });

  it('returns an empty array when execution.accesses is missing', () => {
    expect(fileAccesses(ctx('Bash', {}))).toEqual([]);
  });

  it('keeps only file-kind entries', () => {
    const ctxWithMixed = ctx('Bash', {
      accesses: [
        { kind: 'file', path: '/a.txt', operation: 'read' },
        { kind: 'network', path: 'https://example.com' },
        { kind: 'file', path: '/b.txt', operation: 'write' },
      ],
    });
    const result = fileAccesses(ctxWithMixed);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.path).sort()).toEqual(['/a.txt', '/b.txt']);
  });
});

describe('agent/permission/policies/file-access-ask — writeFileAccesses()', () => {
  it('keeps only write + readwrite operations', () => {
    const ctxWithMixed = ctx('Bash', {
      accesses: [
        { kind: 'file', path: '/r.txt', operation: 'read' },
        { kind: 'file', path: '/w.txt', operation: 'write' },
        { kind: 'file', path: '/rw.txt', operation: 'readwrite' },
      ],
    });
    const result = writeFileAccesses(ctxWithMixed);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.path).sort()).toEqual(['/rw.txt', '/w.txt']);
  });

  it('returns [] when no execution.accesses', () => {
    expect(writeFileAccesses(ctx('Bash', {}))).toEqual([]);
  });
});

describe('agent/permission/policies/file-access-ask — GitControlPathAccessAsk.evaluate', () => {
  it('returns undefined when cwd is empty', async () => {
    const policy = new GitControlPathAccessAskPermissionPolicy({
      config: { cwd: '' },
    } as unknown as Agent);
    const result = await policy.evaluate(ctx('Bash', {}));
    expect(result).toBeUndefined();
  });

  it('returns undefined when there are no file accesses', async () => {
    const policy = new GitControlPathAccessAskPermissionPolicy({
      config: { cwd: '/home/me/proj' },
      kaos: { pathClass: () => 'posix' },
    } as unknown as Agent);
    const result = await policy.evaluate(ctx('Bash', { accesses: [] }));
    expect(result).toBeUndefined();
  });
});
