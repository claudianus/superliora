import type {
  BackgroundTaskInfo,
  BackgroundTaskStartedEvent,
  BackgroundTaskTerminatedEvent,
} from '@superliora/sdk';

import { formatBackgroundTaskTranscript } from '../../utils/background-task-status';
import {
  notifyBackgroundTaskAttention,
} from '../../utils/attention-notifications';
import type { TranscriptEntry } from '../../types';
import type { TUIState } from '../../tui-state';
import { requestTUILayoutRender } from '../../utils/frame-render';
import { nextTranscriptId } from '../../utils/transcript-id';
import type { StreamingUIController } from '../streaming-ui';
import type { TasksBrowserController } from '../tasks-browser';

/** Host surface required by background task lifecycle handling. */
export interface BackgroundTaskEventHost {
  state: TUIState;
  readonly streamingUI: StreamingUIController;
  readonly tasksBrowserController: TasksBrowserController;
  appendTranscriptEntry(entry: TranscriptEntry): void;
}

export class SessionEventBackgroundTasks {
  constructor(
    private readonly host: BackgroundTaskEventHost,
    readonly backgroundTasks: Map<string, BackgroundTaskInfo>,
    readonly backgroundTaskTranscriptedTerminal: Set<string>,
  ) {}

  resetRuntimeState(): void {
    this.backgroundTasks.clear();
    this.backgroundTaskTranscriptedTerminal.clear();
  }

  handleEvent(
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
        this.syncBadge();
        this.host.tasksBrowserController.repaint();
        return;
      }
      this.appendEntry(info);
      this.syncBadge();
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
          this.appendEntry(info);
        }
        this.backgroundTaskTranscriptedTerminal.add(info.taskId);
      }
      this.syncBadge();
      this.host.tasksBrowserController.repaint();
      return;
    }

    if (previous?.status !== info.status) {
      this.syncBadge();
    }
    this.host.tasksBrowserController.repaint();
  }

  syncBadge(): void {
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

  private appendEntry(info: BackgroundTaskInfo): void {
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
}
