import type { Agent } from '../..';
import type { PermissionPolicy } from '../types';
import { AutoModeApprovePermissionPolicy } from './auto-mode-approve';
import { FallbackAskPermissionPolicy } from './fallback-ask';
import { SessionApprovalHistoryPermissionPolicy } from './session-approval-history';
import {
  UserConfiguredAllowPermissionPolicy,
  UserConfiguredAskPermissionPolicy,
  UserConfiguredDenyPermissionPolicy,
} from './user-configured-rules';
import { YoloHighRiskAskPermissionPolicy } from './yolo-high-risk-ask';
import { YoloModeApprovePermissionPolicy } from './yolo-mode-approve';

/** First matching policy wins; native user rules apply in every permission mode. */
export function createPermissionDecisionPolicies(agent: Agent): PermissionPolicy[] {
  return [
    new UserConfiguredDenyPermissionPolicy(agent),
    // An explicit session grant overrides a matching ask, never a deny.
    new SessionApprovalHistoryPermissionPolicy(agent),
    new UserConfiguredAskPermissionPolicy(agent),
    new UserConfiguredAllowPermissionPolicy(agent),
    // The optional destructive/sensitive Bash guard must precede both mode approvals.
    new YoloHighRiskAskPermissionPolicy(agent),
    new AutoModeApprovePermissionPolicy(agent),
    new YoloModeApprovePermissionPolicy(agent),
    new FallbackAskPermissionPolicy(),
  ];
}
