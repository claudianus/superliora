import type {
  BackgroundTaskInfo,
  Event,
  Session,
} from '@superliora/sdk';
import type { QueuedMessage } from '../../types';

import type { ColorToken } from '#/tui/theme';
import type { ControlTowerJobDesk } from '../../features/control-tower/job-desk-events';
import type { BtwPanelController } from '../panes/btw-panel';
import type { StreamingUIController } from '../streaming-ui/index';
import type { TasksBrowserController } from '../panes/tasks-browser';
import type { WorkerDockController } from '../worker-dock/controller';
import { SessionEventBackgroundTasks } from './background-tasks';
import { SessionEventCompaction } from './compaction';
import { SessionEventNotices } from './notices';
import { SessionEventTools } from './tools';
import { SessionEventTurn } from './turn';
import { SubAgentEventHandler } from '../subagent-event/handler';
import type {
  AppState,
  LivePaneState,
  TranscriptEntry,
} from '../../types';
import type { TUIState } from '../../tui-state';

export interface SessionEventHost {
  state: TUIState;
  aborted: boolean;
  sessionEventUnsubscribe: (() => void) | undefined;
  readonly streamingUI: StreamingUIController;

  requireSession(): Session;
  setAppState(patch: Partial<AppState>): void;
  patchLivePane(patch: Partial<LivePaneState>): void;
  resetLivePane(): void;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  updateActivityPane(): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void;
  handleShellStarted(event: { commandId: string; taskId: string }): void;
  updateTerminalTitle(): void;
  sendQueuedMessage(session: Session, item: QueuedMessage): void;
  shiftQueuedMessage(): QueuedMessage | undefined;
  takeNextQueuedBatch?(): QueuedMessage | undefined;
  setLastTurnFailed(failed: boolean): void;
  readonly btwPanelController: BtwPanelController;
  readonly tasksBrowserController: TasksBrowserController;
  /** Operator Job desk — receives job snapshots and worker activity. */
  readonly controlTowerDesk: ControlTowerJobDesk;
  /** Mission Control — merged worker roster feeding the dock/fallback panel. */
  readonly workerDock: WorkerDockController;
}

export class SessionEventHandler {
  readonly subAgentEventHandler: SubAgentEventHandler;
  private readonly compaction: SessionEventCompaction;
  private readonly tools: SessionEventTools;
  private readonly turn: SessionEventTurn;
  private readonly backgroundTasksHandler: SessionEventBackgroundTasks;
  private readonly notices: SessionEventNotices;

  constructor(private readonly host: SessionEventHost) {
    this.compaction = new SessionEventCompaction(host);
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
    this.notices = new SessionEventNotices(host);
    this.tools = new SessionEventTools(host);
    this.turn = new SessionEventTurn(host);
  }

  // Runtime state – owned by this handler, reset between sessions.
  backgroundTasks: Map<string, BackgroundTaskInfo> = new Map();
  backgroundTaskTranscriptedTerminal: Set<string> = new Set();

  resetRuntimeState(): void {
    this.host.workerDock.reset();
    this.backgroundTasksHandler.resetRuntimeState();
    this.subAgentEventHandler.resetRuntimeState();
    this.turn.resetRuntimeState();
  }

  startSubscription(): void {
    const { host } = this;
    const session = host.requireSession();
    const sendQueued = (item: QueuedMessage): void => {
      host.sendQueuedMessage(session, item);
    };
    host.sessionEventUnsubscribe?.();
    const { sessionId } = host.state.appState;
    host.sessionEventUnsubscribe = session.onEvent((event) => {
      if (host.aborted) return;
      if (event.sessionId !== sessionId) return;
      this.handleEvent(event, sendQueued);
    });
  }

  handleEvent(event: Event, sendQueued: (item: QueuedMessage) => void): void {
    if (this.subAgentEventHandler.routeChildAgentEvent(event)) {
      // Child deltas / nested tools are consumed by the transcript Agent card,
      // but Mission Control still needs the same events for the NOW live strip.
      this.host.workerDock.handleEvent(event);
      return;
    }

    if ('turnId' in event && event.turnId !== undefined) {
      this.host.streamingUI.setTurnId(String(event.turnId));
    }

    switch (event.type) {
      case 'turn.started': this.turn.handleTurnBegin(event); break;
      case 'turn.ended': this.turn.handleTurnEnd(event, sendQueued); break;
      case 'turn.step.started': this.turn.handleStepBegin(event); break;
      case 'turn.step.interrupted': this.turn.handleStepInterrupted(event); break;
      case 'turn.step.completed': this.turn.handleStepCompleted(event); break;
      case 'tool.progress': this.tools.handleToolProgress(event); break;
      case 'shell.output': this.tools.handleShellOutput(event); break;
      case 'shell.started': this.tools.handleShellStarted(event); break;
      case 'assistant.delta': this.turn.handleAssistantDelta(event); break;
      case 'thinking.delta': this.turn.handleThinkingDelta(event); break;
      case 'tool.call.started': this.tools.handleToolCall(event); break;
      case 'tool.call.delta': this.tools.handleToolCallDelta(event); break;
      case 'tool.result': this.tools.handleToolResult(event); break;
      case 'agent.status.updated': this.notices.handleStatusUpdate(event); break;
      case 'session.meta.updated': this.notices.handleSessionMetaChanged(event); break;
      case 'job.updated': this.host.controlTowerDesk.handleUpdated(event); break;
      case 'job.inbox': this.host.controlTowerDesk.handleInbox(event); break;
      case 'error': this.notices.handleSessionError(event); break;
      case 'warning': this.notices.handleSessionWarning(event); break;
      case 'compaction.started': this.compaction.handleBegin(event); break;
      case 'compaction.completed': this.compaction.handleEnd(event, sendQueued); break;
      case 'compaction.cancelled': this.compaction.handleCancel(event, sendQueued); break;
      case 'compaction.progress': this.compaction.handleProgress(event); break;
      case 'subagent.spawned':
      case 'subagent.started':
      case 'subagent.completed':
      case 'subagent.failed':
        this.subAgentEventHandler.handleLifecycleEvent(event);
        break;
      case 'subagent.progress':
        this.host.controlTowerDesk.handleSubagentProgress(event); break;
      case 'subagent.tool_call':
        this.host.controlTowerDesk.handleSubagentToolCall(event); break;
      case 'subagent.tool_result':
        this.host.controlTowerDesk.handleSubagentToolResult(event); break;
      case 'subagent.tool_progress':
        this.host.controlTowerDesk.handleSubagentToolProgress(event); break;
      case 'background.task.started':
      case 'background.task.terminated':
        this.backgroundTasksHandler.handleEvent(event); break;
      default: break;
    }
    // Mission Control registry feeds off the same dispatch (no-op for events
    // it does not track). Job-lane refreshes flow through the app-state sync.
    this.host.workerDock.handleEvent(event);
  }

}
