import { describe, expect, it } from 'vitest';

import { fileAccesses } from '#/agent/permission/policies/file-access-ask';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const ctx = (accesses: unknown): PermissionPolicyContext =>
  ({ toolCall: { id: 't1', name: 'Read', arguments: {} }, execution: { toolName: 'Read', accesses } } as unknown as PermissionPolicyContext);

describe('agent/permission/policies/file-access-ask — fileAccesses', () => {
  it('returns an empty list when execution.accesses is undefined', () => {
    expect(fileAccesses(ctx(undefined))).toEqual([]);
  });

  it('returns an empty list when accesses is an empty array', () => {
    expect(fileAccesses(ctx([]))).toEqual([]);
  });

  it('filters out non-file access kinds', () => {
    const accesses = [
      { kind: 'file', operation: 'read', path: '/work/.env' },
      { kind: 'all' },
      { kind: 'http', method: 'GET', url: 'https://example.com' },
    ] as never;
    expect(fileAccesses(ctx(accesses))).toEqual([
      { kind: 'file', operation: 'read', path: '/work/.env' },
    ]);
  });

  it('passes file accesses through verbatim (no path-type filter)', () => {
    const accesses = [
      { kind: 'file', operation: 'read', path: '/work/.env' },
      { kind: 'file', operation: 'read', path: 7 },
      { kind: 'file', operation: 'read' },
    ] as never;
    expect(fileAccesses(ctx(accesses))).toEqual(accesses);
  });
});
