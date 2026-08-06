import type { BackgroundTaskInfo, Event } from '@superliora/sdk';

import { MAIN_AGENT_ID } from '../../constant/liora-tui';
import type {
  BackgroundAgentMetadata,
  ToolResultBlockData,
} from '../../types';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import type { SessionEventHost } from '../session-event/handler';
import type { WarRoomExpertView } from '../../utils/war-room-experts';
import {
  buildBackgroundAgentMetadata,
  buildBackgroundAgentTranscriptEntry,
  findAgentTaskId,
  shouldSurfaceSubagentModelNotice,
} from './background';
import {
  handleForegroundSubagentCompleted,
  handleForegroundSubagentFailed,
  handleForegroundSubagentSpawned,
  handleForegroundSubagentStarted,
  handleForegroundSubagentSuspended,
  routeChildAgentToolEvent,
} from './foreground-lifecycle';
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

  constructor(
    private readonly host: SessionEventHost,
    private readonly deps: SubAgentEventHandlerDependencies,
  ) {
    const requestRender = () => {
      this.requestRender();
    };
    this.swarm = new SubagentSwarmCoordinator(this.host, requestRender);
  }

  resetRuntimeState(): void {
    this.subagentInfo.clear();
    this.backgroundAgentMetadata.clear();
    this.swarm.reset();
  }

  routeChildAgentEvent(event: Event): boolean {
    if (isSubagentLifecycleEvent(event)) return false;

    const childAgentId = event.agentId;
    if (childAgentId === MAIN_AGENT_ID) return false;
    if (this.host.btwPanelController.routeEvent(event)) return true;

    const info = this.subagentInfo.get(childAgentId);
    if (info === undefined || info.parentToolCallId.length === 0) return true;

    const { parentToolCallId } = info;
    return routeChildAgentToolEvent(this.host, this.swarm, childAgentId, parentToolCallId, info, event);
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
    // Child todo ratios render on the Mission Control worker row (fed from
    // the session-event dispatch); the swarm grid keeps its own member view.
    this.swarm.applyMemberTodos(
      event.parentToolCallId,
      event.subagentId,
      event.todos.map((todo) => ({ title: todo.title, status: todo.status })),
    );
    this.requestRender();
  }

  /**
   * Live subagent tool feed (Phase 1-A): swarm-orchestrated subagents route
   * into their swarm lane's ops feed (Phase 1-B). Every subagent — swarm or
   * not — also flows into the Mission Control ops feed via the session-event
   * dispatch, so the old transcript activity panel is gone.
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
    }
  }

  clearAgentSwarmProgress(): void {
    this.swarm.clearProgress();
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

  /**
   * Experts from the most recent active UltraSwarm / AgentSwarm war room card.
   * Prefers a still-active tool call; otherwise the last registered progress card.
   */
  listWarRoomExperts(): readonly WarRoomExpertView[] {
    return this.swarm.listWarRoomExperts();
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
      handleForegroundSubagentSpawned(this.host, this.swarm, event);
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
    // Tool-call header already shows `· modelAlias` while the subagent runs.
    const modelAlias = event.modelAlias!;
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
      handleForegroundSubagentStarted(this.host, this.swarm, event, info);
    }
  }

  private handleSubagentSuspended(
    event: SubagentLifecycleEventOf<'subagent.suspended'>,
  ): void {
    const info = this.subagentInfo.get(event.subagentId);
    if (info === undefined) return;
    if (this.shouldUseSwarmProgressUi(info.parentToolCallId, info.runInBackground)) {
      handleForegroundSubagentSuspended(this.swarm, event, info);
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
      this.host.setAppState({ fleetFlourish: { atMs: Date.now() } });
      handleForegroundSubagentCompleted(this.host, this.swarm, event, info);
      return;
    }

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
    const info = this.subagentInfo.get(event.subagentId);
    if (
      info !== undefined &&
      this.shouldUseSwarmProgressUi(info.parentToolCallId, info.runInBackground)
    ) {
      handleForegroundSubagentFailed(this.host, this.swarm, event, info);
      return;
    }

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

  private requestRender(): void {
    requestTUILayoutRender(this.host.state);
  }
}

export { isSubagentLifecycleEvent } from './helpers';
