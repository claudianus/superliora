import type { Agent } from '../..';
import { isSensitiveFile } from '../../../tools/policies/sensitive';
import { fileAccesses } from './file-access-ask';
import type { PermissionPolicy, PermissionPolicyContext, PermissionPolicyResult } from '../types';

/**
 * Non-overridable deny for access to sensitive files (private keys, `.env*`,
 * cloud credential stores) when a permissive permission mode would otherwise
 * bypass the manual-approval check.
 *
 * Sits before `AutoModeApprove` and `YoloModeApprove` in the chain. Under
 * `manual` mode the earlier-on-the-path `SensitiveFileAccessAskPolicy` would
 * already ask the user — but under `auto`/`yolo` that ask is swallowed and
 * credential exfiltration via a prompt-injected model becomes possible. This
 * policy closes that gap: in `auto`/`yolo` it hard-denies; in `manual` it
 * defers so the existing ask still runs and a human can legitimately review a
 * `.env` edit.
 */
export class SensitiveFileAccessDenyPermissionPolicy implements PermissionPolicy {
  readonly name = 'sensitive-file-access-deny';

  constructor(private readonly agent: Agent) {}

  evaluate(context: PermissionPolicyContext): PermissionPolicyResult | undefined {
    // Only hard-block in permissive modes. In manual mode, let the ask policy
    // handle it so the user can still approve a legitimate credential edit.
    if (this.agent.permission.mode === 'manual') return;
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
        'Credential and key material cannot be read or written under an ' +
        'auto-approved permission mode. Re-run in manual mode to request approval.',
    };
  }
}
