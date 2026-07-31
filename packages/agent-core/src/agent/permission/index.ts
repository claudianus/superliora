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
  PermissionPolicyResolution,
  PermissionPolicyResult,
  PermissionRule,
} from './types';
import { PERMISSION_AUTO_EXPIRE_ENV, STALE_INTERVENTION_AGE_MS } from './types';

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
    if (evaluation === undefined) return undefined;

    this.agent.telemetry.track('permission_policy_decision', {
      policy_name: evaluation.policyName,
      tool_name: context.toolCall.name,
      permission_mode: this.mode,
      decision: evaluation.result.kind,
      ...evaluation.result.reason,
    });
    return this.permissionPolicyResolutionToPrepare(
      evaluation.result,
      context,
      evaluation.policyName,
    );
  }

  private async requestToolApproval(
    context: PermissionPolicyContext,
    result: Extract<PermissionPolicyResult, { kind: 'ask' }>,
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

    let response: ApprovalResponse;
    let requestedApproval = false;
    const queued = this.interventionQueue.enqueue({
      toolName: name,
      rule: context.execution.approvalRule ?? `${name}(*)`,
      risk: display.kind === 'shell' ? 'high' : 'low',
    });
    this.inFlightInterventionIds.add(queued.id);
    this.agent.emitStatusUpdated();
    if (this.agent.rpc?.requestApproval) {
      requestedApproval = true;
      void this.agent.hooks?.fireAndForgetTrigger?.('PermissionRequest', {
        matcherValue: name,
        inputData: {
          turnId: Number(context.turnId),
          toolCallId: id,
          toolName: name,
          action,
          toolInput: context.args,
          display,
        },
      });
      try {
        response = await this.agent.rpc.requestApproval(
          {
            turnId: Number(context.turnId),
            toolCallId: id,
            toolName: name,
            action,
            display,
          },
          { signal },
        );
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
        void this.agent.hooks?.fireAndForgetTrigger?.('PermissionResult', {
          matcherValue: name,
          inputData: {
            turnId: Number(context.turnId),
            toolCallId: id,
            toolName: name,
            action,
            decision: 'error',
            error: error instanceof Error ? error.message : String(error),
          },
        });
        const resolved = result.resolveError?.(error);
        return resolved === undefined
          ? Promise.reject(error)
          : this.permissionPolicyResolutionToPrepare(resolved, context, policyName);
      }
    } else {
      // No RPC approval channel is wired (e.g. a non-interactive host). The
      // safest default is to allow the call so the agent isn't deadlocked,
      // but surface it via telemetry + a debug log so a misconfigured host
      // doesn't silently run in yolo for every `ask` policy.
      this.resolveIntervention(queued.id, 'approved');
      this.agent.telemetry.track('permission_approval_result', {
        policy_name: policyName ?? null,
        tool_name: name,
        permission_mode: this.mode,
        result: 'auto_approved_no_rpc',
        approval_surface: display.kind,
        duration_ms: Date.now() - startedAt,
        session_cache_written: false,
        has_feedback: false,
      });
      this.agent.log?.warn(
        'permission ask auto-approved: no approval RPC channel is connected',
        { toolName: name, policyName: policyName ?? null, permissionMode: this.mode },
      );
      response = {
        decision: 'approved',
      };
    }

    const sessionApprovalRule =
      response.decision === 'approved' && response.scope === 'session'
        ? context.execution.approvalRule
        : undefined;

    if (requestedApproval) {
      const permissionInput = {
        turnId: Number(context.turnId),
        toolCallId: id,
        toolName: name,
        action,
        decision: response.decision,
        scope: response.scope,
        feedback: response.feedback,
        selectedLabel: response.selectedLabel,
      };
      void this.agent.hooks?.fireAndForgetTrigger?.('PermissionResult', {
        matcherValue: name,
        inputData: permissionInput,
      });
      // Claude-canonical deny event (additive; PermissionResult still fires).
      if (response.decision === 'rejected') {
        void this.agent.hooks?.fireAndForgetTrigger?.('PermissionDenied', {
          matcherValue: name,
          inputData: permissionInput,
        });
      }
    }

    this.recordApprovalResult({
      turnId: Number(context.turnId),
      toolCallId: id,
      toolName: name,
      action,
      sessionApprovalRule,
      result: response,
    });
    // Skip the common telemetry when we already emitted the specific
    // auto-approved-no-rpc event above, so it is not double-counted.
    if (requestedApproval) {
      this.agent.telemetry.track('permission_approval_result', {
        policy_name: policyName ?? null,
        tool_name: name,
        permission_mode: this.mode,
        result:
          response.decision === 'approved' && response.scope === 'session'
            ? 'approved_for_session'
            : response.decision,
        approval_surface: display.kind,
        duration_ms: Date.now() - startedAt,
        session_cache_written: sessionApprovalRule !== undefined,
        has_feedback: response.feedback !== undefined && response.feedback.length > 0,
      });
    }

    const resolved = result.resolveApproval?.(response);
    if (resolved !== undefined) {
      return this.permissionPolicyResolutionToPrepare(resolved, context, policyName);
    }

    if (response.decision === 'approved') {
      return undefined;
    }

    return {
      block: true,
      reason: this.formatApprovalRejectionMessage(name, response),
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

  private permissionPolicyResolutionToPrepare(
    result: PermissionPolicyResolution,
    context: PermissionPolicyContext,
    policyName?: string,
  ): Promise<PrepareToolExecutionResult | undefined> | PrepareToolExecutionResult | undefined {
    switch (result.kind) {
      case 'approve':
        return result.executionMetadata === undefined
          ? undefined
          : { executionMetadata: result.executionMetadata };
      case 'deny': {
        const toolName = context.toolCall.name;
        void this.agent.hooks?.fireAndForgetTrigger?.('PermissionDenied', {
          matcherValue: toolName,
          inputData: {
            toolName,
            decision: 'denied',
            policyName: policyName ?? null,
            reason: result.message,
          },
        });
        return {
          block: true,
          reason: result.message ?? this.formatPolicyDenyMessage(toolName),
        };
      }
      case 'ask':
        return this.requestToolApproval(context, result, policyName);
      case 'result': {
        const { kind: _kind, ...prepareResult } = result;
        return prepareResult;
      }
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
    if (this.agent.type === 'sub') {
      return `${prefix}${suffix} Try a different approach — don't retry the same call, don't attempt to bypass the restriction.`;
    }
    if (result.decision === 'rejected') {
      return `${prefix}${suffix} Do not re-attempt the exact same call — think about why it was rejected, then adjust your approach or ask the user what they would prefer.`;
    }
    return `${prefix}${suffix}`;
  }

  private formatPolicyDenyMessage(toolName: string): string {
    const prefix = `Tool "${toolName}" was denied by permission policy.`;
    if (this.agent.type === 'sub') {
      return `${prefix} Try a different approach — don't retry the same call, don't attempt to bypass the restriction.`;
    }
    return prefix;
  }
}

function parsePermissionAutoExpireMs(): number | undefined {
  const raw = process.env[PERMISSION_AUTO_EXPIRE_ENV]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}
