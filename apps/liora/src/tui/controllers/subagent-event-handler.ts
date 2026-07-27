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
import {
  SubagentActivityComponent,
  describeSubagentToolFeedBody,
} from '../components/subagents/subagent-activity';
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
import {
  buildWarRoomRestaffSteerDirective,
  formatWarRoomRestaffReason,
  resolveWarRoomReason,
} from '../utils/war-room-action';
import type { SessionEventHost } from './session-event-handler';
import { requestTUILayoutRender } from '../utils/frame-render';
import {
  isSameEffectiveModel,
  modelRouteDisplayName,
  resolveModelRouteIdentity,
} from '../utils/model-route-notice';

export interface SubagentInfo {
  readonly parentToolCallId: string;
  readonly name: string;
  readonly runInBackground: boolean;
  readonly swarmIndex?: number;
  readonly modelAlias?: string;
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
  private subagentActivityPanel: SubagentActivityComponent | undefined;

  constructor(
    private readonly host: SessionEventHost,
    private readonly deps: SubAgentEventHandlerDependencies,
  ) {}

  resetRuntimeState(): void {
    this.subagentInfo.clear();
    this.ultraSwarmTeamsByToolCallId.clear();
    this.backgroundAgentMetadata.clear();
    this.clearAgentSwarmProgress();
    this.removeSubagentActivityPanel();
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
      this.routeToolActivityToSwarmProgress(event, info.parentToolCallId);
      return;
    }
    if (event.type === 'subagent.tool_call') {
      const panel = this.ensureSubagentActivityPanel();
      panel.recordToolCall({
        subagentId: event.subagentId,
        subagentName: event.subagentName ?? info?.name,
        toolCallId: event.toolCallId,
        name: event.name,
        argsPreview: event.argsPreview,
        detail: event.detail,
      });
      return;
    }
    const panel = this.subagentActivityPanel;
    if (panel === undefined) return;
    panel.recordToolResult({
      subagentId: event.subagentId,
      toolCallId: event.toolCallId,
      name: event.name,
      isError: event.isError,
    });
  }

  /**
   * Swarm lane tool activity (Phase 1-B): mirrors structured tool calls into
   * the owning member's ops feed so each parallel lane shows live work with
   * the same chip detail as the background panel. Successful results are
   * skipped — the member grid already pulses on them — while failures land
   * as `fail` feed entries.
   */
  private routeToolActivityToSwarmProgress(
    event: Extract<Event, { type: 'subagent.tool_call' | 'subagent.tool_result' }>,
    parentToolCallId: string,
  ): void {
    const progress = this.agentSwarmProgress.get(parentToolCallId);
    if (progress === undefined) return;
    if (event.type === 'subagent.tool_call') {
      progress.appendMemberToolFeed({
        agentId: event.subagentId,
        body: describeSubagentToolFeedBody(event.name, event.detail, event.argsPreview),
      });
      this.requestRender();
      return;
    }
    if (event.isError !== true) return;
    const preview =
      event.resultPreview === undefined || event.resultPreview.length === 0
        ? ''
        // Bound the failure note; the emitter already caps at ~500 chars.
        : ` · ${event.resultPreview.slice(0, 120)}`;
    progress.appendMemberToolFeed({
      agentId: event.subagentId,
      body: `✗ ${event.name ?? 'tool'}${preview}`,
      isError: true,
    });
    this.requestRender();
  }

  private ensureSubagentActivityPanel(): SubagentActivityComponent {
    const existing = this.subagentActivityPanel;
    if (existing !== undefined) return existing;
    const panel = new SubagentActivityComponent({
      requestRender: () => {
        this.requestRender();
      },
    });
    this.subagentActivityPanel = panel;
    this.host.state.transcriptContainer.addChild(panel);
    this.requestRender();
    return panel;
  }

  private removeSubagentActivityPanel(): void {
    const panel = this.subagentActivityPanel;
    if (panel === undefined) return;
    this.subagentActivityPanel = undefined;
    const children = this.host.state.transcriptContainer.children;
    const index = children.indexOf(panel);
    if (index >= 0) {
      children.splice(index, 1);
      this.host.state.transcriptContainer.invalidate();
    }
  }

  private markSubagentActivityTerminal(
    subagentId: string,
    phase: 'completed' | 'failed',
  ): void {
    const panel = this.subagentActivityPanel;
    if (panel === undefined) return;
    panel.markTerminal(subagentId, phase);
    this.requestRender();
  }

  clearAgentSwarmProgress(): void {
    for (const progress of this.agentSwarmProgress.values()) {
      progress.dispose();
    }
    this.agentSwarmProgress.clear();
    this.host.updateActivityPane();
  }

  applyRoutingDecisionToSwarmProgress(routing: {
    readonly decision: string;
    readonly intensity: string;
    readonly estimatedExperts: number;
  }): void {
    for (const progress of this.agentSwarmProgress.values()) {
      progress.applyRoutingDecision(routing);
    }
  }

  applyCouncilDecisionToSwarmProgress(input: {
    readonly decision: string;
    readonly reason?: string;
  }): void {
    for (const progress of this.agentSwarmProgress.values()) {
      progress.applyCouncilDecision(input);
    }
  }

  applySwarmPausedToSwarmProgress(input: {
    readonly reason: string;
    readonly phase?: string;
  }): void {
    for (const progress of this.agentSwarmProgress.values()) {
      progress.applySwarmPaused(input);
    }
  }

  hasAgentSwarmProgress(toolCallId: string): boolean {
    return this.agentSwarmProgress.has(toolCallId);
  }

  /**
   * Invoke War Room action dock on every live UltraSwarm/AgentSwarm progress card.
   * Returns how many components accepted the action (0 if none active).
   */
  invokeWarRoomAction(
    action: 'pause' | 'restaff' | 'raw',
    options: { readonly reason?: string } = {},
  ): number {
    let count = 0;
    for (const progress of this.agentSwarmProgress.values()) {
      if (!progress.isToolCallActive()) continue;
      if (action === 'pause') {
        progress.requestPause({
          reason: resolveWarRoomReason('pause', options.reason),
        });
      } else if (action === 'restaff') {
        progress.requestRestaff({
          reason: resolveWarRoomReason('restaff', options.reason),
        });
      } else {
        progress.toggleRawFeed();
      }
      count += 1;
    }
    if (count > 0) this.requestRender();
    return count;
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
      // Adaptive restaff / second staffing wave ends the dock restaffing state.
      if (progress.isRestaffing()) {
        progress.applySwarmRestaffing({ active: false });
      }
    });
  }

  /**
   * Routes a collaboration message into the live UltraSwarm feed.
   * @returns true when an active swarm progress component owned the feed line
   */
  handleUltraworkCollaborationMessage(
    event: Extract<Event, { type: 'ultrawork.collaboration.message' }>,
  ): boolean {
    const toolCallId = event.message.parentToolCallId;
    if (toolCallId.length === 0) return false;
    return this.updateAgentSwarmProgress(toolCallId, (progress) => {
      progress.applySwarmCollaborationMessage(event.message);
    });
  }

  /**
   * Routes a collaboration mention into the live UltraSwarm feed.
   * @returns true when an active swarm progress component owned the feed line
   */
  handleUltraworkCollaborationMention(
    event: Extract<Event, { type: 'ultrawork.collaboration.mention' }>,
  ): boolean {
    const toolCallId = event.message.parentToolCallId;
    if (toolCallId.length === 0) return false;
    return this.updateAgentSwarmProgress(toolCallId, (progress) => {
      progress.applySwarmCollaborationMention(event.message);
    });
  }

  /**
   * Routes debate turns into active UltraSwarm war-room reels.
   * Debate events are run-scoped (no parentToolCallId), so broadcast to live swarms.
   * @returns true when at least one swarm progress component accepted the turn
   */
  handleUltraworkCollaborationDebate(
    event: Extract<Event, { type: 'ultrawork.collaboration.debate' }>,
  ): boolean {
    let owned = false;
    for (const progress of this.agentSwarmProgress.values()) {
      progress.applySwarmCollaborationDebate({
        debateId: event.debateId,
        phase: event.phase,
        expertId: event.expertId,
        expertName: event.expertName,
        text: event.text,
        stance: event.stance,
      });
      owned = true;
    }
    return owned;
  }

  /**
   * Routes steer turns into active UltraSwarm war-room reels.
   * @returns true when at least one swarm progress component accepted the turn
   */
  handleUltraworkCollaborationSteer(
    event: Extract<Event, { type: 'ultrawork.collaboration.steer' }>,
  ): boolean {
    let owned = false;
    for (const progress of this.agentSwarmProgress.values()) {
      progress.applySwarmCollaborationSteer({
        debateId: event.debateId,
        text: event.text,
        fromUser: event.fromUser,
      });
      owned = true;
    }
    return owned;
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
    this.maybeSurfaceSubagentModel(event);

    if (this.shouldUseSwarmProgressUi(event.parentToolCallId, event.runInBackground)) {
      this.handleForegroundSubagentSpawned(event);
      return;
    }

    const meta = this.buildBackgroundAgentMetadata(event);
    this.backgroundAgentMetadata.set(event.subagentId, meta);
    this.appendBackgroundAgentEntry('started', meta);
    this.deps.syncBackgroundAgentBadge();
  }

  /** When a child (esp. explore) lands on a different model, say so once. */
  private maybeSurfaceSubagentModel(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    const modelAlias = event.modelAlias;
    if (modelAlias === undefined || modelAlias.length === 0) return;
    const sessionModel = this.host.state.appState.model;
    if (sessionModel.length === 0 || sessionModel === modelAlias) return;
    const models = this.host.state.appState.availableModels;
    // Same underlying model under a different alias — keep quiet.
    if (
      isSameEffectiveModel(
        resolveModelRouteIdentity(sessionModel, models),
        resolveModelRouteIdentity(modelAlias, models),
      )
    ) {
      return;
    }
    // Only surface explore/cheap diversions — avoid noise for same-as-parent clones.
    const profile = event.subagentName.toLowerCase();
    const isExplore =
      profile.includes('explore') ||
      profile.includes('search') ||
      profile.includes('research');
    if (!isExplore) return;
    this.host.showNotice(
      'Subagent model',
      `${event.subagentName}: ${modelRouteDisplayName(sessionModel, models)} → ${modelRouteDisplayName(modelAlias, models)}`,
      { coalesceKey: `model-route:subagent:${event.subagentId}` },
    );
    this.host.setAppState({
      lastModelRouteNotice: {
        kind: 'selection',
        fromAlias: sessionModel,
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
    const info = this.subagentInfo.get(event.subagentId);
    if (
      info !== undefined &&
      this.shouldUseSwarmProgressUi(info.parentToolCallId, info.runInBackground)
    ) {
      this.handleForegroundSubagentCompleted(event, info);
      return;
    }

    this.markSubagentActivityTerminal(event.subagentId, 'completed');
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

    this.markSubagentActivityTerminal(event.subagentId, 'failed');
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
      modelAlias: event.modelAlias,
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
      modelAlias: event.modelAlias,
    });
  }

  private handleForegroundSubagentSpawned(
    event: SubagentLifecycleEventOf<'subagent.spawned'>,
  ): void {
    if (this.updateAgentSwarmProgress(event.parentToolCallId, (progress) => {
      progress.registerSubagent({
        agentId: event.subagentId,
        swarmIndex: event.swarmIndex,
        modelAlias: event.modelAlias,
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
      modelAlias: event.modelAlias,
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
      this.markAgentSwarmFailedOrCancelled(progress, event.subagentId, event.error, event);
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
      // War Room file map: surface Edit/Write path claims for the active worker.
      if (event.name === 'Edit' || event.name === 'Write') {
        const args = argsRecord(event.args);
        const pathValue = args['path'];
        const path = typeof pathValue === 'string' ? pathValue.trim() : '';
        if (path.length > 0) {
          progress.applyFileLeaseClaim({ path, owner: subagentId });
        }
      }
    } else if (event.type === 'tool.result') {
      const summary =
        typeof event.output === 'string'
          ? event.output.slice(0, 80)
          : undefined;
      progress.recordToolResult({
        agentId: subagentId,
        toolCallId: event.toolCallId,
        isError: event.isError,
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

  /**
   * War-room action dock pause: pause active Ultrawork/UltraSwarm run when a session exists.
   */
  private handleWarRoomPauseRequest(request: {
    readonly reason?: string;
    readonly phase?: string;
  }): void {
    const session = this.host.session;
    if (session === undefined) return;
    const reason = resolveWarRoomReason('pause', request.reason);
    void session.pauseUltrawork({ reason }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.host.showError(`Failed to pause UltraSwarm: ${message}`);
    });
  }

  /**
   * War-room action dock restaff: force an UltraSwarm adaptive restaff wave via
   * session.swarmRestaff (Agent.swarmRestaff). Falls back to steer text when the
   * RPC rejects or no UltraSwarm run is active.
   */
  private handleWarRoomRestaffRequest(request: {
    readonly reason?: string;
    readonly phase?: string;
  }): void {
    const session = this.host.session;
    if (session === undefined) return;
    const reasonWithPhase = formatWarRoomRestaffReason(request);
    void session
      .swarmRestaff({ reason: reasonWithPhase })
      .then((accepted) => {
        if (accepted) return;
        // No active UltraSwarm run context — keep steer fallback for older paths.
        return session.steer(buildWarRoomRestaffSteerDirective(request));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.host.showError(`Failed to request UltraSwarm restaff: ${message}`);
      });
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

    const isUltraSwarm = (options.toolName ?? 'AgentSwarm') === 'UltraSwarm';
    const progress = new AgentSwarmProgressComponent({
      description: agentSwarmDescriptionFromArgs(args),
      title: swarmProgressTitleForToolName(options.toolName ?? 'AgentSwarm'),
      availableGridHeight: () => this.agentSwarmGridHeight(isUltraSwarm),
      requestRender: () => {
        this.requestRender();
      },
      onRequestPause: isUltraSwarm
        ? (request) => {
            this.handleWarRoomPauseRequest(request);
          }
        : undefined,
      onRequestRestaff: isUltraSwarm
        ? (request) => {
            this.handleWarRoomRestaffRequest(request);
          }
        : undefined,
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
    event?: SubagentLifecycleEventOf<'subagent.failed'>,
  ): void {
    if (isUserCancelledSubagentError(error)) {
      progress.markCancelled(subagentId);
    } else {
      const retryNote = event === undefined ? undefined : subagentFailureRetryNote(event);
      progress.markFailed(
        subagentId,
        error,
        retryNote === undefined ? undefined : { retryNote },
      );
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

/**
 * Retry / fallback hints are not part of the protocol schema yet, so read
 * them defensively. When a server starts emitting them the swarm failure
 * cell shows a dim note such as ` · retrying (2/3)` or ` · fell back to …`.
 */
function subagentFailureRetryNote(
  event: SubagentLifecycleEventOf<'subagent.failed'>,
): string | undefined {
  const extras = event as unknown as Record<string, unknown>;
  const parts: string[] = [];
  const retryAttempt = extras['retryAttempt'];
  if (typeof retryAttempt === 'number' && Number.isFinite(retryAttempt) && retryAttempt > 0) {
    const retryLimit = extras['retryLimit'];
    parts.push(
      typeof retryLimit === 'number' && Number.isFinite(retryLimit) && retryLimit > 0
        ? `retrying (${String(retryAttempt)}/${String(retryLimit)})`
        : `retrying (attempt ${String(retryAttempt)})`,
    );
  }
  const fellBackToModel = extras['fellBackToModel'];
  if (typeof fellBackToModel === 'string' && fellBackToModel.trim().length > 0) {
    parts.push(`fell back to ${fellBackToModel.trim()}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
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
