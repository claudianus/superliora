import type { ResolvedToolExecutionHookContext } from '../../loop';
import type { ToolInputDisplay } from '../../tools/display';

export type PermissionRuleDecision = 'allow' | 'deny' | 'ask';

/**
 * Rule provenance. `session-runtime` stores rules produced by
 * "approve for session"; `turn-override`, `project`, and `user` are
 * reserved for static-loaded rules surfaced by external callers.
 */
export type PermissionRuleScope = 'turn-override' | 'session-runtime' | 'project' | 'user';

/** User-selected posture for native calls not matched by explicit rules. */
export type PermissionMode = 'manual' | 'yolo' | 'auto';

/**
 * A native permission rule, e.g. `Bash(rm *)` or bare `SessionControl`.
 * Arguments match through the native tool's matcher.
 */
export interface PermissionRule {
  readonly decision: PermissionRuleDecision;
  readonly scope: PermissionRuleScope;
  readonly pattern: string;
  readonly reason?: string;
}

export interface ApprovalRequest {
  toolCallId: string;
  toolName: string;
  action: string;
  display: ToolInputDisplay;
}

export interface ApprovalResponse {
  decision: 'approved' | 'rejected' | 'cancelled';
  scope?: 'session';
  feedback?: string;
}

export interface PermissionApprovalResultRecord {
  readonly turnId: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly action: string;
  readonly sessionApprovalRule?: string;
  readonly result: ApprovalResponse;
}

/** Visibility threshold for stale operator intervention badges. */
export const STALE_INTERVENTION_AGE_MS = 120_000;

/** Opt-in: drop orphaned queue entries older than this ms (env-only). */
export const PERMISSION_AUTO_EXPIRE_ENV = 'SUPERLIORA_PERMISSION_AUTO_EXPIRE_MS';

/**
 * Opt-in destructive/sensitive Bash consent guard for `auto` and `yolo`.
 * Manual mode already asks for calls not explicitly granted by the user.
 */
export const PERMISSION_HIGH_RISK_GUARD_ENV = 'SUPERLIORA_PERMISSION_HIGH_RISK_GUARD';

export interface PermissionData {
  mode: PermissionMode;
  rules: PermissionRule[];
  /** Non-blocking approval queue depth while host RPC is pending. */
  pendingInterventions?: number;
  /** Queue entries older than {@link STALE_INTERVENTION_AGE_MS} (visibility only). */
  staleInterventions?: number;
  /** Age in ms of the longest-waiting queued intervention. */
  oldestInterventionAgeMs?: number;
}

export type PermissionDecision = 'approve' | 'deny' | 'ask';

export type PermissionReasonValue = string | number | boolean | null;

type PermissionDecisionReason = Readonly<Record<string, PermissionReasonValue>>;

export interface PermissionPolicyContext extends ResolvedToolExecutionHookContext {}

export type PermissionPolicyResult =
  | {
      readonly kind: 'approve';
      readonly reason?: PermissionDecisionReason;
    }
  | {
      readonly kind: 'deny';
      readonly reason?: PermissionDecisionReason;
      readonly message?: string;
    }
  | {
      readonly kind: 'ask';
      readonly reason?: PermissionDecisionReason;
    };

export interface PermissionPolicy {
  readonly name: string;
  evaluate(
    context: PermissionPolicyContext,
  ): PermissionPolicyResult | undefined | Promise<PermissionPolicyResult | undefined>;
}
