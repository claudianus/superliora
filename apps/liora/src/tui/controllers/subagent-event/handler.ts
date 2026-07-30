import type { BackgroundTaskInfo, Event } from '@superliora/sdk';

import { MAIN_AGENT_ID } from '../../constant/liora-tui';
import type {
  BackgroundAgentMetadata,
  ToolCallBlockData,
  ToolResultBlockData,
} from '../../types';
import { notifySubagentAttention } from '../../utils/notification/attention-notifications';
import { argsRecord, serializeToolResultOutput } from '../../utils/event-payload';
import { formatHookResultPlain } from '../../utils/hook-result-format';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import type { SessionEventHost } from '../session-event/handler';
import { SubagentActivityPanel } from './activity';
import {
  buildBackgroundAgentMetadata,
  buildBackgroundAgentTranscriptEntry,
  findAgentTaskId,
  shouldSurfaceSubagentModelNotice,
  subagentModelRouteNoticeText,
} from './background';
import {
  isSubagentLifecycleEvent,
  type SubagentLifecycleEvent,
  type SubagentLifecycleEventOf,
} from './helpers';
import { SubagentSwarmCoordinator } from './swarm';

export interface SubagentInfo {
  readonly parentToolCallId: string;
  readonly name: string;
  readonly runInBackground: boolean;
  readonly swarmIndex?: number;
  readonly modelAlias?: string;
}

export type { SubagentLifecycleEvent };

export interface SubAgentEventHandlerDependencies {
  readonly backgroundTasks: ReadonlyMap<string, BackgroundTaskInfo>;
  readonly backgroundTaskTranscriptedTerminal: Set<string>;
  readonly syncBackgroundAgentBadge: () => void;
}

export class SubAgentEventHandler {
  readonly subagentInfo: Map<string, SubagentInfo> = new Map();
  backgroundAgentMetadata: Map<string, BackgroundAgentMetadata> = new Map();
  private readonly swarm: SubagentSwarmCoordinator;
  private readonly activityPanel: SubagentActivityPanel;

  constructor(
    private readonly host: SessionEventHost,
    private readonly deps: SubAgentEventHandlerDependencies,
  ) {
    const requestRender = () => {
      this.requestRender();
    };
    this.swarm = new SubagentSwarmCoordinator(this.host, requestRender);
    this.activityPanel = new SubagentActivityPanel(this.host, requestRender);
  }

  resetRuntimeState(): void {
    this.subagentInfo.clear();
    this.backgroundAgentMetadata.clear();
    this.swarm.reset();
    this.activityPanel.reset();
    this.host.state.todoPanel.clearSubagents();
  }

  routeChildAgentEvent(event: Event): boolean {
    if (isSubagentLifecycleEvent(event)) return false;

    const childAgentId = event.agentId;
    if (childAgentId === MAIN_AGENT_ID) return false;
    if (this.host.btwPanelController.routeEvent(event)) return true;

    const info = this.subagentInfo.get(childAgentId);
    if (info === undefined || info.parentToolCallId.length === 0) return true;

    const { parentToolCallId } = info;
    if (this.swarm.applyChildAgentEvent(parentToolCallId, event, childAgentId)) {
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
    // Phase 5-B: mirror child todo progress onto the Todo Board's subagents
    // strip so foreground and background subagents stay visible even when
    // no swarm grid owns the parent tool call.
    this.host.state.todoPanel.setSubagentTodos({
      subagentId: event.subagentId,
      name: event.subagentName,
      todos: event.todos.map((todo) => ({ title: todo.title, status: todo.status })),
    });
    this.swarm.applyMemberTodos(
      event.parentToolCallId,
      event.subagentId,
      event.todos.map((todo) => ({ title: todo.title, status: todo.status })),
    );
    this.requestRender();
  }

  /**
   * Live subagent tool feed (Phase 1-A): routes the parent-emitted
   * `subagent.tool_call` / `subagent.tool_result` events into the background
   * subagent activity panel. Swarm-orchestrated subagents are routed into
   * their swarm lane's ops feed instead (Phase 1-B). Foreground subagents
   * are skipped — their existing surfaces already stream raw child tool
   * events.
   */
  handleSubagentToolActivity(
    event: Extract<Event, { type: 'subagent.tool_call' | 'subagent.tool_result' }>,
  ): void {
    const info = this.subagentInfo.get(event.subagentId);
    if (
      info !== undefined &&
      this.shouldUseSwarmProgressUi(info.parentToolCallId, info.runInBackground)
    ) {
      this.swarm.routeToolActivity(event, info.parentToolCallId);
      return;
    }
    if (event.type === 'subagent.tool_call') {
      this.activityPanel.recordToolCall({
        subagentId: event.subagentId,
        subagentName: event.subagentName ?? info?.name,
        toolCallId: event.toolCallId,
        name: event.name,
        argsPreview: event.argsPreview,
        detail: event.detail,
      });
      return;
    }
    this.activityPanel.recordToolResult({
      subagentId: event.subagentId,
      toolCallId: event.toolCallId,
      name: event.name,
      isError: event.isError,
    });
  }

  clearAgentSwarmProgress(): void {
    this.swarm.clearProgress();
  }

  applyRoutingDecisionToSwarmProgress(routing: {
    readonly decision: string;
    readonly intensity: string;
    readonly estimatedExperts: number;
  }): void {
    this.swarm.applyRoutingDecision(routing);
  }

  applyCouncilDecisionToSwarmProgress(input: {
    readonly decision: string;
    readonly reason?: string;
  }): void {
    this.swarm.applyCouncilDecision(input);
  }

  applySwarmPausedToSwarmProgress(input: {
    readonly reason: string;
    readonly phase?: string;
  }): void {
    this.swarm.applySwarmPaused(input);
  }

  hasAgentSwarmProgress(toolCallId: string): boolean {
    return this.swarm.hasProgress(toolCallId);
  }

  invokeWarRoomAction(
    action: 'pause' | 'restaff' | 'raw',
    options: { readonly reason?: string } = {},
  ): number {
    return this.swarm.invokeWarRoomAction(action, options);
  }

  hasActiveAgentSwarmToolCall(): boolean {
    return this.swarm.hasActiveToolCall();
  }

  syncAgentSwarmActivitySpinner(
    spinner: { renderGlyph(): string } | undefined,
  ): void {
    this.swarm.syncActivitySpinner(spinner);
  }

  handleAgentSwarmToolCallStarted(
    toolCallId: string,
    args: Record<string, unknown>,
    toolName = 'AgentSwarm',
  ): void {
    this.swarm.handleToolCallStarted(toolCallId, args, toolName);
  }

  handleAgentSwarmToolCallDelta(
    toolCallId: string,
    args: Record<string, unknown>,
    options: { readonly streamingArguments?: string | undefined },
    toolName = 'AgentSwarm',
  ): void {
    this.swarm.handleToolCallDelta(toolCallId, args, options, toolName);
  }

  handleAgentSwarmToolResult(
    toolCallId: string,
    resultData: ToolResultBlockData,
    isError: boolean,
  ): void {
    this.swarm.handleToolResult(toolCallId, resultData, isError);
  }

  handleUltraworkTeamStaffed(event: Extract<Event, { type: 'ultrawork.team.staffed' }>): void {
    this.swarm.handleTeamStaffed(event);
  }

  handleUltraworkCollaborationMessage(
    event: Extract<Event, { type: 'ultrawork.collaboration.message' }>,
  ): boolean {
    return this.swarm.handleCollaborationMessage(event);
  }

  handleUltraworkCollaborationMention(
    event: Extract<Event, { type: 'ultrawork.collaboration.mention' }>,
  ): boolean {
    return this.swarm.handleCollaborationMention(event);
  }

  handleUltraworkCollaborationDebate(
    event: Extract<Event, { type: 'ultrawork.collaboration.debate' }>,
  ): boolean {
    return this.swarm.handleCollaborationDebate(event);
  }

  handleUltraworkCollaborationSteer(
    event: Extract<Event, { type: 'ultrawork.collaboration.steer' }>,
  ): boolean {
    return this.swarm.handleCollaborationSteer(event);
  }

  markActiveAgentSwarmsCancelled(): void {
    this.swarm.markActiveCancelled();
  }

  private handleSubagentSpawned(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    this.rememberSubagent(event);
    this.maybeSurfaceSubagentModel(event);

    if (this.shouldUseSwarmProgressUi(event.parentToolCallId, event.runInBackground)) {
      this.handleForegroundSubagentSpawned(event);
      return;
    }

    const meta = buildBackgroundAgentMetadata(
      event,
      this.host.streamingUI.getActiveToolCall(event.parentToolCallId),
    );
    this.backgroundAgentMetadata.set(event.subagentId, meta);
    this.appendBackgroundAgentEntry('started', meta);
    this.deps.syncBackgroundAgentBadge();
  }

  private maybeSurfaceSubagentModel(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    const { appState } = this.host.state;
    if (
      !shouldSurfaceSubagentModelNotice({
        modelAlias: event.modelAlias,
        subagentName: event.subagentName,
        sessionModel: appState.model,
        availableModels: appState.availableModels,
      })
    ) {
      return;
    }
    const modelAlias = event.modelAlias!;
    this.host.showNotice(
      'Subagent model',
      subagentModelRouteNoticeText(
        event.subagentName,
        appState.model,
        modelAlias,
        appState.availableModels,
      ),
      { coalesceKey: `model-route:subagent:${event.subagentId}` },
    );
    this.host.setAppState({
      lastModelRouteNotice: {
        kind: 'selection',
        fromAlias: appState.model,
        toAlias: modelAlias,
        reason: `subagent:${event.subagentName}`,
        atMs: Date.now(),
      },
    });
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
    // Phase 5-B: finished subagents leave the Todo Board strip regardless of
    // which surface (swarm grid, background panel) owned their run.
    if (this.host.state.todoPanel.removeSubagent(event.subagentId)) {
      this.requestRender();
    }
    const info = this.subagentInfo.get(event.subagentId);
    if (
      info !== undefined &&
      this.shouldUseSwarmProgressUi(info.parentToolCallId, info.runInBackground)
    ) {
      this.handleForegroundSubagentCompleted(event, info);
      return;
    }

    this.activityPanel.markTerminal(event.subagentId, 'completed');
    const backgroundMeta = this.backgroundAgentMetadata.get(event.subagentId);
    if (backgroundMeta !== undefined) {
      const taskId = findAgentTaskId(
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
    // Phase 5-B: failed subagents leave the strip too; the removal flash is
    // the only trace, matching the completed path.
    if (this.host.state.todoPanel.removeSubagent(event.subagentId)) {
      this.requestRender();
    }
    const info = this.subagentInfo.get(event.subagentId);
    if (
      info !== undefined &&
      this.shouldUseSwarmProgressUi(info.parentToolCallId, info.runInBackground)
    ) {
      this.handleForegroundSubagentFailed(event, info);
      return;
    }

    this.activityPanel.markTerminal(event.subagentId, 'failed');
    const backgroundMeta = this.backgroundAgentMetadata.get(event.subagentId);
    if (backgroundMeta !== undefined) {
      const taskId = findAgentTaskId(
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

  private shouldUseSwarmProgressUi(
    parentToolCallId: string,
    runInBackground: boolean,
  ): boolean {
    return !runInBackground || this.swarm.isOrchestrated(parentToolCallId);
  }

  private appendBackgroundAgentEntry(
    phase: 'started' | 'completed' | 'failed',
    meta: BackgroundAgentMetadata,
    extras: { resultSummary?: string; error?: string } | undefined = undefined,
  ): void {
    this.host.appendTranscriptEntry(
      buildBackgroundAgentTranscriptEntry(
        phase,
        meta,
        this.host.streamingUI.getTurnContext().turnId,
        extras,
      ),
    );
  }

  private rememberSubagent(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    this.subagentInfo.set(event.subagentId, {
      parentToolCallId: event.parentToolCallId,
      name: event.subagentName,
      runInBackground: event.runInBackground,
      swarmIndex: event.swarmIndex,
      modelAlias: event.modelAlias,
    });
  }

  private handleForegroundSubagentSpawned(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    if (this.swarm.registerSubagent(event.parentToolCallId, event)) {
      return;
    }

    let tc = this.getOrActivateToolComponent(event.parentToolCallId);
    tc ??= this.createStandaloneSubagentToolCall(event);
    if (tc === undefined) return;
    tc.onSubagentSpawned({
      agentId: event.subagentId,
      agentName: event.subagentName,
      runInBackground: event.runInBackground,
      modelAlias: event.modelAlias,
    });
  }

  private handleForegroundSubagentStarted(
    event: SubagentLifecycleEventOf<'subagent.started'>,
    info: SubagentInfo,
  ): void {
    if (this.swarm.markStarted(info.parentToolCallId, event.subagentId)) {
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
    this.swarm.markSuspended(info.parentToolCallId, {
      agentId: event.subagentId,
      reason: event.reason,
      swarmIndex: info.swarmIndex,
    });
  }

  private handleForegroundSubagentCompleted(
    event: SubagentLifecycleEventOf<'subagent.completed'>,
    info: SubagentInfo,
  ): void {
    const { parentToolCallId } = info;
    if (this.swarm.markCompleted(parentToolCallId, event.subagentId, event.resultSummary)) {
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
    if (
      this.swarm.markFailedOrCancelled(
        parentToolCallId,
        event.subagentId,
        event.error,
        event,
      )
    ) {
      this.host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
      return;
    }

    const tc = this.host.streamingUI.getToolComponent(parentToolCallId);
    if (tc === undefined) return;
    tc.onSubagentFailed({ error: event.error });
    notifySubagentAttention(this.host.state, event.subagentId, 'failed', event.error);
    this.host.streamingUI.removeToolComponentIfInactive(parentToolCallId);
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

export { isSubagentLifecycleEvent } from './helpers';
