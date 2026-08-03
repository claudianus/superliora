import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { AutoModeAskUserQuestionDenyPermissionPolicy } from '#/agent/permission/policies/auto-mode-ask-user-question-deny';
import { GitCwdWriteApprovePermissionPolicy } from '#/agent/permission/policies/git-cwd-write-approve';
import { YoloModeApprovePermissionPolicy } from '#/agent/permission/policies/yolo-mode-approve';
import type { PermissionPolicyContext } from '#/agent/permission/types';

const ctx = (name: string): PermissionPolicyContext =>
  ({ toolCall: { id: 't1', name, arguments: {} } }) as PermissionPolicyContext;

describe('agent/permission/policies/yolo-mode-approve', () => {
  it('uses the documented policy name', () => {
    const policy = new YoloModeApprovePermissionPolicy({} as Agent);
    expect(policy.name).toBe('yolo-mode-approve');
  });
});

describe('agent/permission/policies/auto-mode-ask-user-question-deny', () => {
  it('uses the documented policy name', () => {
    const policy = new AutoModeAskUserQuestionDenyPermissionPolicy({} as Agent);
    expect(policy.name).toBe('auto-mode-ask-user-question-deny');
  });

  it('evaluate() returns undefined (historical no-op)', () => {
    const policy = new AutoModeAskUserQuestionDenyPermissionPolicy({} as Agent);
    expect(policy.evaluate(ctx('AskUserQuestion'))).toBeUndefined();
  });
});

describe('agent/permission/policies/git-cwd-write-approve', () => {
  it('uses the documented policy name', () => {
    const policy = new GitCwdWriteApprovePermissionPolicy({} as Agent);
    expect(policy.name).toBe('git-cwd-write-approve');
  });
});
