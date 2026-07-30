import type { Session } from '@superliora/sdk';

import {
  appendGlobalInputHistory,
  appendInputHistory,
  loadGlobalInputHistory,
  loadInputHistory,
} from '#/utils/history/input-history';
import { getGlobalInputHistoryFile, getInputHistoryFile } from '#/utils/paths';

import { ShellRunComponent } from '../components/messages/shell-run';
import { currentTheme } from '../theme';
import type { AppState, QueuedMessage, TranscriptEntry } from '../types';
import type { TUIState } from '../tui-state';
import { formatErrorMessage } from '../utils/event-payload';
import { requestTUIContentRender } from '../utils/render/frame-render';
import { formatBashOutputForDisplay } from '../utils/shell-output';
import { markTranscriptComponent } from '../features/transcript/transcript-component-metadata';
import { nextTranscriptId } from '../features/transcript/transcript-id';

/** Host surface required by shell command and input-history orchestration. */
export interface ShellInputHost {
  state: TUIState;
  session: Session | undefined;
  lastHistoryContent: string | undefined;
  readonly shellOutputStreams: Map<
    string,
    { entry: TranscriptEntry; component: ShellRunComponent; taskId?: string }
  >;

  setAppState(patch: Partial<AppState>): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  showError(msg: string): void;
  shiftQueuedMessage(): QueuedMessage | undefined;
  sendQueuedMessage(session: Session, item: QueuedMessage): void;
  updateQueueDisplay(): void;
}

/**
 * Foreground shell command execution and persisted input history.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class ShellInputController {
  constructor(private readonly host: ShellInputHost) {}

  runShellCommandFromInput(command: string): void {
    const { host } = this;
    const session = host.session;
    if (session === undefined) {
      host.showError('No active session for shell command.');
      return;
    }
    host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'user',
      turnId: undefined,
      renderMode: 'plain',
      content: currentTheme.fg('shellMode', `$ ${command}`),
      bullet: '',
      timestamp: Date.now(),
    });
    const commandId = nextTranscriptId();
    const outputEntry: TranscriptEntry = {
      id: commandId,
      kind: 'status',
      turnId: undefined,
      renderMode: 'plain',
      content: '',
    };
    const outputComponent = new ShellRunComponent(() => {
      requestTUIContentRender(host.state);
    });
    host.shellOutputStreams.set(commandId, { entry: outputEntry, component: outputComponent });
    host.state.transcriptEntries.push(outputEntry);
    markTranscriptComponent(outputComponent, outputEntry);
    host.state.transcriptContainer.addChild(outputComponent);
    host.setAppState({ streamingPhase: 'shell' });
    requestTUIContentRender(host.state);

    void session.runShellCommand(command, { commandId }).then(
      ({ stdout, stderr, isError, backgrounded }) => {
        this.finishShellOutput(commandId, stdout, stderr, isError, backgrounded);
      },
      (error: unknown) => {
        const message = formatErrorMessage(error);
        this.finishShellOutput(commandId, '', message, true);
        host.showError(`Shell command failed: ${message}`);
      },
    );
  }

  handleShellOutput(event: { commandId: string; update: { kind: string; text?: string } }): void {
    const stream = this.host.shellOutputStreams.get(event.commandId);
    if (stream === undefined) return;
    const text = event.update.text ?? '';
    if (text.length === 0) return;
    stream.component.append(text);
  }

  handleShellStarted(event: { commandId: string; taskId: string }): void {
    const stream = this.host.shellOutputStreams.get(event.commandId);
    if (stream === undefined) return;
    stream.taskId = event.taskId;
  }

  cancelRunningShellCommand(): void {
    const { host } = this;
    const session = host.session;
    if (session === undefined) return;
    for (const commandId of host.shellOutputStreams.keys()) {
      void session.cancelShellCommand(commandId).catch((error: unknown) => {
        host.showError(`Failed to cancel shell command: ${formatErrorMessage(error)}`);
      });
    }
  }

  drainOneQueuedMessage(): void {
    const { host } = this;
    const item = host.shiftQueuedMessage();
    if (item === undefined) return;
    const session = host.session;
    if (session === undefined) return;
    if (item.mode === 'bash') {
      this.runShellCommandFromInput(item.text);
    } else {
      host.sendQueuedMessage(session, item);
    }
    host.updateQueueDisplay();
  }

  async loadPersistedInputHistory(): Promise<void> {
    const { host } = this;
    try {
      const file = getInputHistoryFile(host.state.appState.workDir);
      const entries = await loadInputHistory(file);
      const workdirContents = new Set(entries.map((entry) => entry.content));

      try {
        const globalEntries = await loadGlobalInputHistory(getGlobalInputHistoryFile());
        for (const entry of globalEntries) {
          if (!workdirContents.has(entry.content)) {
            host.state.editor.addToHistory(entry.content);
          }
        }
      } catch {
        // Global history is best-effort.
      }

      for (const entry of entries) {
        host.state.editor.addToHistory(entry.content);
      }
      host.lastHistoryContent = entries.at(-1)?.content;
    } catch (error) {
      console.warn('Failed to load input history:', error);
    }
  }

  async persistInputHistory(text: string): Promise<void> {
    const { host } = this;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (trimmed === host.lastHistoryContent) return;
    host.state.editor.addToHistory(trimmed);
    try {
      const file = getInputHistoryFile(host.state.appState.workDir);
      const written = await appendInputHistory(file, trimmed, host.lastHistoryContent);
      if (written) host.lastHistoryContent = trimmed;
    } catch (error) {
      console.warn('Failed to persist input history:', error);
      host.lastHistoryContent = trimmed;
    }
    try {
      await appendGlobalInputHistory(getGlobalInputHistoryFile(), trimmed);
    } catch {
      // Global history is best-effort.
    }
  }

  private finishShellOutput(
    commandId: string,
    stdout: string,
    stderr: string,
    isError?: boolean,
    backgrounded?: boolean,
  ): void {
    const { host } = this;
    const stream = host.shellOutputStreams.get(commandId);
    if (stream === undefined) return;
    if (backgrounded === true) {
      return;
    }
    stream.component.finish(stdout, stderr, isError);
    stream.entry.content = formatBashOutputForDisplay(stdout, stderr, isError);
    host.shellOutputStreams.delete(commandId);
    if (host.shellOutputStreams.size === 0) {
      host.setAppState({ streamingPhase: 'idle' });
      this.drainOneQueuedMessage();
    }
  }
}
