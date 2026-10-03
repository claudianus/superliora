import type { LioraHarness, PromptPart, Session } from '@superliora/sdk';

import {  LLM_NOT_SET_MESSAGE, MAIN_AGENT_ID } from '../../constant/liora-tui';
import { slashBusyMessage } from '../../commands/hub/resolve';
import type { ColorToken } from '../../theme';
import type { AppState, LioraTUIOptions, QueuedMessage, TranscriptEntry } from '../../types';
import type { TUIState } from '../../tui-state';
import { formatErrorMessage } from '../../utils/event-payload';
import {
  flushPromptInputState,
  type PromptInputRuntimeHost,
} from '../../utils/prompt-input-state';
import { requestTUIContentRender, requestTUILayoutRender } from '../../utils/render/frame-render';
import type { ImageAttachmentStore } from '../../utils/image/image-attachment-store';
import { extractMediaAttachments, type ExtractionResult } from '../../utils/image/image-placeholder';
import { nextTranscriptId } from '../../features/transcript/transcript-id';
import {
  combineQueuedPrefixLen,
  joinQueuedTexts,
  stampCombinedDisplayTexts,
  type CombineQueuedGate,
} from '../../features/transcript/combine-queued';
import { ttui } from '../../utils/tui-i18n';
import type { PromptStash } from '../../utils/prompt-stash';
import type { BtwPanelController } from '../panes/btw-panel';
import type { StreamingUIController } from '../streaming-ui/index';

interface SendMessageOptions {
  readonly displayText?: string;
  readonly parts?: readonly PromptPart[];
  readonly imageAttachmentIds?: readonly number[];
  readonly hasMedia?: boolean;
  readonly combinedDisplayTexts?: readonly string[];
}

/** Host surface required by user-input / send / queue / steer dispatch. */
export interface MessageDispatchHost extends PromptInputRuntimeHost {
  state: TUIState;
  session: Session | undefined;
  deferUserMessages: boolean;
  lastUserInput: string | undefined;
  readonly harness: LioraHarness;
  readonly options?: Pick<LioraTUIOptions, 'sessionRole'>;
  readonly streamingUI: StreamingUIController;
  readonly btwPanelController: BtwPanelController;
  readonly imageStore: ImageAttachmentStore;
  readonly promptStash: PromptStash;

  setAppState(patch: Partial<AppState>): void;
  handleInputModeChange(mode: 'prompt' | 'bash'): void;
  isSessionLoadingOverlayActive(): boolean;
  showError(msg: string): void;
  showStatus(msg: string, color?: ColorToken): void;
  persistInputHistory(text: string): Promise<void>;
  runShellCommandFromInput(command: string): void;
  updateQueueDisplay(): void;
  dispatchSlashInput(text: string): void;
  beginSessionRequest(): void;
  failSessionRequest(message: string): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  track(event: string, properties?: Parameters<LioraHarness['track']>[1]): void;
  updateEditorBorderHighlight?(text?: string): void;
}

/**
 * User-input / send / queue / steer orchestration.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class MessageDispatchController {
  private lastTurnFailed = false;

  private get prioritizesUserInput(): boolean {
    // A selected worker must retain foreground semantics even in the conductor UI.
    return this.host.options?.sessionRole === 'interactive-conductor' &&
      this.host.harness.interactiveAgentId === MAIN_AGENT_ID;
  }

  constructor(private readonly host: MessageDispatchHost) {}

  recallLastQueued(): QueuedMessage | undefined {
    if (this.host.state.queuedMessages.length === 0) return undefined;
    const last = this.host.state.queuedMessages.at(-1)!;
    this.host.state.queuedMessages = this.host.state.queuedMessages.slice(0, -1);
    flushPromptInputState(this.host);
    return last;
  }

  clearQueuedMessages(): void {
    this.host.state.queuedMessages = [];
    flushPromptInputState(this.host);
  }

  shiftQueuedMessage(): QueuedMessage | undefined {
    if (this.host.state.queuedMessages.length === 0) return undefined;
    const [first, ...rest] = this.host.state.queuedMessages;
    this.host.state.queuedMessages = rest;
    flushPromptInputState(this.host);
    return first;
  }

  takeNextQueuedBatch(): QueuedMessage | undefined {
    const queue = this.host.state.queuedMessages;
    if (queue.length === 0) return undefined;
    const take = combineQueuedPrefixLen(queue.map(queuedMessageToCombineGate));
    if (take <= 1) return this.shiftQueuedMessage();
    const taken = queue.slice(0, take);
    this.host.state.queuedMessages = queue.slice(take);
    flushPromptInputState(this.host);
    return joinQueuedMessages(taken);
  }

  setLastTurnFailed(failed: boolean): void {
    this.lastTurnFailed = failed;
  }

  private restoreRejectedDraft(text: string): void {
    this.host.state.editor.setText(text);
    this.host.updateEditorBorderHighlight?.(text);
  }

  async retryLastTurn(): Promise<void> {
    const { host } = this;
    const session = host.session;
    if (session === undefined || host.lastUserInput === undefined) {
      host.showError(ttui('tui.retry.none'));
      return;
    }
    if (host.state.appState.streamingPhase !== 'idle') {
      // Same guidance the slash dispatcher gives for idle-only commands; a
      // silent no-op reads as a broken button from the Hub.
      host.showError(slashBusyMessage('retry', 'streaming'));
      return;
    }
    this.lastTurnFailed = false;
    host.showStatus(ttui('tui.retry.resending'), 'primary');
    this.sendMessageInternal(session, host.lastUserInput);
  }

  handleUserInput(text: string): void {
    const { host } = this;
    const wasBashMode = host.state.appState.inputMode === 'bash';
    if (wasBashMode) {
      // A submit always exits bash mode (the `!` is consumed by this command).
      host.state.editor.inputMode = 'prompt';
      host.handleInputModeChange('prompt');
    }
    if (text.trim().length === 0) return;
    if (host.isSessionLoadingOverlayActive()) {
      // V3-3: input preservation. The editor already consumed the draft before
      // this handler runs (its submit is IME double-deferred, so it can land
      // after the loading overlay mounts). Instead of rejecting and dropping
      // the text, hand it back to the editor: the debounced draft persist
      // picks it up, and Enter re-submits as soon as loading finishes.
      if (wasBashMode) {
        host.state.editor.inputMode = 'bash';
        host.handleInputModeChange('bash');
      }
      host.state.editor.setText(text);
      host.updateEditorBorderHighlight?.(text);
      host.showStatus(ttui('tui.sessionLoading.inputHeld'), 'info');
      return;
    }
    if (host.state.appState.isReplaying) {
      // Replay viewing has no live session to submit to. Keep the busy error,
      // but hand the draft back — the editor already cleared on submit.
      if (wasBashMode) {
        host.state.editor.inputMode = 'bash';
        host.handleInputModeChange('bash');
      }
      this.restoreRejectedDraft(text);
      host.showError(ttui('tui.sessionLoading.busy'));
      return;
    }
    // Shell commands are stored with a leading `!` so ↑ recall can tell them
    // apart from prompts and restore bash mode. The `!` is stripped again when
    // the entry is recalled.
    const historyText = wasBashMode ? `!${text}` : text;
    void host.persistInputHistory(historyText);
    if (wasBashMode) {
      // Only one foreground action at a time: queue the shell command while
      // another shell command is running or an agent turn is in progress.
      if (host.state.appState.streamingPhase !== 'idle') {
        this.enqueueMessage(text, undefined, 'bash');
        host.updateQueueDisplay();
        requestTUILayoutRender(host.state);
        return;
      }
      host.runShellCommandFromInput(text);
      return;
    }
    host.dispatchSlashInput(text);
  }

  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void {
    const { host } = this;
    if (host.btwPanelController.sendUserInput(text)) return;
    if (host.state.appState.model.trim().length === 0) {
      this.restoreRejectedDraft(text);
      host.showError(LLM_NOT_SET_MESSAGE());
      return;
    }
    let extraction: ExtractionResult;
    try {
      extraction = extractMediaAttachments(text, host.imageStore);
    } catch (error) {
      this.restoreRejectedDraft(text);
      host.showError(formatErrorMessage(error));
      return;
    }
    const session = host.session;
    if (session === undefined) {
      this.restoreRejectedDraft(text);
      host.showError(LLM_NOT_SET_MESSAGE());
      return;
    }

    if (extraction.hasMedia) {
      this.sendMessage(session, text, {
        displayText: options?.displayText,
        hasMedia: true,
        parts: extraction.parts,
        imageAttachmentIds: extraction.imageAttachmentIds,
      });
    } else {
      this.sendMessage(session, text, { displayText: options?.displayText });
    }
    host.updateQueueDisplay();
    requestTUIContentRender(host.state);
  }


  sendQueuedMessage(session: Session, item: QueuedMessage): void {
    const { host } = this;
    if (item.mode === 'bash') {
      host.runShellCommandFromInput(item.text);
      return;
    }
    host.harness.withInteractiveAgent(item.agentId ?? MAIN_AGENT_ID, () => {
      this.sendMessageInternal(session, item.text, {
        displayText: item.displayText,
        parts: item.parts,
        imageAttachmentIds: item.imageAttachmentIds,
        combinedDisplayTexts: item.combinedDisplayTexts,
      });
    });
  }


  steerMessage(session: Session, input: string[], options?: SendMessageOptions): void {
    const { host } = this;
    if (host.deferUserMessages || host.state.appState.isCompacting) {
      for (const part of input) {
        this.enqueueMessage(part, input.length === 1 ? options : undefined);
      }
      return;
    }
    if (host.state.appState.streamingPhase === 'idle') {
      for (const part of input) {
        this.sendMessageInternal(session, part, input.length === 1 ? options : undefined);
      }
      return;
    }

    if (this.prioritizesUserInput && host.state.appState.streamingPhase !== 'shell') {
      // The session input policy owns inference preemption. Do not cancel the
      // session here: accepted independent workers must keep running.
      this.sendMessageInternal(session, input.join('\n\n'), {
        ...options,
        combinedDisplayTexts: options?.combinedDisplayTexts ?? (input.length > 1 ? input : undefined),
      });
      return;
    }

    for (const part of input) {
      host.appendTranscriptEntry({
        id: nextTranscriptId(),
        kind: 'user',
        turnId: host.streamingUI.getTurnContext().turnId,
        renderMode: 'plain',
        content: options?.displayText ?? part,
        imageAttachmentIds: options?.imageAttachmentIds,
        timestamp: Date.now(),
      });
    }

    void session.steer(options?.parts ?? input.join('\n\n')).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      host.showError(ttui('tui.transcript.steerFailed', { message }));
      // The queue-drain removed these parts before steer() ran; restore them
      // so a failed steer (network drop, engine error) doesn't eat the text.
      for (const part of input) {
        this.enqueueMessage(part, input.length === 1 ? options : undefined);
      }
      host.updateQueueDisplay();
    });
  }

  sendMessageInternal(session: Session, input: string, options?: SendMessageOptions): void {
    const { host } = this;
    const imageAttachmentIds =
      options?.imageAttachmentIds !== undefined && options.imageAttachmentIds.length > 0
        ? options.imageAttachmentIds
        : undefined;
    const displayInput = options?.displayText ?? input;
    host.appendTranscriptEntry({
      id: nextTranscriptId(),
      kind: 'user',
      turnId: undefined,
      renderMode: 'plain',
      content: displayInput,
      imageAttachmentIds,
      timestamp: Date.now(),
      combinedDisplayTexts: options?.combinedDisplayTexts,
    });

    // Track the last user input for `/retry` / Hub → Chat → Retry.
    if (options?.displayText === undefined) {
      host.lastUserInput = input;
      flushPromptInputState(host);
    }

    host.beginSessionRequest();

    const sdkInput = options?.parts ?? input;
    void session.prompt(sdkInput).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      host.failSessionRequest(`Failed to send: ${message}`);
      this.enqueueMessage(input, options);
      host.updateQueueDisplay();
    });
  }

  private enqueueMessage(
    text: string,
    options?: SendMessageOptions,
    mode?: 'prompt' | 'bash',
  ): void {
    const { host } = this;
    host.state.queuedMessages.push({
      text,
      displayText: options?.displayText,
      combinedDisplayTexts: options?.combinedDisplayTexts,
      agentId: host.harness.interactiveAgentId,
      parts: options?.parts,
      imageAttachmentIds:
        options?.imageAttachmentIds !== undefined && options.imageAttachmentIds.length > 0
          ? options.imageAttachmentIds
          : undefined,
      mode,
    });
    host.track('input_queue');
    flushPromptInputState(host);
  }

  private sendMessage(session: Session, input: string, options?: SendMessageOptions): void {
    const { host } = this;
    if (
      host.deferUserMessages ||
      (host.state.appState.streamingPhase !== 'idle' &&
        (!this.prioritizesUserInput || host.state.appState.streamingPhase === 'shell')) ||
      host.state.appState.isCompacting
    ) {
      this.enqueueMessage(input, options);
      return;
    }
    this.sendMessageInternal(session, input, options);
  }

}

function queuedMessageToCombineGate(message: QueuedMessage): CombineQueuedGate {
  const text = (message.displayText ?? message.text).trim();
  const expanded =
    message.displayText !== undefined && message.displayText.trim() !== message.text.trim();
  return {
    agentId: message.agentId,
    isPlainPrompt: message.mode !== 'bash' && !expanded,
    isBash: message.mode === 'bash',
    hasImages: (message.imageAttachmentIds?.length ?? 0) > 0 || message.parts !== undefined,
    isExpandedPrompt: expanded,
    text,
  };
}

function joinQueuedMessages(messages: readonly QueuedMessage[]): QueuedMessage {
  const first = messages[0]!;
  const segs = messages.flatMap((message) => message.combinedDisplayTexts ?? [message.displayText ?? message.text]);
  return {
    ...first,
    text: joinQueuedTexts(messages.map((message) => message.text)),
    displayText: joinQueuedTexts(segs),
    parts: messages.some((message) => message.parts !== undefined)
      ? messages.flatMap((message, index): PromptPart[] => [
          ...(index === 0 ? [] : [{ type: 'text' as const, text: '\n\n' }]),
          ...(message.parts ?? [{ type: 'text' as const, text: message.text }]),
        ])
      : undefined,
    combinedDisplayTexts: stampCombinedDisplayTexts(segs),
  };
}
