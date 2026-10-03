import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../src/agent';
import {
  PERMISSION_AUTO_EXPIRE_ENV,
  PERMISSION_HIGH_RISK_GUARD_ENV,
  PermissionManager,
  type ApprovalResponse,
  type PermissionMode,
  type PermissionPolicyContext,
  type PermissionRule,
} from '../../src/agent/permission';
import { ToolAccesses } from '../../src/loop';
import { literalRulePattern, matchesGlobRuleSubject } from '../../src/tools/support/rule-match';

function makeManager(options: {
  mode?: PermissionMode;
  rules?: readonly PermissionRule[];
  parent?: PermissionManager;
  approval?: (request: unknown, options: { signal: AbortSignal }) => Promise<ApprovalResponse>;
  noApprovalChannel?: boolean;
} = {}) {
  const requestApproval = vi.fn(options.approval ?? (async () => ({ decision: 'approved' as const })));
  const record = vi.fn();
  const replay = vi.fn();
  const telemetry = vi.fn();
  const emitStatusUpdated = vi.fn();
  const agent = {
    records: { logRecord: record },
    replayBuilder: { push: replay },
    telemetry: { track: telemetry },
    emitStatusUpdated,
    rpc: options.noApprovalChannel ? undefined : { requestApproval },
  } as unknown as Agent;
  const manager = new PermissionManager(agent, { initialRules: options.rules, parent: options.parent });
  Object.assign(agent, { permission: manager });
  if (options.mode !== undefined) manager.mode = options.mode;
  return { manager, requestApproval, record, replay, telemetry, emitStatusUpdated };
}

function rule(decision: PermissionRule['decision'], pattern: string, scope: PermissionRule['scope'] = 'user'): PermissionRule {
  return { decision, pattern, scope };
}

function context(input: {
  id?: string;
  command?: string;
  operation?: string;
  signal?: AbortSignal;
} = {}): PermissionPolicyContext {
  const name = input.operation === undefined ? 'Bash' : 'SessionControl';
  const command = input.command ?? 'printf hello';
  const args = name === 'Bash' ? { command } : { operation: input.operation };
  const toolCall = { type: 'function' as const, id: input.id ?? 'call_native', name, arguments: JSON.stringify(args) };
  return {
    turnId: '0',
    stepNumber: 1,
    signal: input.signal ?? new AbortController().signal,
    llm: {} as PermissionPolicyContext['llm'],
    toolCall,
    toolCalls: [toolCall],
    args,
    execution: {
      description: name === 'Bash' ? `Running: ${command}` : `Session ${input.operation}`,
      accesses: name === 'Bash' ? ToolAccesses.all() : ToolAccesses.none(),
      approvalRule: name === 'Bash' ? literalRulePattern(name, command) : name,
      ...(name === 'Bash' ? {
        display: { kind: 'command' as const, command, cwd: '/workspace', language: 'bash' as const },
        matchesRule: (pattern: string) => matchesGlobRuleSubject(pattern, command),
      } : {}),
      execute: async () => ({ output: '' }),
    },
  };
}

function grant(manager: PermissionManager, pattern: string) {
  manager.recordApprovalResult({
    turnId: 0,
    toolCallId: 'prior',
    toolName: pattern.startsWith('Bash') ? 'Bash' : 'SessionControl',
    action: 'Approved native call',
    sessionApprovalRule: pattern,
    result: { decision: 'approved', scope: 'session' },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Native user permission precedence', () => {
  it.each(['manual', 'auto', 'yolo'] as const)('keeps deny above ask, allow, session history, and %s mode', async (mode) => {
    const { manager, requestApproval } = makeManager({ mode, rules: [
      rule('allow', 'Bash'), rule('ask', 'Bash'), rule('deny', 'Bash'),
    ] });
    grant(manager, 'Bash');
    await expect(manager.beforeToolCall(context())).resolves.toMatchObject({ block: true });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it.each(['manual', 'auto', 'yolo'] as const)('keeps explicit ask above allow and %s mode approval', async (mode) => {
    const { manager, requestApproval } = makeManager({ mode, rules: [rule('allow', '*'), rule('ask', 'Bash')] });
    await expect(manager.beforeToolCall(context())).resolves.toBeUndefined();
    expect(requestApproval).toHaveBeenCalledOnce();
  });

  it.each(['turn-override', 'project', 'user'] as const)('honors user rules in %s scope', async (scope) => {
    const { manager, requestApproval } = makeManager({ rules: [rule('allow', 'Bash(printf *)', scope)] });
    await expect(manager.beforeToolCall(context())).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('does not apply a command grant to a different command', async () => {
    const { manager, requestApproval } = makeManager({ rules: [rule('allow', 'Bash(printf *)')] });
    await manager.beforeToolCall(context({ command: 'git status' }));
    expect(requestApproval).toHaveBeenCalledOnce();
  });

  it('reads live mode and rules without reconstructing the manager', async () => {
    const { manager, requestApproval, record, replay } = makeManager();
    manager.setMode('yolo');
    await expect(manager.beforeToolCall(context())).resolves.toBeUndefined();
    expect(record).toHaveBeenCalledWith({ type: 'permission.set_mode', mode: 'yolo' });
    expect(replay).toHaveBeenCalledWith({ type: 'permission_updated', mode: 'yolo' });
    manager.rules.push(rule('ask', 'Bash'));
    await manager.beforeToolCall(context());
    expect(requestApproval).toHaveBeenCalledOnce();
  });

  it.each(['spawn', 'stop', 'compact', 'message', 'wait', 'list'])('uses only native user consent for SessionControl %s', async (operation) => {
    const { manager, requestApproval } = makeManager({ rules: [rule('allow', 'SessionControl')] });
    await expect(manager.beforeToolCall(context({ operation }))).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
    manager.rules.push(rule('ask', 'SessionControl'));
    await manager.beforeToolCall(context({ operation }));
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(manager.mode).toBe('manual');
  });

  it.each(['auto', 'yolo'] as const)('honors user-selected %s for unmatched SessionControl calls', async (mode) => {
    const { manager, requestApproval } = makeManager({ mode });
    for (const operation of ['spawn', 'stop', 'compact', 'message']) {
      await expect(manager.beforeToolCall(context({ operation }))).resolves.toBeUndefined();
    }
    expect(requestApproval).not.toHaveBeenCalled();
  });
});

describe('Native session approval history', () => {
  it('reuses an actual session grant above matching ask without widening its command', async () => {
    const { manager, requestApproval, record, replay } = makeManager({
      rules: [rule('ask', 'Bash')],
      approval: async () => ({ decision: 'approved', scope: 'session' }),
    });
    await manager.beforeToolCall(context());
    await manager.beforeToolCall(context());
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ type: 'permission.record_approval_result', sessionApprovalRule: 'Bash(printf hello)' }));
    expect(replay).toHaveBeenCalledWith(expect.objectContaining({ type: 'approval_result' }));
    await manager.beforeToolCall(context({ command: 'printf other' }));
    expect(requestApproval).toHaveBeenCalledTimes(2);
  });

  it('does not cache one-call approvals or rejections', async () => {
    const { manager, requestApproval } = makeManager({ approval: async () => ({ decision: 'approved' }) });
    await manager.beforeToolCall(context());
    await manager.beforeToolCall(context());
    expect(requestApproval).toHaveBeenCalledTimes(2);
    expect(manager.sessionApprovalRulePatterns).toEqual([]);
    manager.recordApprovalResult({ turnId: 0, toolCallId: 'rejected', toolName: 'Bash', action: 'Native call', sessionApprovalRule: 'Bash', result: { decision: 'rejected', scope: 'session' } });
    expect(manager.sessionApprovalRulePatterns).toEqual([]);
  });

  it('inherits live parent mode, static rules, and grants without leaking child grants upward', async () => {
    const parent = makeManager({ rules: [rule('ask', 'Bash')] }).manager;
    const { manager: child, requestApproval } = makeManager({ parent });
    parent.mode = 'yolo';
    expect(child.mode).toBe('yolo');
    grant(parent, 'Bash(printf hello)');
    await expect(child.beforeToolCall(context())).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
    grant(child, 'SessionControl');
    expect(parent.sessionApprovalRulePatterns).not.toContain('SessionControl');
    parent.rules.push(rule('deny', 'Bash'));
    await expect(child.beforeToolCall(context())).resolves.toMatchObject({ block: true });
    child.mode = 'manual';
    parent.mode = 'auto';
    expect(child.mode).toBe('manual');
  });

  it('escapes command metacharacters in session grants rather than broadening permission', async () => {
    const { manager, requestApproval } = makeManager({ approval: async () => ({ decision: 'approved', scope: 'session' }) });
    await manager.beforeToolCall(context({ command: 'printf "*"' }));
    await manager.beforeToolCall(context({ command: 'printf "danger"' }));
    expect(requestApproval).toHaveBeenCalledTimes(2);
  });
});

describe('Operator consent settlement', () => {
  it('fails closed without an approval handler even if the retired bypass environment is set', async () => {
    vi.stubEnv('SUPERLIORA_PERMISSION_ALLOW_WITHOUT_APPROVAL', '1');
    const { manager, requestApproval } = makeManager({ noApprovalChannel: true });
    await expect(manager.beforeToolCall(context())).resolves.toMatchObject({ block: true, reason: expect.stringContaining('no approval channel') });
    expect(requestApproval).not.toHaveBeenCalled();
    expect(manager.interventionQueue.pendingCount()).toBe(0);
    expect(manager.sessionApprovalRulePatterns).toEqual([]);
  });

  it('propagates approval failure and settles the queue without granting permission', async () => {
    const error = new Error('approval transport failed');
    const { manager, telemetry } = makeManager({ approval: async () => { throw error; } });
    await expect(manager.beforeToolCall(context())).rejects.toBe(error);
    expect(manager.interventionQueue.pendingCount()).toBe(0);
    expect(manager.sessionApprovalRulePatterns).toEqual([]);
    expect(telemetry).toHaveBeenCalledWith('permission_approval_result', expect.objectContaining({ result: 'error', session_cache_written: false }));
  });

  it.each(['rejected', 'cancelled'] as const)('blocks a %s response and preserves operator feedback', async (decision) => {
    const { manager } = makeManager({ approval: async () => ({ decision, feedback: 'Do not run this.' }) });
    await expect(manager.beforeToolCall(context())).resolves.toMatchObject({ block: true, reason: expect.stringContaining('Do not run this.') });
    expect(manager.interventionQueue.pendingCount()).toBe(0);
  });

  it('does not release pending consent on abort before the underlying handler settles', async () => {
    const approval = Promise.withResolvers<ApprovalResponse>();
    const entered = Promise.withResolvers<void>();
    const controller = new AbortController();
    const { manager, emitStatusUpdated, requestApproval } = makeManager({ approval: async () => { entered.resolve(); return approval.promise; } });
    const pending = manager.beforeToolCall(context({ signal: controller.signal }));
    await entered.promise;
    expect(manager.interventionQueue.pendingCount()).toBe(1);
    controller.abort();
    expect(manager.interventionQueue.pendingCount()).toBe(1);
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'Bash' }), { signal: controller.signal });
    approval.resolve({ decision: 'approved', scope: 'session' });
    await expect(pending).resolves.toMatchObject({ block: true, reason: expect.stringContaining('cancelled') });
    expect(manager.interventionQueue.pendingCount()).toBe(0);
    expect(manager.sessionApprovalRulePatterns).toEqual([]);
    expect(emitStatusUpdated).toHaveBeenCalledTimes(2);
  });

  it('blocks an already-aborted call before prompting even in an approving mode', async () => {
    const controller = new AbortController();
    controller.abort();
    const { manager, requestApproval } = makeManager({ mode: 'yolo' });
    await expect(manager.beforeToolCall(context({ signal: controller.signal }))).resolves.toMatchObject({ block: true });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it('keeps separate native calls queued and resolves only their own consent', async () => {
    const approvals = [Promise.withResolvers<ApprovalResponse>(), Promise.withResolvers<ApprovalResponse>()];
    const entered = Promise.withResolvers<void>();
    let count = 0;
    const { manager } = makeManager({ approval: async () => {
      const approval = approvals[count++]!;
      if (count === 2) entered.resolve();
      return approval.promise;
    } });
    const first = manager.beforeToolCall(context({ id: 'one' }));
    const second = manager.beforeToolCall(context({ id: 'two', operation: 'stop' }));
    await entered.promise;
    expect(manager.interventionQueue.pendingCount()).toBe(2);
    approvals[0]!.resolve({ decision: 'approved' });
    await expect(first).resolves.toBeUndefined();
    expect(manager.interventionQueue.pendingCount()).toBe(1);
    approvals[1]!.resolve({ decision: 'rejected' });
    await expect(second).resolves.toMatchObject({ block: true });
    expect(manager.interventionQueue.pendingCount()).toBe(0);
  });

  it('never auto-expires an in-flight approval', async () => {
    vi.stubEnv(PERMISSION_AUTO_EXPIRE_ENV, '1');
    const approval = Promise.withResolvers<ApprovalResponse>();
    const entered = Promise.withResolvers<void>();
    const { manager } = makeManager({ approval: async () => { entered.resolve(); return approval.promise; } });
    const pending = manager.beforeToolCall(context());
    await entered.promise;
    manager.touchInterventionQueueForStatus(Date.now() + 100_000);
    expect(manager.interventionQueue.pendingCount()).toBe(1);
    approval.resolve({ decision: 'approved' });
    await pending;
    expect(manager.interventionQueue.pendingCount()).toBe(0);
  });
});

describe('Native Bash unsafe-command consent boundary', () => {
  it.each(['auto', 'yolo'] as const)('applies the enabled destructive guard before %s approval', async (mode) => {
    vi.stubEnv(PERMISSION_HIGH_RISK_GUARD_ENV, '1');
    const { manager, requestApproval, telemetry } = makeManager({ mode, approval: async () => ({ decision: 'rejected' }) });
    await expect(manager.beforeToolCall(context({ command: 'rm -rf /tmp/output' }))).resolves.toMatchObject({ block: true });
    expect(requestApproval).toHaveBeenCalledOnce();
    expect(telemetry).toHaveBeenCalledWith('permission_policy_decision', expect.objectContaining({ policy_name: 'yolo-high-risk-ask', risk: 'recursive force delete' }));
  });

  it('fails closed when sensitive-command consent cannot be presented', async () => {
    vi.stubEnv(PERMISSION_HIGH_RISK_GUARD_ENV, '1');
    const { manager } = makeManager({ mode: 'auto', noApprovalChannel: true });
    await expect(manager.beforeToolCall(context({ command: 'cat /home/user/.aws/credentials' }))).resolves.toMatchObject({ block: true });
  });

  it('preserves an explicit native grant rather than introducing forced approval', async () => {
    vi.stubEnv(PERMISSION_HIGH_RISK_GUARD_ENV, '1');
    const { manager, requestApproval } = makeManager({ mode: 'auto', rules: [rule('allow', 'Bash(rm -rf /tmp/output)')] });
    await expect(manager.beforeToolCall(context({ command: 'rm -rf /tmp/output' }))).resolves.toBeUndefined();
    expect(requestApproval).not.toHaveBeenCalled();
  });
});
