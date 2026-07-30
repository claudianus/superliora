import type { Component, Focusable } from '#/tui/renderer';
import type {
  AgentStatusUpdatedEvent,
  BackgroundTaskInfo,
  BackgroundTaskStartedEvent,
  BackgroundTaskTerminatedEvent,
  CronFiredEvent,
  ErrorEvent,
  Event,
  GoalChange,
  HookResultEvent,
  PluginCommandActivatedEvent,
  Session,
  SessionMetaUpdatedEvent,
  SkillActivatedEvent,
  WarningEvent,
} from '@superliora/sdk';

import { MoonLoader } from '../components/chrome/moon-loader';
import { StatusMessageComponent } from '../components/messages/status-message';
import {
  SwarmModeMarkerComponent,
  type SwarmModeMarkerState,
} from '../components/messages/swarm-markers';
import {
  isUltraworkTheatreEvent,
  UltraworkTheatreComponent,
  ultraworkTheatreRunId,
  type UltraworkTheatreEvent,
} from '../components/messages/ultrawork-theatre';
import { UltraworkModeMarkerComponent } from '../components/messages/ultrawork-markers';
import {
  OAUTH_LOGIN_REQUIRED_CODE,
  OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE,
} from '../constant/liora-tui';
import {
  notifyBackgroundTaskAttention,
} from '../utils/attention-notifications';
import {
  formatErrorPayload,
  stringValue,
} from '../utils/event-payload';
import { formatBackgroundTaskTranscript } from '../utils/background-task-status';
import { formatHookResultMarkdown } from '../utils/hook-result-format';
import { McpOAuthAuthorizationUrlOpener } from '../utils/mcp-oauth';
import {
  formatMcpStartupStatusSummary,
  mcpServerStatusKey,
  type McpServerStatusSnapshot,
  selectMcpStartupStatusRows,
} from '../utils/mcp-server-status';
import { openUrl } from '#/utils/open-url';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import { errorReportHintLine } from '../constant/feedback';
import { computeSessionCostUsd } from '#/tui/utils/session-cost';
import { requestTUILayoutRender } from '../utils/frame-render';
import { ttui } from '../utils/tui-i18n';
import { nextTranscriptId } from '../utils/transcript-id';
import type { BtwPanelController } from './btw-panel';
import type { StreamingUIController } from './streaming-ui';
import type { TasksBrowserController } from './tasks-browser';
import { SessionEventCompaction } from './session-event-compaction';
import { SessionEventGoalQueue } from './session-event-goal-queue';
import { SessionEventTools } from './session-event-tools';
import { SessionEventTurn } from './session-event-turn';
import { SubAgentEventHandler } from './subagent-event-handler';
import type {
  AppState,
  LivePaneState,
  QueuedMessage,
  TranscriptEntry,
} from '../types';
import type { TUIState } from '../tui-state';
import type { MotionBeatController } from '../utils/motion-beats';
import { notifyError } from '../utils/desktop-notification';

export interface SessionEventHost {
  state: TUIState;
  session: Session | undefined;
  aborted: boolean;
  sessionEventUnsubscribe: (() => void) | undefined;
  readonly streamingUI: StreamingUIController;
  readonly motionBeats: MotionBeatController;

  requireSession(): Session;
  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  resetLivePane(): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  updateActivityPane(): void;
  track(event: string, props?: Record<string, unknown>): void;
  mountEditorReplacement(panel: Component & Focusable): void;
  restoreEditor(): void;
  restoreInputText(text: string): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void;
  handleShellStarted(event: { commandId: string; taskId: string }): void;
  sendNormalUserInput(text: string): void;
  updateTerminalTitle(): void;
  sendQueuedMessage(session: Session, item: QueuedMessage): void;
  shiftQueuedMessage(): QueuedMessage | undefined;
  setLastTurnFailed(failed: boolean): void;
  readonly btwPanelController: BtwPanelController;
  readonly tasksBrowserController: TasksBrowserController;
}

export class SessionEventHandler {
  readonly subAgentEventHandler: SubAgentEventHandler;
  private readonly compaction: SessionEventCompaction;
  private readonly goalQueue: SessionEventGoalQueue;
  private readonly tools: SessionEventTools;
  private readonly turn: SessionEventTurn;

  /** Optional activity feed for the workspace transparency panel. */

  constructor(private readonly host: SessionEventHost) {
    this.compaction = new SessionEventCompaction(host);
    this.goalQueue = new SessionEventGoalQueue(host, {
      getGoalCompletionTurnEnded: () => this.goalCompletionTurnEnded,
      setGoalCompletionTurnEnded: (value) => {
        this.goalCompletionTurnEnded = value;
      },
      getCurrentTurnHasAssistantText: () => this.currentTurnHasAssistantText,
      setPendingModelBlockedFallback: (value) => {
        this.pendingModelBlockedFallback = value;
      },
    });
    this.subAgentEventHandler = new SubAgentEventHandler(host, {
      backgroundTasks: this.backgroundTasks,
      backgroundTaskTranscriptedTerminal: this.backgroundTaskTranscriptedTerminal,
      syncBackgroundAgentBadge: () => {
        this.syncBackgroundTaskBadge();
      },
    });
    this.tools = new SessionEventTools(host, {
      handleAgentSwarmToolCallStarted: (toolCallId, args, name) => {
        this.subAgentEventHandler.handleAgentSwarmToolCallStarted(toolCallId, args, name);
      },
      handleAgentSwarmToolCallDelta: (toolCallId, args, options, name) => {
        this.subAgentEventHandler.handleAgentSwarmToolCallDelta(toolCallId, args, options, name);
      },
      hasAgentSwarmProgress: (toolCallId) => {
        return this.subAgentEventHandler.hasAgentSwarmProgress(toolCallId);
      },
      handleAgentSwarmToolResult: (toolCallId, resultData, isError) => {
        this.subAgentEventHandler.handleAgentSwarmToolResult(toolCallId, resultData, isError);
      },
    });
    this.turn = new SessionEventTurn(host, {
      clearAgentSwarmProgress: () => {
        this.clearAgentSwarmProgress();
      },
      markActiveAgentSwarmsCancelled: () => {
        this.subAgentEventHandler.markActiveAgentSwarmsCancelled();
      },
      scheduleQueuedGoalPromotion: () => {
        this.goalQueue.scheduleQueuedGoalPromotion();
      },
      setCurrentTurnHasAssistantText: (value) => {
        this.currentTurnHasAssistantText = value;
      },
      setGoalCompletionTurnEnded: (value) => {
        this.goalCompletionTurnEnded = value;
      },
      getPendingModelBlockedFallback: () => this.pendingModelBlockedFallback,
      setPendingModelBlockedFallback: (value) => {
        this.pendingModelBlockedFallback = value;
      },
    });
  }

  // Runtime state – owned by this handler, reset between sessions.
  backgroundTasks: Map<string, BackgroundTaskInfo> = new Map();
  backgroundTaskTranscriptedTerminal: Set<string> = new Set();

  renderedSkillActivationIds: Set<string> = new Set();
  renderedPluginCommandActivationIds: Set<string> = new Set();
  renderedMcpServerStatusKeys: Map<string, string> = new Map();
  mcpServerStatusSpinners: Map<string, MoonLoader> = new Map();
  ultraworkTheatres: Map<string, UltraworkTheatreComponent> = new Map();
  private ultraworkCompletionHandledRuns: Set<string> = new Set();
  mcpServers: Map<string, McpServerStatusSnapshot> = new Map();
  /** Shared with goal-queue + turn (assistant.delta / turn.ended / hook.result). */
  private goalCompletionTurnEnded = false;
  private currentTurnHasAssistantText = false;
  private pendingModelBlockedFallback: GoalChange | undefined;

  resetRuntimeState(): void {
    this.backgroundTasks.clear();
    this.backgroundTaskTranscriptedTerminal.clear();
    this.ultraworkTheatres.clear();
    this.ultraworkCompletionHandledRuns.clear();
    this.subAgentEventHandler.resetRuntimeState();
    this.renderedSkillActivationIds.clear();
    this.renderedPluginCommandActivationIds.clear();
    this.renderedMcpServerStatusKeys.clear();
    this.mcpServers.clear();
    this.goalCompletionTurnEnded = false;
    this.currentTurnHasAssistantText = false;
    this.pendingModelBlockedFallback = undefined;
    this.turn.resetRuntimeState();
    this.goalQueue.resetRuntimeState();
    this.stopAllMcpServerStatusSpinners();
  }

  clearAgentSwarmProgress(): void {
    this.subAgentEventHandler.clearAgentSwarmProgress();
  }

  hasActiveAgentSwarmToolCall(): boolean {
    return this.subAgentEventHandler.hasActiveAgentSwarmToolCall();
  }

  /** Forward War Room dock actions (pause / restaff / raw) to live swarm cards. */
  invokeWarRoomAction(
    action: 'pause' | 'restaff' | 'raw',
    options: { readonly reason?: string } = {},
  ): number {
    return this.subAgentEventHandler.invokeWarRoomAction(action, options);
  }

  syncAgentSwarmActivitySpinner(spinner: MoonLoader | undefined): void {
    this.subAgentEventHandler.syncAgentSwarmActivitySpinner(spinner);
  }

  startSubscription(): void {
    const { host } = this;
    const session = host.requireSession();
    const sendQueued = (item: QueuedMessage): void => {
      host.sendQueuedMessage(session, item);
    };
    host.sessionEventUnsubscribe?.();
    const mcpOAuthOpener = new McpOAuthAuthorizationUrlOpener(openUrl);
    const { sessionId } = host.state.appState;
    host.sessionEventUnsubscribe = session.onEvent((event) => {
      if (host.aborted) return;
      if (event.sessionId !== sessionId) return;
      if (event.type === 'tool.progress') {
        mcpOAuthOpener.handleToolProgress(event);
      }
      this.handleEvent(event, sendQueued);
    });
    void this.syncMcpServerStatusSnapshot(session);
  }

  async syncMcpServerStatusSnapshot(session: Session): Promise<void> {
    const { host } = this;
    let servers: readonly McpServerStatusSnapshot[];
    try {
      servers = await session.listMcpServers();
    } catch (error) {
      if (host.session !== session || host.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      host.showError(`Failed to sync MCP server status: ${message}`);
      return;
    }
    if (host.session !== session || host.state.appState.sessionId !== session.id) return;

    const visible = selectMcpStartupStatusRows(servers);
    const visibleNames = new Set(visible.map((server) => server.name));
    for (const server of visible) {
      if (this.renderedMcpServerStatusKeys.has(server.name)) continue;
      this.renderMcpServerStatus(server);
    }

    this.mcpServers.clear();
    for (const server of servers) {
      this.mcpServers.set(server.name, server);
    }
    const hidden: McpServerStatusSnapshot[] = [];
    for (const server of servers) {
      if (visibleNames.has(server.name)) continue;
      if (this.renderedMcpServerStatusKeys.has(server.name)) continue;
      this.renderedMcpServerStatusKeys.set(server.name, mcpServerStatusKey(server));
      hidden.push(server);
    }
    const summary = formatMcpStartupStatusSummary(servers);
    host.setAppState({ mcpServersSummary: summary || null });
  }

  handleEvent(event: Event, sendQueued: (item: QueuedMessage) => void): void {
    if (this.subAgentEventHandler.routeChildAgentEvent(event)) return;

    if ('turnId' in event && event.turnId !== undefined) {
      this.host.streamingUI.setTurnId(String(event.turnId));
    }

    if (event.type === 'ultrawork.routing.decided') {
      this.subAgentEventHandler.applyRoutingDecisionToSwarmProgress({
        decision: event.decision,
        intensity: event.intensity,
        estimatedExperts: event.estimatedExperts,
      });
      requestTUILayoutRender(this.host.state);
      return;
    }

    
    if (event.type === 'ultrawork.swarm.paused') {
      this.subAgentEventHandler.applySwarmPausedToSwarmProgress({
        reason: event.reason,
        phase: event.phase,
      });
      requestTUILayoutRender(this.host.state);
      return;
    }

    if (event.type === 'ultrawork.council.decision') {
      this.subAgentEventHandler.applyCouncilDecisionToSwarmProgress({
        decision: event.decision.decision,
        reason: event.decision.reason,
      });
      requestTUILayoutRender(this.host.state);
      // fall through so theatre can also record it when applicable
    }


    if (isUltraworkTheatreEvent(event)) {
      this.handleUltraworkEvent(event);
      return;
    }

    switch (event.type) {
      case 'turn.started': this.turn.handleTurnBegin(event); break;
      case 'turn.ended': this.turn.handleTurnEnd(event, sendQueued); break;
      case 'turn.step.started': this.turn.handleStepBegin(event); break;
      case 'turn.step.interrupted': this.turn.handleStepInterrupted(event); break;
      case 'turn.step.completed': this.turn.handleStepCompleted(event); break;
      case 'turn.step.retrying': this.turn.handleStepRetrying(event); break;
      case 'tool.progress': this.tools.handleToolProgress(event); break;
      case 'shell.output': this.tools.handleShellOutput(event); break;
      case 'shell.started': this.tools.handleShellStarted(event); break;
      case 'assistant.delta': this.turn.handleAssistantDelta(event); break;
      case 'hook.result': this.handleHookResult(event); break;
      case 'thinking.delta': this.turn.handleThinkingDelta(event); break;
      case 'tool.call.started': this.tools.handleToolCall(event); break;
      case 'tool.call.delta': this.tools.handleToolCallDelta(event); break;
      case 'tool.result': this.tools.handleToolResult(event); break;
      case 'agent.status.updated': this.handleStatusUpdate(event); break;
      case 'session.meta.updated': this.handleSessionMetaChanged(event); break;
      case 'goal.updated': this.goalQueue.handleUpdated(event); break;
      case 'skill.activated': this.handleSkillActivated(event); break;
      case 'plugin_command.activated': this.handlePluginCommandActivated(event); break;
      case 'error': this.handleSessionError(event); break;
      case 'warning': this.handleSessionWarning(event); break;
      case 'compaction.started': this.compaction.handleBegin(event); break;
      case 'compaction.completed': this.compaction.handleEnd(event, sendQueued); break;
      case 'compaction.blocked': this.compaction.handleBlocked(event); break;
      case 'compaction.cancelled': this.compaction.handleCancel(event, sendQueued); break;
      case 'compaction.progress': this.compaction.handleProgress(event); break;
      case 'subagent.spawned':
      case 'subagent.started':
      case 'subagent.suspended':
      case 'subagent.completed':
      case 'subagent.failed':
        this.subAgentEventHandler.handleLifecycleEvent(event);
        // Track subagent lifecycle in activity feed
                break;
      case 'subagent.todo.updated':
        this.subAgentEventHandler.handleSubagentTodoUpdated(event); break;
      case 'subagent.tool_call':
      case 'subagent.tool_result':
        this.subAgentEventHandler.handleSubagentToolActivity(event); break;
      case 'tools.update_store':
        this.tools.handleToolsUpdateStore(event); break;
      case 'background.task.started':
      case 'background.task.terminated':
        this.handleBackgroundTaskEvent(event); break;
      case 'cron.fired': this.handleCronFired(event); break;
      case 'mcp.server.status': this.renderMcpServerStatus(event.server); break;
      case 'tool.list.updated': break;
      default: break;
    }
  }

  private handleUltraworkEvent(event: UltraworkTheatreEvent): void {
    if (
      event.type === 'ultrawork.stage.changed' &&
      // to='done' is the normal completion path; run.status='failed' covers
      // the terminal event cancel() now emits (stage is unchanged, so only
      // the run status marks it terminal). Both must restore prior state.
      (event.to === 'done' || event.run.status === 'failed')
    ) {
      this.finishUltraworkRun(event);
    }
    if (event.type === 'ultrawork.team.staffed') {
      this.subAgentEventHandler.handleUltraworkTeamStaffed(event);
    }

    // Collaboration chat feed owns a single sink: AgentSwarmProgress when active.
    // Debate/steer also paint the war-room reel when a swarm is live; theatre remains
    // the fallback surface only when no swarm progress owns the event.
    let collaborationFeedOwnedBySwarm = false;
    if (event.type === 'ultrawork.collaboration.message') {
      collaborationFeedOwnedBySwarm =
        this.subAgentEventHandler.handleUltraworkCollaborationMessage(event);
    }
    if (event.type === 'ultrawork.collaboration.mention') {
      collaborationFeedOwnedBySwarm =
        this.subAgentEventHandler.handleUltraworkCollaborationMention(event) ||
        collaborationFeedOwnedBySwarm;
    }
    if (event.type === 'ultrawork.collaboration.debate') {
      collaborationFeedOwnedBySwarm =
        this.subAgentEventHandler.handleUltraworkCollaborationDebate(event) ||
        collaborationFeedOwnedBySwarm;
    }
    if (event.type === 'ultrawork.collaboration.steer') {
      collaborationFeedOwnedBySwarm =
        this.subAgentEventHandler.handleUltraworkCollaborationSteer(event) ||
        collaborationFeedOwnedBySwarm;
    }
    if (
      collaborationFeedOwnedBySwarm &&
      (event.type === 'ultrawork.collaboration.message' ||
        event.type === 'ultrawork.collaboration.mention' ||
        event.type === 'ultrawork.collaboration.debate' ||
        event.type === 'ultrawork.collaboration.steer')
    ) {
      requestTUILayoutRender(this.host.state);
      return;
    }

    const runId = ultraworkTheatreRunId(event);
    const existing = this.ultraworkTheatres.get(runId);
    if (existing === undefined) {
      const theatre = new UltraworkTheatreComponent(event);
      this.ultraworkTheatres.set(runId, theatre);
      this.host.state.transcriptContainer.addChild(theatre);
    } else {
      existing.applyEvent(event);
    }
    requestTUILayoutRender(this.host.state);
  }

  private finishUltraworkRun(event: Extract<UltraworkTheatreEvent, { type: 'ultrawork.stage.changed' }>): void {
    const runId = event.run.id;
    if (this.ultraworkCompletionHandledRuns.has(runId)) return;
    this.ultraworkCompletionHandledRuns.add(runId);

    // Restore the session flags the run took over, if we captured them at
    // start. Without a snapshot (e.g. a run resumed from a prior session) we
    // fall back to turning everything off, matching the prior behaviour.
    const prior = this.host.state.appState.ultraworkPriorState ?? null;
    const restorePlanMode = prior?.planMode ?? false;
    const restoreSwarmMode = prior?.swarmMode ?? false;
    const restorePremiumQuality = prior?.premiumQualityMode ?? false;
    this.host.state.swarmModeEntry = prior?.swarmModeEntry;
    this.host.setAppState({
      ultraworkMode: false,
      planMode: restorePlanMode,
      swarmMode: restoreSwarmMode,
      premiumQualityMode: restorePremiumQuality,
      activityTip: null,
      ultraworkPriorState: null,
    });
    const session = this.host.requireSession();
    void session.setPlanMode(restorePlanMode, false).catch(() => {});
    if (prior === null || prior.swarmMode !== restoreSwarmMode) {
      void session.setSwarmMode(restoreSwarmMode, 'task').catch(() => {});
    }
    void session.setPremiumQuality(restorePremiumQuality).catch(() => {});

    const failed = event.run.status === 'failed';
    const reason = event.reason?.trim();
    const objective = event.run.objective.trim();
    this.host.state.transcriptContainer.addChild(
      new UltraworkModeMarkerComponent({
        state: 'ended',
        taskDescription: objective,
      }),
    );
    this.host.showNotice(
      failed ? 'Ultrawork ended' : 'Ultrawork completed',
      [
        objective,
        reason !== undefined && reason.length > 0
          ? reason
          : failed
            ? 'Run cancelled or failed.'
            : 'All stages finished successfully.',
        'Ultrawork mode is off. Use Shift-Tab or /ultrawork to start another run.',
      ].join('\n'),
      { coalesceKey: `ultrawork-completed:${runId}` },
    );
    requestTUILayoutRender(this.host.state);
  }

  stopAllMcpServerStatusSpinners(): void {
    for (const spinner of this.mcpServerStatusSpinners.values()) {
      spinner.stop();
    }
    this.mcpServerStatusSpinners.clear();
  }

  // ---------------------------------------------------------------------------
  // Private handlers
  // ---------------------------------------------------------------------------

  private handleCronFired(event: CronFiredEvent): void {
    this.host.streamingUI.flushNow();
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'cron',
      turnId: this.host.streamingUI.getTurnContext().turnId,
      renderMode: 'plain',
      content: event.prompt,
      cronData: {
        jobId: event.origin.jobId,
        cron: event.origin.cron,
        recurring: event.origin.recurring,
        coalescedCount: event.origin.coalescedCount,
        stale: event.origin.stale,
      },
    });
  }

  private handleHookResult(event: HookResultEvent): void {
    this.host.streamingUI.flushNow();
    if (this.host.streamingUI.hasThinkingDraft()) {
      this.host.streamingUI.flushThinkingToTranscript('idle');
    }
    this.host.streamingUI.finalizeAssistantStream();
    if (event.content.trim().length > 0) {
      this.currentTurnHasAssistantText = true;
      this.pendingModelBlockedFallback = undefined;
    }
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'assistant',
      turnId: String(event.turnId),
      renderMode: 'markdown',
      content: formatHookResultMarkdown(event),
    });
    this.host.patchLivePane({
      mode: 'idle',
      pendingApproval: null,
      pendingQuestion: null,
    });
  }

  private handleStatusUpdate(event: AgentStatusUpdatedEvent): void {
    const shouldRenderSwarmEnded =
      event.swarmMode === false &&
      this.host.state.appState.swarmMode &&
      this.host.state.swarmModeEntry === 'task';
    const patch: Partial<AppState> = {};
    if (event.contextUsage !== undefined) patch.contextUsage = event.contextUsage;
    if (event.contextTokens !== undefined) patch.contextTokens = event.contextTokens;
    if (event.maxContextTokens !== undefined) patch.maxContextTokens = event.maxContextTokens;
    if (event.usage?.total !== undefined) {
      const modelId = event.model ?? this.host.state.appState.model;
      const pricing = this.host.state.appState.availableModels[modelId]?.cost;
      const costUsd = computeSessionCostUsd(event.usage.total, pricing);
      if (costUsd !== undefined) patch.sessionCostUsd = costUsd;
    }
    if ('contextOS' in event) patch.contextOS = event.contextOS ?? null;
    if ('microCompaction' in event) patch.microCompaction = event.microCompaction ?? null;
    if ('autoDream' in event) patch.autoDream = event.autoDream ?? null;
    if (event.planMode !== undefined) {
      patch.planMode = event.planMode;
    }
    if (event.swarmMode !== undefined) patch.swarmMode = event.swarmMode;
    if (event.premiumQualityMode !== undefined) {
      patch.premiumQualityMode = event.premiumQualityMode;
    }
    if (event.orchestratorMode !== undefined) {
      patch.orchestratorMode = event.orchestratorMode;
    }
    if (event.orchestratorWorkers !== undefined) {
      patch.orchestratorWorkers = event.orchestratorWorkers;
    }
    if (event.permission !== undefined) {
      patch.permissionMode = event.permission;
    }
    if (event.model !== undefined) patch.model = event.model;
    if ('providerRoute' in event) patch.providerRouteStatus = event.providerRoute ?? null;
    if (Object.keys(patch).length > 0) this.host.setAppState(patch);
    if (event.swarmMode === false) {
      this.host.state.swarmModeEntry = undefined;
      if (shouldRenderSwarmEnded) {
        this.renderSwarmModeMarker('ended');
      }
    }
  }

  private renderSwarmModeMarker(state: SwarmModeMarkerState): void {
    this.host.state.transcriptContainer.addChild(
      new SwarmModeMarkerComponent(state),
    );
    requestTUILayoutRender(this.host.state);
  }

  requestQueuedGoalPromotion(): void {
    this.goalQueue.requestQueuedGoalPromotion();
  }

  retryQueuedGoalPromotion(): void {
    this.goalQueue.retryQueuedGoalPromotion();
  }

  private handleSessionMetaChanged(event: SessionMetaUpdatedEvent): void {
    const title = event.title ?? stringValue(event.patch?.['title']);
    if (title !== undefined) {
      this.host.setAppState({ sessionTitle: title });
      this.host.updateTerminalTitle();
    }
  }

  private handleSessionError(event: ErrorEvent): void {
    this.host.streamingUI.flushNow();
    this.host.streamingUI.resetToolUi();
    this.host.streamingUI.finalizeLiveTextBuffers('idle');
    // Desktop notification on error
    notifyError(event.message ?? '세션 오류 발생');
    // Mark the last turn as failed so the user can re-send it with Hub Retry
    // or `/retry`.
    this.host.setLastTurnFailed(true);
    if (event.code === OAUTH_LOGIN_REQUIRED_CODE) {
      this.host.showError(OAUTH_LOGIN_REQUIRED_STARTUP_NOTICE);
      return;
    }
    this.host.showError(formatErrorPayload(event));
    const sessionId = this.host.state.appState.sessionId;
    if (sessionId.length > 0) {
      this.host.showStatus(errorReportHintLine());
      this.host.appendTranscriptEntry({
        id: `retry-hint-${Date.now()}`,
        kind: 'status',
        turnId: undefined,
        renderMode: 'plain',
        content: ttui('tui.retry.hint'),
        color: 'warning',
        bullet: '',
      });
    }
  }

  private handleSessionWarning(event: WarningEvent): void {
    if (event.code === 'vision_analyzer.analyzed') {
      const details = event.details ?? {};
      const analyzerModel = details['analyzerModel'];
      const kind = details['kind'];
      const model =
        typeof analyzerModel === 'string' && analyzerModel.length > 0
          ? analyzerModel
          : undefined;
      const noun =
        kind === 'video'
          ? '비디오를'
          : kind === 'image'
            ? '이미지를'
            : '첨부 미디어를';
      this.host.showStatus(
        model !== undefined
          ? `${noun} ${model}로 분석했습니다.`
          : '첨부 미디어를 비전 모델로 분석했습니다.',
        'success',
      );
      return;
    }
    this.host.showStatus(`Warning: ${event.message}`, 'warning');
  }

  private renderMcpServerStatus(server: McpServerStatusSnapshot): void {
    const key = mcpServerStatusKey(server);
    if (this.renderedMcpServerStatusKeys.get(server.name) === key) return;
    this.renderedMcpServerStatusKeys.set(server.name, key);
    this.mcpServers.set(server.name, server);
    const summary = formatMcpStartupStatusSummary([...this.mcpServers.values()]);
    this.host.setAppState({ mcpServersSummary: summary || null });

    switch (server.status) {
      case 'connected': {
        const toolStr = `${server.toolCount} tool${server.toolCount === 1 ? '' : 's'}`;
        const message = `MCP server "${server.name}" connected · ${toolStr} (${server.transport})`;
        this.finalizeMcpServerStatusRow(server.name, message, 'success');
        return;
      }
      case 'failed': {
        const message = `MCP server "${server.name}" failed${server.error !== undefined ? `: ${server.error}` : ''}`;
        this.finalizeMcpServerStatusRow(server.name, message, 'error');
        return;
      }
      case 'needs-auth': {
        const message = `MCP server "${server.name}" needs OAuth — run /mcp-config login ${server.name}`;
        this.finalizeMcpServerStatusRow(server.name, message, 'warning');
        return;
      }
      case 'disabled':
        this.finalizeMcpServerStatusRow(
          server.name,
          `MCP server "${server.name}" disabled`,
          'textMuted',
        );
        return;
      case 'pending':
        this.showMcpServerStatusSpinner(server.name);
        return;
    }
  }

  private showMcpServerStatusSpinner(name: string): void {
    const { state } = this.host;
    const label = `MCP server "${name}" connecting…`;
    const existing = this.mcpServerStatusSpinners.get(name);
    if (existing !== undefined) {
      existing.setLabel(label);
      return;
    }
    const tint = (s: string): string => currentTheme.fg('textMuted', s);
    const spinner = new MoonLoader(state.ui, 'braille', tint, label);
    state.transcriptContainer.addChild(spinner);
    this.mcpServerStatusSpinners.set(name, spinner);
    requestTUILayoutRender(state);
  }

  private finalizeMcpServerStatusRow(name: string, message: string, color: ColorToken): void {
    const { state } = this.host;
    const spinner = this.mcpServerStatusSpinners.get(name);
    if (spinner === undefined) {
      this.host.showStatus(message, color);
      return;
    }
    spinner.stop();
    const status = new StatusMessageComponent(message, color);
    const children = state.transcriptContainer.children;
    const idx = children.indexOf(spinner);
    if (idx >= 0) {
      children[idx] = status;
      state.transcriptContainer.invalidate();
    } else {
      state.transcriptContainer.addChild(status);
    }
    this.mcpServerStatusSpinners.delete(name);
    requestTUILayoutRender(state);
  }

  private handleSkillActivated(event: SkillActivatedEvent): void {
    if (this.renderedSkillActivationIds.has(event.activationId)) return;
    this.renderedSkillActivationIds.add(event.activationId);
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'skill_activation',
      turnId: undefined,
      renderMode: 'plain',
      content: `Activated skill: ${event.skillName}`,
      skillActivationId: event.activationId,
      skillName: event.skillName,
      skillArgs: event.skillArgs,
      skillTrigger: event.trigger,
    });
  }

  private handlePluginCommandActivated(event: PluginCommandActivatedEvent): void {
    if (this.renderedPluginCommandActivationIds.has(event.activationId)) return;
    this.renderedPluginCommandActivationIds.add(event.activationId);
    this.host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'plugin_command',
      turnId: undefined,
      renderMode: 'plain',
      content: `Ran command: ${event.pluginId}:${event.commandName}`,
      pluginCommandActivationId: event.activationId,
      pluginId: event.pluginId,
      pluginCommandName: event.commandName,
      pluginCommandArgs: event.commandArgs,
      pluginCommandTrigger: event.trigger,
    });
  }

  // ---------------------------------------------------------------------------
  // Background task lifecycle
  // ---------------------------------------------------------------------------

  private handleBackgroundTaskEvent(
    event: BackgroundTaskStartedEvent | BackgroundTaskTerminatedEvent,
  ): void {
    const { state } = this.host;
    const { info } = event;
    const previous = this.backgroundTasks.get(info.taskId);
    this.backgroundTasks.set(info.taskId, info);

    const viewer = state.tasksBrowser?.viewer;
    if (viewer !== undefined && viewer.taskId === info.taskId) {
      void this.host.tasksBrowserController.refreshOutputViewer({ silent: true });
    }

    const isTerminal =
      info.status === 'completed' ||
      info.status === 'failed' ||
      info.status === 'timed_out' ||
      info.status === 'killed' ||
      info.status === 'lost';

    if (event.type === 'background.task.started') {
      if (info.kind === 'agent') {
        // A foreground subagent detached via Ctrl+B: flip its card to
        // `◐ backgrounded` so it doesn't look like it completed.
        this.host.streamingUI.markSubagentBackgrounded(info.agentId);
        this.syncBackgroundTaskBadge();
        this.host.tasksBrowserController.repaint();
        return;
      }
      this.appendBackgroundTaskEntry(info);
      this.syncBackgroundTaskBadge();
      this.host.tasksBrowserController.repaint();
      return;
    }

    if (event.type === 'background.task.terminated' && isTerminal) {
      notifyBackgroundTaskAttention(state, info);
      if (info.kind === 'agent') {
        // The Agent tool's spawn-success ToolResult is not an error, so the
        // parent toolCall card would otherwise render `✓ Completed` for any
        // terminated bg agent — including `lost` / `failed` / `killed`.
        // Push the actual terminal status so the card matches reality.
        this.host.streamingUI.applyBackgroundTaskTerminalStatus({
          agentId: info.agentId,
          description: info.description,
          status: info.status,
        });
      }
      if (!this.backgroundTaskTranscriptedTerminal.has(info.taskId)) {
        if (info.kind === 'process' || info.kind === 'question') {
          this.appendBackgroundTaskEntry(info);
        }
        this.backgroundTaskTranscriptedTerminal.add(info.taskId);
      }
      this.syncBackgroundTaskBadge();
      this.host.tasksBrowserController.repaint();
      return;
    }

    if (previous?.status !== info.status) {
      this.syncBackgroundTaskBadge();
    }
    this.host.tasksBrowserController.repaint();
  }

  private appendBackgroundTaskEntry(info: BackgroundTaskInfo): void {
    const status = formatBackgroundTaskTranscript(info);
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

  private syncBackgroundTaskBadge(): void {
    const { state } = this.host;
    let bashTasks = 0;
    let agentTasks = 0;
    for (const info of this.backgroundTasks.values()) {
      if (
        info.status === 'completed' ||
        info.status === 'failed' ||
        info.status === 'timed_out' ||
        info.status === 'killed' ||
        info.status === 'lost'
      ) {
        continue;
      }
      if (info.kind === 'agent') {
        agentTasks += 1;
      } else {
        bashTasks += 1;
      }
    }
    state.footer.setBackgroundCounts({ bashTasks, agentTasks });
    requestTUILayoutRender(state);
  }
}
