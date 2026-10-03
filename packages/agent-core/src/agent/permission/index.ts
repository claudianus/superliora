import type { Agent } from '..';
import type { PrepareToolExecutionResult } from '../../loop';
import { createPermissionDecisionPolicies } from './policies';
import { NonBlockingPermissionQueue } from './non-blocking-queue';
import type { QueuedPermissionItem } from './non-blocking-queue';
import type {
  ApprovalResponse,
  PermissionApprovalResultRecord,
  PermissionData,
  PermissionMode,
  PermissionPolicy,
  PermissionPolicyContext,
  PermissionPolicyResult,
  PermissionRule,
} from './types';
import {
  PERMISSION_AUTO_EXPIRE_ENV,
  STALE_INTERVENTION_AGE_MS,
} from './types';

export * from './types';
export { NonBlockingPermissionQueue } from './non-blocking-queue';
export type { PermissionQueueSnapshot, QueuedPermissionItem } from './non-blocking-queue';

export interface PermissionManagerOptions {
  readonly initialRules?: readonly PermissionRule[];
  readonly parent?: PermissionManager;
}

interface PolicyEvaluation {
  readonly policyName: string;
  readonly result: PermissionPolicyResult;
}

export class PermissionManager {
  readonly policies: PermissionPolicy[];
  readonly interventionQueue = new NonBlockingPermissionQueue();
  readonly rules: PermissionRule[] = [];
  private modeOverride: PermissionMode | undefined;
  private readonly parent: PermissionManager | undefined;
  private readonly localSessionApprovalRulePatterns = new Set<string>();
  /** Queue ids with an active approval RPC — skipped by opt-in auto-expire. */
  private readonly inFlightInterventionIds = new Set<string>();

  constructor(
    protected readonly agent: Agent,
    options: PermissionManagerOptions = {},
  ) {
    this.rules = [...(options.initialRules ?? [])];
    this.parent = options.parent;
    this.policies = createPermissionDecisionPolicies(this.agent);
  }

  get mode(): PermissionMode {
    // Bare Agent unit paths fall back here; product sessions set mode from config.defaultPermissionMode.
    return this.modeOverride ?? this.parent?.mode ?? 'manual';
  }

  set mode(mode: PermissionMode) {
    this.modeOverride = mode;
  }

  staleInterventionCount(maxAgeMs: number, nowMs = Date.now()): number {
    return this.interventionQueue.snapshot().items.filter(
      (item) => nowMs - item.enqueuedAtMs >= maxAgeMs,
    ).length;
  }

  oldestInterventionAgeMs(nowMs = Date.now()): number | undefined {
    const items = this.interventionQueue.snapshot().items;
    if (items.length === 0) return undefined;
    return Math.max(...items.map((item) => nowMs - item.enqueuedAtMs));
  }

  /** Drop orphaned queue entries when {@link PERMISSION_AUTO_EXPIRE_ENV} is set. */
  touchInterventionQueueForStatus(nowMs = Date.now()): void {
    const maxAgeMs = parsePermissionAutoExpireMs();
    if (maxAgeMs !== undefined) {
      this.interventionQueue.autoExpire(maxAgeMs, nowMs, {
        skipIds: this.inFlightInterventionIds,
      });
    }
  }

  data(): PermissionData {
    const nowMs = Date.now();
    this.touchInterventionQueueForStatus(nowMs);
    const pendingInterventions = this.interventionQueue.snapshot().count;
    const staleInterventions = this.staleInterventionCount(STALE_INTERVENTION_AGE_MS, nowMs);
    const oldestInterventionAgeMs =
      pendingInterventions > 0 ? this.oldestInterventionAgeMs(nowMs) : undefined;
    return {
      mode: this.mode,
      rules: this.effectiveRules,
      ...(pendingInterventions > 0 ? { pendingInterventions } : {}),
      ...(staleInterventions > 0 ? { staleInterventions } : {}),
      ...(oldestInterventionAgeMs !== undefined ? { oldestInterventionAgeMs } : {}),
    };
  }

  setMode(mode: PermissionMode): void {
    this.agent.records.logRecord({
      type: 'permission.set_mode',
      mode,
    });
    this.agent.replayBuilder.push({
      type: 'permission_updated',
      mode,
    });
    this.modeOverride = mode;
    this.agent.emitStatusUpdated();
  }

  recordApprovalResult(record: PermissionApprovalResultRecord): void {
    this.agent.records.logRecord({
      type: 'permission.record_approval_result',
      ...record,
    });
    this.agent.replayBuilder.push({
      type: 'approval_result',
      record,
    });
    if (record.result.decision !== 'approved' || record.result.scope !== 'session') {
      return;
    }
    const pattern = record.sessionApprovalRule;
    if (pattern === undefined) return;
    this.localSessionApprovalRulePatterns.add(pattern);
  }

  get sessionApprovalRulePatterns(): readonly string[] {
    return [
      ...this.localSessionApprovalRulePatterns,
      ...(this.parent?.sessionApprovalRulePatterns ?? []),
    ];
  }

  async beforeToolCall(
    context: PermissionPolicyContext,
  ): Promise<PrepareToolExecutionResult | undefined> {
    const evaluation = await this.evaluatePolicies(context);
    if (context.signal.aborted) {
      return {
        block: true,
        reason: this.formatApprovalRejectionMessage(context.toolCall.name, { decision: 'cancelled' }),
      };
    }
    if (evaluation === undefined) return undefined;

    this.agent.telemetry.track('permission_policy_decision', {
      policy_name: evaluation.policyName,
      tool_name: context.toolCall.name,
      permission_mode: this.mode,
      decision: evaluation.result.kind,
      ...evaluation.result.reason,
    });
    return this.permissionPolicyResultToPrepare(
      evaluation.result,
      context,
      evaluation.policyName,
    );
  }

  private async requestToolApproval(
    context: PermissionPolicyContext,
    policyName: string | undefined,
  ): Promise<PrepareToolExecutionResult | undefined> {
    const { signal } = context;
    const id = context.toolCall.id;
    const name = context.toolCall.name;
    const display =
      context.execution.display ?? {
        kind: 'generic',
        summary: context.execution.description ?? `Approve ${name}`,
        detail: context.args,
      };
    const action = context.execution.description ?? `Call ${name}`;
    const startedAt = Date.now();
    const queued = this.interventionQueue.enqueue({
      toolName: name,
      rule: context.execution.approvalRule ?? name,
      risk: display.kind === 'command' ? 'high' : 'low',
    });
    this.inFlightInterventionIds.add(queued.id);
    this.agent.emitStatusUpdated();

    const requestApproval = this.agent.rpc?.requestApproval;
    let response: ApprovalResponse;
    const missingApprovalChannel = requestApproval === undefined;
    try {
      response = requestApproval === undefined
        ? { decision: 'rejected' }
        : await requestApproval.call(this.agent.rpc, {
            turnId: Number(context.turnId),
            toolCallId: id,
            toolName: name,
            action,
            display,
          }, { signal });
      // Cancellation is not approval. Keep ownership until the handler actually
      // settles, then discard even a late approval on an aborted native call.
      if (signal.aborted) response = { decision: 'cancelled' };
      this.resolveIntervention(
        queued.id,
        response.decision === 'approved' ? 'approved' : 'denied',
      );
    } catch (error) {
      this.resolveIntervention(queued.id, 'denied');
      this.agent.telemetry.track('permission_approval_result', {
        policy_name: policyName ?? null,
        tool_name: name,
        permission_mode: this.mode,
        result: 'error',
        approval_surface: display.kind,
        duration_ms: Date.now() - startedAt,
        session_cache_written: false,
        has_feedback: false,
      });
      throw error;
    }

    const sessionApprovalRule =
      response.decision === 'approved' && response.scope === 'session'
        ? context.execution.approvalRule
        : undefined;
    this.recordApprovalResult({
      turnId: Number(context.turnId),
      toolCallId: id,
      toolName: name,
      action,
      sessionApprovalRule,
      result: response,
    });
    this.agent.telemetry.track('permission_approval_result', {
      policy_name: policyName ?? null,
      tool_name: name,
      permission_mode: this.mode,
      result: missingApprovalChannel
        ? 'auto_denied_no_rpc'
        : response.decision === 'approved' && response.scope === 'session'
          ? 'approved_for_session'
          : response.decision,
      approval_surface: display.kind,
      duration_ms: Date.now() - startedAt,
      session_cache_written: sessionApprovalRule !== undefined,
      has_feedback: response.feedback !== undefined && response.feedback.length > 0,
    });
    if (response.decision === 'approved') return undefined;
    return {
      block: true,
      reason: missingApprovalChannel
        ? `Tool "${name}" was not run: this host has no approval channel connected, so calls that need user confirmation cannot run here.`
        : this.formatApprovalRejectionMessage(name, response),
    };
  }

  private resolveIntervention(
    id: string,
    decision: 'approved' | 'denied',
  ): QueuedPermissionItem | undefined {
    this.inFlightInterventionIds.delete(id);
    const item = this.interventionQueue.resolve(id, decision);
    if (item !== undefined) this.agent.emitStatusUpdated();
    return item;
  }

  private async evaluatePolicies(
    context: PermissionPolicyContext,
  ): Promise<PolicyEvaluation | undefined> {
    for (const policy of this.policies) {
      const result = await policy.evaluate(context);
      if (result !== undefined) {
        return { policyName: policy.name, result };
      }
    }
    return undefined;
  }

  private get effectiveRules(): PermissionRule[] {
    return [...this.rules, ...(this.parent?.effectiveRules ?? [])];
  }

  private permissionPolicyResultToPrepare(
    result: PermissionPolicyResult,
    context: PermissionPolicyContext,
    policyName?: string,
  ): Promise<PrepareToolExecutionResult | undefined> | PrepareToolExecutionResult | undefined {
    switch (result.kind) {
      case 'approve':
        return undefined;
      case 'deny':
        return {
          block: true,
          reason: result.message ?? `Tool "${context.toolCall.name}" was denied by permission policy.`,
        };
      case 'ask':
        return this.requestToolApproval(context, policyName);
    }
  }

  protected formatApprovalRejectionMessage(
    toolName: string,
    result: { decision: 'approved' | 'rejected' | 'cancelled'; feedback?: string },
  ): string {
    const suffix =
      result.feedback !== undefined && result.feedback.length > 0
        ? ` Reason: ${result.feedback}`
        : '';
    const prefix =
      result.decision === 'cancelled'
        ? `Tool "${toolName}" was not run because the approval request was cancelled.`
        : `Tool "${toolName}" was not run because the user rejected the approval request.`;
    return `${prefix}${suffix}`;
  }

}

function parsePermissionAutoExpireMs(): number | undefined {
  const raw = process.env[PERMISSION_AUTO_EXPIRE_ENV]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}
