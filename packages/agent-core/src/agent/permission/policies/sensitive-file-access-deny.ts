import type { Agent } from '../..';
import { isSensitiveFile } from '../../../tools/policies/sensitive';
import { fileAccesses } from './file-access-ask';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

/**
 * Non-overridable deny for access to sensitive files (private keys, `.env*`,
 * cloud credential stores) under Auto permission mode.
 *
 * Sits before `AutoModeApprove` and `YoloModeApprove` in the chain. Under
 * `manual` and `yolo`, this policy defers so `SensitiveFileAccessAsk` can ask
 * a human. Under `auto`, that ask would be swallowed by auto-approve, so this
 * policy hard-denies instead.
 */
export class SensitiveFileAccessDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'sensitive-file-access-deny';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    // Hard-block only in auto mode. Manual and yolo fall through to the ask policy.
    if (this.agent.permission.mode !== 'auto') return;
    const access = fileAccesses(context).find((fileAccess) =>
      isSensitiveFile(fileAccess.path),
    );
    if (access === undefined) return;
    return {
      kind: 'deny',
      reason: {
        sensitive_path: true,
        file_access_operation: access.operation,
        recursive: access.recursive === true,
        permission_mode: this.agent.permission.mode,
      },
      message:
        `Blocked access to a sensitive file (${access.path}). ` +
        'Credential and key material cannot be read or written under auto permission mode. ' +
        'Re-run in manual or yolo mode to request approval.',
    };
  }
}
