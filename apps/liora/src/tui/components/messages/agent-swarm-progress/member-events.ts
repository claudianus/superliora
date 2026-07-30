import type { TodoItem } from '#/tui/components/chrome/todo-panel';
import {
  AgentSwarmProgressEstimator,
} from '#/tui/components/messages/agent-swarm-progress-estimator';
import type { ColorPalette } from '#/tui/theme/colors';
import { collapseWhitespace, isTerminalPhase } from '#/tui/utils/agent-swarm-cell-render';
import {
  applyAgentSwarmMemberCancelled,
  applyAgentSwarmMemberCompleted,
  applyAgentSwarmMemberFailed,
  createAgentSwarmMembers,
  findAgentSwarmMemberByAgentId,
  promoteAgentSwarmMemberToRunning,
  resolveAgentSwarmMemberForSubagent,
  TERMINAL_CLEAR_KEYS,
  clearAgentSwarmMemberState,
} from '#/tui/utils/agent-swarm-member-state';
import { AGENT_SWARM_MAX_LATEST_MODEL_CHARS } from '#/tui/utils/agent-swarm-progress-constants';
import type { AgentSwarmMember } from '#/tui/utils/agent-swarm-progress-types';
import {
  parseAgentSwarmResultStatuses,
  parseUltraSwarmIntegrationReport,
  type UltraSwarmIntegrationReport,
} from '#/tui/utils/agent-swarm-result-parser';

export interface AgentSwarmProgressMemberRuntime {
  members: AgentSwarmMember[];
  inputComplete: boolean;
  failed: boolean;
  aborted: boolean;
  swarmStartedAtMs: number | undefined;
  integrationReport: UltraSwarmIntegrationReport | undefined;
}

/**
 * SDK-event-driven member lifecycle for `AgentSwarmProgressComponent`: subagent
 * registration, tool/model activity, terminal transitions, and result apply.
 */
export class AgentSwarmProgressMemberEvents {
  constructor(
    private readonly runtime: AgentSwarmProgressMemberRuntime,
    private readonly progressEstimator: AgentSwarmProgressEstimator,
    private readonly getColors: () => ColorPalette,
  ) {}

  get members(): AgentSwarmMember[] {
    return this.runtime.members;
  }

  markInputComplete(): void {
    if (!this.runtime.inputComplete) {
      this.runtime.inputComplete = true;
      this.ensureSwarmStartedAt(Date.now());
      for (const member of this.runtime.members) {
        if (member.phase === 'pending') member.phase = 'queued';
      }
    }
  }

  registerSubagent(input: {
    readonly agentId: string;
    readonly swarmIndex?: number;
    readonly description?: string | undefined;
    readonly modelAlias?: string | undefined;
  }): void {
    const member = resolveAgentSwarmMemberForSubagent(
      () => this.runtime.members,
      input.agentId,
      input.swarmIndex,
      (count) => this.ensureMemberCount(count),
    );
    if (member === undefined) return;
    member.agentId = input.agentId;
    if (input.modelAlias !== undefined) {
      const alias = collapseWhitespace(input.modelAlias);
      if (alias.length > 0) member.modelAlias = alias;
    }
    if (member.phase === 'pending') member.phase = 'queued';
  }

  markStarted(agentId: string): void {
    const member = findAgentSwarmMemberByAgentId(this.runtime.members, agentId);
    if (member === undefined) return;
    const nowMs = Date.now();
    this.progressEstimator.markStarted(member.id, nowMs);
    member.startedAtMs ??= nowMs;
    member.ticks = Math.max(member.ticks, 1);
    this.promoteToRunning(member, nowMs);
  }

  applyMemberTodos(agentId: string, todos: readonly TodoItem[]): void {
    const member = findAgentSwarmMemberByAgentId(this.runtime.members, agentId);
    if (member === undefined) return;
    member.todos = todos.map((todo) => ({ title: todo.title, status: todo.status }));
  }

  recordToolCall(input: {
    readonly agentId: string;
    readonly toolCallId: string;
    readonly toolName?: string;
    readonly toolDescription?: string;
  }): void {
    const member = findAgentSwarmMemberByAgentId(this.runtime.members, input.agentId);
    if (member === undefined) return;
    const result = this.progressEstimator.recordToolCall({
      memberKey: member.id,
      toolCallId: input.toolCallId,
      nowMs: Date.now(),
    });
    if (!result.accepted) return;
    member.ticks = result.rawTicks;
    if (input.toolName !== undefined && input.toolName.length > 0) {
      member.activeToolName = input.toolName;
    }
    this.promoteToRunning(member);
  }

  recordToolResult(input: {
    readonly agentId: string;
    readonly toolCallId: string;
    readonly isError?: boolean;
    readonly summary?: string;
  }): void {
    const member = findAgentSwarmMemberByAgentId(this.runtime.members, input.agentId);
    if (member === undefined) return;
    delete member.activeToolName;
    member.ticks += 1;
    if (input.summary !== undefined && input.summary.length > 0) {
      const prefix = input.isError === true ? '⚠ ' : '';
      const line = `${prefix}${input.summary}`.slice(0, AGENT_SWARM_MAX_LATEST_MODEL_CHARS);
      member.latestModelText = line;
    }
    this.promoteToRunning(member);
  }

  appendModelDelta(input: {
    readonly agentId: string;
    readonly delta: string;
  }): void {
    const member = findAgentSwarmMemberByAgentId(this.runtime.members, input.agentId);
    if (member === undefined || input.delta.length === 0) return;
    delete member.activeToolName;
    member.latestModelText = `${member.latestModelText}${input.delta}`.slice(
      -AGENT_SWARM_MAX_LATEST_MODEL_CHARS,
    );
    this.promoteToRunning(member, Date.now(), true);
  }

  markCompleted(agentId: string, completedText?: string): void {
    const member = findAgentSwarmMemberByAgentId(this.runtime.members, agentId);
    if (member === undefined || member.phase === 'failed' || member.phase === 'cancelled') return;
    this.completeMember(member, Date.now(), completedText);
  }

  markSuspended(input: {
    readonly agentId: string;
    readonly reason: string;
    readonly swarmIndex?: number;
    readonly description?: string | undefined;
  }): void {
    const member = findAgentSwarmMemberByAgentId(this.runtime.members, input.agentId) ??
      resolveAgentSwarmMemberForSubagent(
        () => this.runtime.members,
        input.agentId,
        input.swarmIndex,
        (count) => this.ensureMemberCount(count),
      );
    if (member === undefined || member.phase === 'completed' || member.phase === 'cancelled') return;
    member.agentId = input.agentId;
    this.progressEstimator.markQueued(member.id, Date.now());
    member.phase = 'suspended';
    clearAgentSwarmMemberState(member, ...TERMINAL_CLEAR_KEYS);
  }

  markFailed(
    agentId: string,
    failureText?: string,
    meta?: { readonly retryNote?: string | undefined },
  ): void {
    const member = findAgentSwarmMemberByAgentId(this.runtime.members, agentId);
    if (member === undefined) return;
    this.failMember(member, Date.now(), failureText, meta?.retryNote);
  }

  markSwarmFailed(failureText?: string): void {
    this.runtime.failed = true;
    this.runtime.aborted = false;
    const nowMs = Date.now();
    for (const member of this.runtime.members) {
      if (isTerminalPhase(member.phase)) continue;
      this.failMember(member, nowMs, failureText);
    }
  }

  markCancelled(agentId: string): void {
    const member = findAgentSwarmMemberByAgentId(this.runtime.members, agentId);
    if (member === undefined) return;
    this.cancelMember(member, Date.now());
  }

  markActiveCancelled(): void {
    this.runtime.aborted = true;
    const nowMs = Date.now();
    for (const member of this.runtime.members) {
      if (isTerminalPhase(member.phase)) continue;
      this.cancelMember(member, nowMs);
    }
  }

  applyResult(output: string): boolean {
    const statuses = parseAgentSwarmResultStatuses(output);
    if (statuses.length === 0) return false;
    this.runtime.aborted = false;
    const nowMs = Date.now();
    for (const entry of statuses) {
      this.ensureMemberCount(entry.index);
      const member = this.runtime.members[entry.index - 1];
      if (member === undefined) continue;
      if (entry.status === 'completed') {
        member.verdict = entry.verdict;
        member.evidenceIds = entry.evidenceIds;
        member.ultraSwarm = entry.ultraSwarm ?? member.ultraSwarm;
        this.completeMember(member, nowMs, entry.completedText);
      } else if (entry.status === 'failed') {
        member.verdict = entry.verdict;
        member.evidenceIds = entry.evidenceIds;
        member.ultraSwarm = entry.ultraSwarm ?? member.ultraSwarm;
        this.failMember(member, nowMs, entry.failureText);
      } else {
        member.verdict = entry.verdict;
        member.evidenceIds = entry.evidenceIds;
        member.ultraSwarm = entry.ultraSwarm ?? member.ultraSwarm;
        this.cancelMember(member, nowMs);
      }
    }
    const integrationReport = parseUltraSwarmIntegrationReport(output);
    if (integrationReport !== undefined) {
      this.runtime.integrationReport = integrationReport;
    }
    return true;
  }

  ensureMemberCount(count: number): void {
    if (count <= this.runtime.members.length) return;
    const previousLength = this.runtime.members.length;
    this.runtime.members = [
      ...this.runtime.members,
      ...createAgentSwarmMembers(count, this.runtime.inputComplete ? 'queued' : 'pending').slice(this.runtime.members.length),
    ];
    const nowMs = Date.now();
    for (let index = previousLength; index < this.runtime.members.length; index += 1) {
      const member = this.runtime.members[index];
      if (member !== undefined) this.progressEstimator.ensureMember(member.id, nowMs);
    }
  }

  private promoteToRunning(member: AgentSwarmMember, nowMs?: number, setTicks = false): void {
    promoteAgentSwarmMemberToRunning(member, {
      nowMs,
      setTicks,
      onStarted: (memberId, startedAtMs) => this.progressEstimator.markStarted(memberId, startedAtMs),
      onSwarmStarted: (startedAtMs) => this.ensureSwarmStartedAt(startedAtMs),
    });
  }

  private ensureSwarmStartedAt(nowMs: number): void {
    if (this.runtime.swarmStartedAtMs === undefined) this.runtime.swarmStartedAtMs = nowMs;
  }

  private completeMember(member: AgentSwarmMember, nowMs: number, completedText?: string): void {
    applyAgentSwarmMemberCompleted(member, nowMs, completedText, () => {
      this.progressEstimator.markCompleted(member.id, nowMs);
    });
  }

  private failMember(
    member: AgentSwarmMember,
    nowMs: number,
    failureText?: string,
    retryNote?: string,
  ): void {
    applyAgentSwarmMemberFailed(member, nowMs, failureText, () => {
      this.progressEstimator.markFailed(member.id, nowMs);
    }, retryNote);
  }

  private cancelMember(member: AgentSwarmMember, nowMs: number): void {
    applyAgentSwarmMemberCancelled(member, this.getColors(), () => {
      this.progressEstimator.markCancelled(member.id, nowMs);
    });
  }
}
