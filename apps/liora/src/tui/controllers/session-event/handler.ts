import type { Component, Focusable } from '#/tui/renderer';
import type {
  BackgroundTaskInfo,
  Event,
  GoalChange,
  QueuedMessage,
  Session,
} from '@superliora/sdk';

import { MoonLoader } from '../../components/chrome/moon-loader';
import {
  isUltraworkTheatreEvent,
} from '../../components/messages/ultrawork/ultrawork-theatre';
import { McpOAuthAuthorizationUrlOpener } from '../../utils/mcp/mcp-oauth';
import { openUrl } from '#/utils/open-url';
import type { ColorToken } from '#/tui/theme';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import type { BtwPanelController } from '../panes/btw-panel';
import type { StreamingUIController } from '../streaming-ui/index';
import type { TasksBrowserController } from '../panes/tasks-browser';
import { SessionEventBackgroundTasks } from './background-tasks';
import { SessionEventCompaction } from './compaction';
import { SessionEventGoalQueue } from './goal-queue';
import { SessionEventMcpStatus } from './mcp-status';
import { SessionEventNotices } from './notices';
import { SessionEventTools } from './tools';
import { SessionEventTurn } from './turn';
import { SessionEventUltrawork } from './ultrawork';
import { SubAgentEventHandler } from '../subagent-event/handler';
import type {
  AppState,
  LivePaneState,
  TranscriptEntry,
} from '../../types';
import type { TUIState } from '../../tui-state';
import type { MotionBeatController } from '../../utils/render/motion-beats';

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
  private readonly ultrawork: SessionEventUltrawork;
  private readonly mcpStatus: SessionEventMcpStatus;
  private readonly backgroundTasksHandler: SessionEventBackgroundTasks;
  private readonly notices: SessionEventNotices;

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
    this.backgroundTasksHandler = new SessionEventBackgroundTasks(
      host,
      this.backgroundTasks,
      this.backgroundTaskTranscriptedTerminal,
    );
    this.subAgentEventHandler = new SubAgentEventHandler(host, {
      backgroundTasks: this.backgroundTasks,
      backgroundTaskTranscriptedTerminal: this.backgroundTaskTranscriptedTerminal,
      syncBackgroundAgentBadge: () => {
        this.backgroundTasksHandler.syncBadge();
      },
    });
    this.ultrawork = new SessionEventUltrawork(host, this.subAgentEventHandler);
    this.mcpStatus = new SessionEventMcpStatus(host);
    this.notices = new SessionEventNotices(host, {
      setCurrentTurnHasAssistantText: (value) => {
        this.currentTurnHasAssistantText = value;
      },
      setPendingModelBlockedFallback: (value) => {
        this.pendingModelBlockedFallback = value;
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

  get renderedSkillActivationIds(): Set<string> {
    return this.notices.renderedSkillActivationIds;
  }

  get renderedPluginCommandActivationIds(): Set<string> {
    return this.notices.renderedPluginCommandActivationIds;
  }

  get renderedMcpServerStatusKeys(): Map<string, string> {
    return this.mcpStatus.renderedMcpServerStatusKeys;
  }

  get mcpServerStatusSpinners(): Map<string, MoonLoader> {
    return this.mcpStatus.mcpServerStatusSpinners;
  }

  get ultraworkTheatres() {
    return this.ultrawork.ultraworkTheatres;
  }

  get mcpServers() {
    return this.mcpStatus.mcpServers;
  }
  /** Shared with goal-queue + turn (assistant.delta / turn.ended / hook.result). */
  private goalCompletionTurnEnded = false;
  private currentTurnHasAssistantText = false;
  private pendingModelBlockedFallback: GoalChange | undefined;

  resetRuntimeState(): void {
    this.backgroundTasksHandler.resetRuntimeState();
    this.ultrawork.resetRuntimeState();
    this.subAgentEventHandler.resetRuntimeState();
    this.notices.resetRuntimeState();
    this.mcpStatus.resetRuntimeState();
    this.goalCompletionTurnEnded = false;
    this.currentTurnHasAssistantText = false;
    this.pendingModelBlockedFallback = undefined;
    this.turn.resetRuntimeState();
    this.goalQueue.resetRuntimeState();
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
    return this.mcpStatus.syncSnapshot(session);
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
      this.ultrawork.handleEvent(event);
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
      case 'hook.result': this.notices.handleHookResult(event); break;
      case 'thinking.delta': this.turn.handleThinkingDelta(event); break;
      case 'tool.call.started': this.tools.handleToolCall(event); break;
      case 'tool.call.delta': this.tools.handleToolCallDelta(event); break;
      case 'tool.result': this.tools.handleToolResult(event); break;
      case 'agent.status.updated': this.notices.handleStatusUpdate(event); break;
      case 'session.meta.updated': this.notices.handleSessionMetaChanged(event); break;
      case 'goal.updated': this.goalQueue.handleUpdated(event); break;
      case 'skill.activated': this.notices.handleSkillActivated(event); break;
      case 'plugin_command.activated': this.notices.handlePluginCommandActivated(event); break;
      case 'error': this.notices.handleSessionError(event); break;
      case 'warning': this.notices.handleSessionWarning(event); break;
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
        this.backgroundTasksHandler.handleEvent(event); break;
      case 'cron.fired': this.notices.handleCronFired(event); break;
      case 'mcp.server.status': this.mcpStatus.renderServerStatus(event.server); break;
      case 'tool.list.updated': break;
      default: break;
    }
  }

  stopAllMcpServerStatusSpinners(): void {
    this.mcpStatus.stopAllSpinners();
  }

  requestQueuedGoalPromotion(): void {
    this.goalQueue.requestQueuedGoalPromotion();
  }

  retryQueuedGoalPromotion(): void {
    this.goalQueue.retryQueuedGoalPromotion();
  }
}
