import type {
  BackgroundTaskInfo,
  Event,
  TeamPlan,
} from '@superliora/sdk';
import type { Component } from '#/tui/renderer';

import {
  AgentSwarmProgressComponent,
  agentSwarmDescriptionFromArgs,
  agentSwarmGridHeightForTerminalRows,
  swarmProgressTitleForToolName,
  type UltraSwarmMemberMetadata,
} from '../components/messages/agent-swarm-progress';
import { MAIN_AGENT_ID } from '../constant/liora-tui';
import type {
  BackgroundAgentMetadata,
  ToolCallBlockData,
  ToolResultBlockData,
  TranscriptEntry,
} from '../types';
import { notifySubagentAttention } from '../utils/attention-notifications';
import { formatBackgroundAgentTranscript } from '../utils/background-agent-status';
import { argsRecord, serializeToolResultOutput } from '../utils/event-payload';
import { formatHookResultPlain } from '../utils/hook-result-format';
import { nextTranscriptId } from '../utils/transcript-id';
import type { SessionEventHost } from './session-event-handler';
import { requestTUILayoutRender } from '../utils/frame-render';

export interface SubagentInfo {
  readonly parentToolCallId: string;
  readonly name: string;
  readonly runInBackground: boolean;
  readonly swarmIndex?: number;
}

export type SubagentLifecycleEvent = Event & { type: `subagent.${string}` };
type SubagentLifecycleEventOf<Type extends SubagentLifecycleEvent['type']> =
  SubagentLifecycleEvent & { type: Type };

export interface SubAgentEventHandlerDependencies {
  readonly backgroundTasks: ReadonlyMap<string, BackgroundTaskInfo>;
  readonly backgroundTaskTranscriptedTerminal: Set<string>;
  readonly syncBackgroundAgentBadge: () => void;
}

function renderedRowsAfterChild(
  children: readonly Component[],
  child: Component,
  width: number,
): number {
  const childIndex = children.indexOf(child);
  if (childIndex < 0) return 0;
  return children
    .slice(childIndex + 1)
    .reduce((sum, component) => sum + component.render(width).length, 0);
}

export class SubAgentEventHandler {
  readonly subagentInfo: Map<string, SubagentInfo> = new Map();
  private readonly agentSwarmProgress: Map<string, AgentSwarmProgressComponent> = new Map();
  private readonly ultraSwarmTeamsByToolCallId: Map<string, TeamPlan> = new Map();
  backgroundAgentMetadata: Map<string, BackgroundAgentMetadata> = new Map();

  constructor(
    private readonly host: SessionEventHost,
    private readonly deps: SubAgentEventHandlerDependencies,
  ) {}

  resetRuntimeState(): void {
    this.subagentInfo.clear();
    this.ultraSwarmTeamsByToolCallId.clear();
    this.backgroundAgentMetadata.clear();
    this.clearAgentSwarmProgress();
  }

  routeChildAgentEvent(event: Event): boolean {
    if (isSubagentLifecycleEvent(event)) return false;

    const childAgentId = event.agentId;
    if (childAgentId === MAIN_AGENT_ID) return false;
    if (this.host.btwPanelController.routeEvent(event)) return true;

    const info = this.subagentInfo.get(childAgentId);
    if (info === undefined || info.parentToolCallId.length === 0) return true;

    const { parentToolCallId } = info;
    const swarmProgress = this.agentSwarmProgress.get(parentToolCallId);
    if (swarmProgress !== undefined) {
      this.applySubagentEventToSwarmProgress(swarmProgress, event, childAgentId);
      this.requestRender();
      return true;
    }

    const toolCall = this.host.streamingUI.getToolComponent(parentToolCallId);
    if (toolCall === undefined) return true;
    toolCall.setSubagentMeta(childAgentId, info.name);

    if (event.type === 'hook.result') {
      toolCall.appendSubagentText(formatHookResultPlain(event), 'text');
    } else if (event.type === 'assistant.delta') {
      toolCall.appendSubagentText(event.delta, 'text');
    } else if (event.type === 'thinking.delta') {
      toolCall.appendSubagentText(event.delta, 'thinking');
    } else if (event.type === 'tool.call.started') {
      toolCall.appendSubToolCall({
        id: `${childAgentId}:${event.toolCallId}`,
        name: event.name,
        args: argsRecord(event.args),
      });
    } else if (event.type === 'tool.call.delta') {
      toolCall.appendSubToolCallDelta({
        id: `${childAgentId}:${event.toolCallId}`,
        name: event.name,
        argumentsPart: event.argumentsPart ?? null,
      });
    } else if (
      event.type === 'tool.progress' &&
      (event.update.kind === 'stdout' || event.update.kind === 'stderr') &&
      event.update.text !== undefined
    ) {
      toolCall.appendSubToolLiveOutput(`${childAgentId}:${event.toolCallId}`, event.update.text);
    } else if (event.type === 'tool.result') {
      toolCall.finishSubToolCall({
        tool_call_id: `${childAgentId}:${event.toolCallId}`,
        output: serializeToolResultOutput(event.output),
        is_error: event.isError,
      });
    } else if (event.type === 'agent.status.updated') {
      const usageObj = event.usage;
      const totalUsage = usageObj?.total ?? usageObj?.currentTurn;
      toolCall.updateSubagentMetrics({
        contextTokens: event.contextTokens,
        usage: totalUsage,
      });
    }
    return true;
  }

  handleLifecycleEvent(event: SubagentLifecycleEvent): void {
    switch (event.type) {
      case 'subagent.spawned':
        this.handleSubagentSpawned(event);
        return;
      case 'subagent.started':
        this.handleSubagentStarted(event);
        return;
      case 'subagent.suspended':
        this.handleSubagentSuspended(event);
        return;
      case 'subagent.completed':
        this.handleSubagentCompleted(event);
        return;
      case 'subagent.failed':
        this.handleSubagentFailed(event);
        return;
    }
  }

  handleSubagentTodoUpdated(
    event: Extract<Event, { type: 'subagent.todo.updated' }>,
  ): void {
    const progress = this.agentSwarmProgress.get(event.parentToolCallId);
    if (progress === undefined) return;
    progress.applyMemberTodos(
      event.subagentId,
      event.todos.map((todo) => ({ title: todo.title, status: todo.status })),
    );
    this.requestRender();
  }

  clearAgentSwarmProgress(): void {
    for (const progress of this.agentSwarmProgress.values()) {
      progress.dispose();
    }
    this.agentSwarmProgress.clear();
    this.host.updateActivityPane();
  }

  hasAgentSwarmProgress(toolCallId: string): boolean {
    return this.agentSwarmProgress.has(toolCallId);
  }

  hasActiveAgentSwarmToolCall(): boolean {
    return Array.from(this.agentSwarmProgress.values()).some((progress) =>
      progress.isToolCallActive()
    );
  }

  syncAgentSwarmActivitySpinner(
    spinner: { renderGlyph(): string } | undefined,
  ): void {
    for (const progress of this.agentSwarmProgress.values()) {
      progress.setActivitySpinnerText(
        spinner === undefined ? undefined : () => spinner.renderGlyph(),
      );
    }
  }

  handleAgentSwarmToolCallStarted(
    toolCallId: string,
    args: Record<string, unknown>,
    toolName = 'AgentSwarm',
  ): void {
    const progress = this.ensureAgentSwarmProgress(toolCallId, args, { toolName });
    progress.markInputComplete();
    this.requestRender();
  }

  handleAgentSwarmToolCallDelta(
    toolCallId: string,
    args: Record<string, unknown>,
    options: { readonly streamingArguments?: string | undefined },
    toolName = 'AgentSwarm',
  ): void {
    this.ensureAgentSwarmProgress(toolCallId, args, { ...options, toolName });
    this.requestRender();
  }

  handleAgentSwarmToolResult(
    toolCallId: string,
    resultData: ToolResultBlockData,
    isError: boolean,
  ): void {
    const progress = this.agentSwarmProgress.get(toolCallId);
    if (progress === undefined) return;

    if (isError && isUserCancelledSubagentError(resultData.output)) {
      if (progress.isRequestStreaming()) {
        this.removeAgentSwarmProgress(toolCallId, progress);
      } else {
        progress.markToolCallEnded();
        progress.markActiveCancelled();
      }
    } else if (isError) {
      progress.markToolCallEnded();
      if (!progress.applyResult(resultData.output)) {
        progress.markSwarmFailed(resultData.output);
      }
    } else {
      progress.markToolCallEnded();
      progress.applyResult(resultData.output);
    }
    this.host.updateActivityPane();
    this.requestRender();
  }

  handleUltraworkTeamStaffed(event: Extract<Event, { type: 'ultrawork.team.staffed' }>): void {
    if (event.toolCallId === undefined) return;
    this.ultraSwarmTeamsByToolCallId.set(event.toolCallId, event.team);
    this.updateAgentSwarmProgress(event.toolCallId, (progress) => {
      progress.applyUltraSwarmTeam(ultraSwarmMembersFromTeam(event.team));
    });
  }

  handleUltraworkCollaborationMessage(
    event: Extract<Event, { type: 'ultrawork.collaboration.message' }>,
  ): void {
    const toolCallId = event.message.parentToolCallId;
    if (toolCallId.length === 0) return;
    this.updateAgentSwarmProgress(toolCallId, (progress) => {
      progress.applySwarmCollaborationMessage(event.message);
    });
  }

  handleUltraworkCollaborationMention(
    event: Extract<Event, { type: 'ultrawork.collaboration.mention' }>,
  ): void {
    const toolCallId = event.message.parentToolCallId;
    if (toolCallId.length === 0) return;
    this.updateAgentSwarmProgress(toolCallId, (progress) => {
      progress.applySwarmCollaborationMention(event.message);
    });
  }

  markActiveAgentSwarmsCancelled(): void {
    let updated = false;
    for (const [toolCallId, progress] of this.agentSwarmProgress) {
      if (progress.isRequestStreaming()) {
        this.removeAgentSwarmProgress(toolCallId, progress);
        updated = true;
        continue;
      }
      progress.markActiveCancelled();
      updated = true;
    }
    if (updated) this.requestRender();
  }

  private handleSubagentSpawned(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    this.rememberSubagent(event);

    if (this.shouldUseSwarmProgressUi(event.parentToolCallId, event.runInBackground)) {
      this.handleForegroundSubagentSpawned(event);
      return;
    }

    const meta = this.buildBackgroundAgentMetadata(event);
    this.backgroundAgentMetadata.set(event.subagentId, meta);
    this.appendBackgroundAgentEntry('started', meta);
    this.deps.syncBackgroundAgentBadge();
  }

  private handleSubagentStarted(
    event: SubagentLifecycleEventOf<'subagent.started'>,
  ): void {
    const info = this.subagentInfo.get(event.subagentId);
    if (info === undefined) return;
    if (this.shouldUseSwarmProgressUi(info.parentToolCallId, info.runInBackground)) {
      this.handleForegroundSubagentStarted(event, info);
    }
  }

  private handleSubagentSuspended(
    event: SubagentLifecycleEventOf<'subagent.suspended'>,
  ): void {
    const info = this.subagentInfo.get(event.subagentId);
    if (info === undefined) return;
    if (this.shouldUseSwarmProgressUi(info.parentToolCallId, info.runInBackground)) {
      this.handleForegroundSubagentSuspended(event, info);
    }
  }

  private handleSubagentCompleted(
    event: SubagentLifecycleEventOf<'subagent.completed'>,
  ): void {
    const info = this.subagentInfo.get(event.subagentId);
    if (
      info !== undefined &&
      this.shouldUseSwarmProgressUi(info.parentToolCallId, info.runInBackground)
    ) {
      this.handleForegroundSubagentCompleted(event, info);
      return;
    }

    const backgroundMeta = this.backgroundAgentMetadata.get(event.subagentId);
    if (backgroundMeta !== undefined) {
      const taskId = this.findAgentTaskId(
        event.subagentId,
        backgroundMeta,
        this.deps.backgroundTasks,
      );
      this.backgroundAgentMetadata.delete(event.subagentId);
      this.deps.syncBackgroundAgentBadge();
      if (taskId !== undefined && this.deps.backgroundTaskTranscriptedTerminal.has(taskId)) {
        return;
      }
      if (taskId !== undefined) {
        this.deps.backgroundTaskTranscriptedTerminal.add(taskId);
      }
      const extras =
        event.resultSummary === undefined ? undefined : { resultSummary: event.resultSummary };
      this.appendBackgroundAgentEntry('completed', backgroundMeta, extras);
      return;
    }
  }

  private handleSubagentFailed(
    event: SubagentLifecycleEventOf<'subagent.failed'>,
  ): void {
    const info = this.subagentInfo.get(event.subagentId);
    if (
      info !== undefined &&
      this.shouldUseSwarmProgressUi(info.parentToolCallId, info.runInBackground)
    ) {
      this.handleForegroundSubagentFailed(event, info);
      return;
    }

    const backgroundMeta = this.backgroundAgentMetadata.get(event.subagentId);
    if (backgroundMeta !== undefined) {
      const taskId = this.findAgentTaskId(
        event.subagentId,
        backgroundMeta,
        this.deps.backgroundTasks,
      );
      const task = taskId === undefined ? undefined : this.deps.backgroundTasks.get(taskId);
      this.backgroundAgentMetadata.delete(event.subagentId);
      this.deps.syncBackgroundAgentBadge();
      if (task?.kind === 'agent' && task.status === 'timed_out') {
        return;
      }
      this.host.streamingUI.applyBackgroundTaskTerminalStatus({
        agentId: event.subagentId,
        description: backgroundMeta.description ?? '',
        status: 'failed',
        errorText: event.error,
      });
      if (taskId !== undefined && this.deps.backgroundTaskTranscriptedTerminal.has(taskId)) {
        return;
      }
      if (taskId !== undefined) {
        this.deps.backgroundTaskTranscriptedTerminal.add(taskId);
      }
      this.appendBackgroundAgentEntry('failed', backgroundMeta, { error: event.error });
      return;
    }
  }

  private isSwarmOrchestratedSubagent(parentToolCallId: string): boolean {
    return (
      this.agentSwarmProgress.has(parentToolCallId) ||
      this.ultraSwarmTeamsByToolCallId.has(parentToolCallId)
    );
  }

  private shouldUseSwarmProgressUi(
    parentToolCallId: string,
    runInBackground: boolean,
  ): boolean {
    return !runInBackground || this.isSwarmOrchestratedSubagent(parentToolCallId);
  }

  private findAgentTaskId(
    subagentId: string,
    meta: BackgroundAgentMetadata,
    backgroundTasks: ReadonlyMap<string, BackgroundTaskInfo>,
  ): string | undefined {
    for (const info of backgroundTasks.values()) {
      if (info.kind !== 'agent') continue;
      if (info.agentId === subagentId) return info.taskId;
    }
    const description = meta.description ?? meta.agentName;
    if (description === undefined) return undefined;
    // Fallback by description when the agent id is not present (e.g. a
    // background task spawned without tracking the subagent id). Multiple
    // concurrent agents can share the same generic description; returning
    // undefined here would skip terminal-status dedup and produce duplicate
    // "completed"/"failed" transcript entries, so prefer the most recently
    // registered match instead of bailing out.
    let match: string | undefined;
    for (const info of backgroundTasks.values()) {
      if (info.kind !== 'agent') continue;
      if (info.description !== description) continue;
      match = info.taskId;
    }
    return match;
  }

  private buildBackgroundAgentMetadata(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): BackgroundAgentMetadata {
    const parent = this.host.streamingUI.getActiveToolCall(event.parentToolCallId);
    const description = parent?.args['description'] ?? event.description;
    return {
      agentId: event.subagentId,
      parentToolCallId: event.parentToolCallId,
      agentName: event.subagentName,
      description: typeof description === 'string' ? description : undefined,
    };
  }

  private appendBackgroundAgentEntry(
    phase: 'started' | 'completed' | 'failed',
    meta: BackgroundAgentMetadata,
    extras: { resultSummary?: string; error?: string } | undefined = undefined,
  ): void {
    const status = formatBackgroundAgentTranscript(phase, meta, extras);
    const entry: TranscriptEntry = {
      id: nextTranscriptId(),
      kind: 'status',
      turnId: this.host.streamingUI.getTurnContext().turnId,
      renderMode: 'plain',
      content: status.headline,
      detail: status.detail,
      backgroundAgentStatus: status,
    };
    this.host.appendTranscriptEntry(entry);
  }

  private rememberSubagent(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    this.subagentInfo.set(event.subagentId, {
      parentToolCallId: event.parentToolCallId,
      name: event.subagentName,
      runInBackground: event.runInBackground,
      swarmIndex: event.swarmIndex,
    });
  }

  private handleForegroundSubagentSpawned(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    if (this.updateAgentSwarmProgress(event.parentToolCallId, (progress) => {
      progress.registerSubagent({
        agentId: event.subagentId,
        swarmIndex: event.swarmIndex,
      });
    })) {
      return;
    }

    let tc = this.getOrActivateToolComponent(event.parentToolCallId);
    tc ??= this.createStandaloneSubagentToolCall(event);
    if (tc === undefined) return;
    tc.onSubagentSpawned({
      agentId: event.subagentId,
      agentName: event.subagentName,
      runInBackground: event.runInBackground,
    });
  }

  private handleForegroundSubagentStarted(
    event: SubagentLifecycleEventOf<'subagent.started'>,
    info: SubagentInfo,
  ): void {
    if (this.updateAgentSwarmProgress(info.parentToolCallId, (progress) => {
      progress.markStarted(event.subagentId);
    })) {
      return;
    }

    const tc = this.getOrActivateToolComponent(info.parentToolCallId);
    if (tc === undefined) return;
    tc.onSubagentStarted({
      agentId: event.subagentId,
      agentName: info.name,
      runInBackground: info.runInBackground,
    });
  }

  private handleForegroundSubagentSuspended(
    event: SubagentLifecycleEventOf<'subagent.suspended'>,
    info: SubagentInfo,
  ): void {
    this.updateAgentSwarmProgress(info.parentToolCallId, (progress) => {
      progress.markSuspended({
        agentId: event.subagentId,
        reason: event.reason,
        swarmIndex: info.swarmIndex,
      });
    });
  }

  private handleForegroundSubagentCompleted(
    event: SubagentLifecycleEventOf<'subagent.completed'>,
    info: SubagentInfo,
  ): void {
    const { parentToolCallId } = info;
    if (this.updateAgentSwarmProgress(parentToolCallId, (progress) => {
      progress.markCompleted(event.subagentId, event.resultSummary);
    })) {
      this.host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
      return;
    }

    const tc = this.host.streamingUI.getToolComponent(parentToolCallId);
    if (tc === undefined) return;
    tc.onSubagentCompleted({
      contextTokens: event.contextTokens,
      usage: event.usage,
      resultSummary: event.resultSummary,
    });
    notifySubagentAttention(
      this.host.state,
      event.subagentId,
      'completed',
      event.resultSummary,
    );
    this.host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
  }

  private handleForegroundSubagentFailed(
    event: SubagentLifecycleEventOf<'subagent.failed'>,
    info: SubagentInfo,
  ): void {
    const { parentToolCallId } = info;
    if (this.updateAgentSwarmProgress(parentToolCallId, (progress) => {
      this.markAgentSwarmFailedOrCancelled(progress, event.subagentId, event.error);
    })) {
      this.host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
      return;
    }

    const tc = this.host.streamingUI.getToolComponent(parentToolCallId);
    if (tc === undefined) return;
    tc.onSubagentFailed({ error: event.error });
    notifySubagentAttention(this.host.state, event.subagentId, 'failed', event.error);
    this.host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
  }

  private applySubagentEventToSwarmProgress(
    progress: AgentSwarmProgressComponent,
    event: Event,
    subagentId: string,
  ): void {
    if (event.type === 'assistant.delta' || event.type === 'thinking.delta') {
      progress.appendModelDelta({ agentId: subagentId, delta: event.delta });
    } else if (event.type === 'tool.call.started') {
      progress.recordToolCall({
        agentId: subagentId,
        toolCallId: event.toolCallId,
        toolName: event.name,
        toolDescription: event.description,
      });
    } else if (event.type === 'tool.result') {
      const summary =
        typeof event.result.output === 'string'
          ? event.result.output.slice(0, 80)
          : undefined;
      progress.recordToolResult({
        agentId: subagentId,
        toolCallId: event.toolCallId,
        isError: event.result.isError,
        summary,
      });
    }
  }

  private updateAgentSwarmProgress(
    parentToolCallId: string,
    update: (progress: AgentSwarmProgressComponent) => void,
  ): boolean {
    const progress = this.agentSwarmProgress.get(parentToolCallId);
    if (progress === undefined) return false;
    update(progress);
    this.requestRender();
    return true;
  }

  private ensureAgentSwarmProgress(
    toolCallId: string,
    args: Record<string, unknown>,
    options: {
      readonly streamingArguments?: string | undefined;
      readonly toolName?: string | undefined;
    } = {},
  ): AgentSwarmProgressComponent {
    const existing = this.agentSwarmProgress.get(toolCallId);
    if (existing !== undefined) {
      existing.updateArgs(args, options);
      return existing;
    }

    const progress = new AgentSwarmProgressComponent({
      description: agentSwarmDescriptionFromArgs(args),
      title: swarmProgressTitleForToolName(options.toolName ?? 'AgentSwarm'),
      availableGridHeight: () =>
        this.agentSwarmGridHeight((options.toolName ?? 'AgentSwarm') === 'UltraSwarm'),
      requestRender: () => {
        this.requestRender();
      },
    });
    progress.updateArgs(args, options);
    const team = this.ultraSwarmTeamsByToolCallId.get(toolCallId);
    if (team !== undefined) {
      progress.applyUltraSwarmTeam(ultraSwarmMembersFromTeam(team));
    }
    this.agentSwarmProgress.set(toolCallId, progress);
    this.host.streamingUI.finalizeLiveTextBuffers('tool');
    this.host.state.transcriptContainer.addChild(progress);
    this.host.updateActivityPane();
    this.requestRender();
    return progress;
  }

  private removeAgentSwarmProgress(
    toolCallId: string,
    progress: AgentSwarmProgressComponent,
  ): void {
    this.agentSwarmProgress.delete(toolCallId);
    progress.dispose();
    const children = this.host.state.transcriptContainer.children;
    const index = children.indexOf(progress);
    if (index >= 0) {
      children.splice(index, 1);
      this.host.state.transcriptContainer.invalidate();
    }
    this.host.updateActivityPane();
  }

  private agentSwarmGridHeight(opsFeed = false): number | undefined {
    const { state } = this.host;
    const terminalRows = state.ui.terminal.rows;
    const terminalColumns = state.ui.terminal.columns;
    if (!Number.isFinite(terminalColumns) || terminalColumns <= 0) {
      return agentSwarmGridHeightForTerminalRows(terminalRows, 0, { opsFeed });
    }

    const width = Math.floor(terminalColumns);
    const rowsAfterSwarm = renderedRowsAfterChild(
      state.ui.children,
      state.transcriptContainer,
      width,
    );
    return agentSwarmGridHeightForTerminalRows(terminalRows, rowsAfterSwarm, { opsFeed });
  }

  private markAgentSwarmFailedOrCancelled(
    progress: AgentSwarmProgressComponent,
    subagentId: string,
    error: string,
  ): void {
    if (isUserCancelledSubagentError(error)) {
      progress.markCancelled(subagentId);
    } else {
      progress.markFailed(subagentId, error);
    }
  }

  private getOrActivateToolComponent(parentToolCallId: string) {
    let component = this.host.streamingUI.getToolComponent(parentToolCallId);
    if (component !== undefined) return component;
    const toolCall = this.host.streamingUI.getActiveToolCall(parentToolCallId);
    if (toolCall === undefined) return undefined;
    this.host.streamingUI.onToolCallStart(toolCall);
    return this.host.streamingUI.getToolComponent(parentToolCallId);
  }

  private createStandaloneSubagentToolCall(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ) {
    const description = event.description ?? `Run ${event.subagentName} agent`;
    const { turnId, step } = this.host.streamingUI.getTurnContext();
    const toolCall: ToolCallBlockData = {
      id: event.parentToolCallId,
      name: 'Agent',
      args: {
        description,
        subagent_type: event.subagentName,
      },
      description,
      step,
      turnId,
    };
    this.host.streamingUI.onToolCallStart(toolCall);
    return this.host.streamingUI.getToolComponent(event.parentToolCallId);
  }

  private requestRender(): void {
    requestTUILayoutRender(this.host.state);
  }
}

function isSubagentLifecycleEvent(event: Event): event is SubagentLifecycleEvent {
  return (
    event.type === 'subagent.spawned' ||
    event.type === 'subagent.started' ||
    event.type === 'subagent.suspended' ||
    event.type === 'subagent.completed' ||
    event.type === 'subagent.failed'
  );
}

function ultraSwarmMembersFromTeam(team: TeamPlan): UltraSwarmMemberMetadata[] {
  return team.experts.map((expert) => ({
    expertId: expert.id,
    name: expert.name,
    division: expert.division,
    emoji: expert.emoji,
    coverageLane: expert.coverageLane ?? expert.role,
    selectionReason: expert.selectionReason,
    focus: expert.focus,
    dependsOn: expert.dependsOn,
    taskIds: expert.taskIds,
  }));
}

function isUserCancelledSubagentError(error: string): boolean {
  // Structured AgentSwarm results use outcome="aborted" and are parsed separately.
  switch (error.trim()) {
    case 'Aborted by the user':
    case 'The user manually interrupted this subagent batch.':
      return true;
    default:
      return false;
  }
}
