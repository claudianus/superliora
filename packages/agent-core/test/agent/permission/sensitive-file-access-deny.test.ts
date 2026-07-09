import { describe, expect, it } from 'vitest';

import type { Agent } from '../../../src/agent';
import { SensitiveFileAccessDenyPermissionPolicy } from '../../../src/agent/permission/policies/sensitive-file-access-deny';
import type { PermissionPolicyContext } from '../../../src/agent/permission/types';
import { ToolAccesses } from '../../../src/loop';

const signal = new AbortController().signal;

function contextWithFileAccess(path: string, operation: 'read' | 'write' = 'read'): PermissionPolicyContext {
  return {
    turnId: '0',
    stepNumber: 1,
    signal,
    llm: {},
    args: { path },
    toolCall: {
      type: 'function',
      id: 'call_test',
      name: 'Read',
      arguments: JSON.stringify({ path }),
    },
    toolCalls: [
      {
        type: 'function',
        id: 'call_test',
        name: 'Read',
        arguments: JSON.stringify({ path }),
      },
    ],
    execution: {
      accesses: ToolAccesses.file(operation, path),
      approvalRule: 'Read',
      execute: async () => ({ output: '' }),
    },
  } as unknown as PermissionPolicyContext;
}

function agentWithMode(mode: 'manual' | 'auto' | 'yolo'): Agent {
  return { permission: { mode } } as unknown as Agent;
}

describe('SensitiveFileAccessDenyPermissionPolicy', () => {
  it('denies sensitive-file read under auto mode', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(agentWithMode('auto'));
    expect(policy.evaluate(contextWithFileAccess('.env'))).toMatchObject({
      kind: 'deny',
      reason: { sensitive_path: true, permission_mode: 'auto' },
    });
  });

  it('denies sensitive-file read under yolo mode', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(agentWithMode('yolo'));
    expect(policy.evaluate(contextWithFileAccess('/home/u/.ssh/config'))).toMatchObject({
      kind: 'deny',
      reason: { sensitive_path: true, permission_mode: 'yolo' },
    });
  });

  it('denies sensitive-file write under auto mode', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(agentWithMode('auto'));
    expect(policy.evaluate(contextWithFileAccess('.aws/credentials', 'write'))).toMatchObject({
      kind: 'deny',
    });
  });

  it('defers (returns undefined) under manual mode so the ask policy runs', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(agentWithMode('manual'));
    expect(policy.evaluate(contextWithFileAccess('.env'))).toBeUndefined();
  });

  it('defers for non-sensitive files under auto mode', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(agentWithMode('auto'));
    expect(policy.evaluate(contextWithFileAccess('src/config.ts'))).toBeUndefined();
  });

  it('defers for env exemplars under auto mode', () => {
    const policy = new SensitiveFileAccessDenyPermissionPolicy(agentWithMode('auto'));
    expect(policy.evaluate(contextWithFileAccess('.env.example'))).toBeUndefined();
  });
});
