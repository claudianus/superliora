import type { LioraHarness, PromptPart, Session } from '@superliora/sdk';

import {  LLM_NOT_SET_MESSAGE, MAIN_AGENT_ID } from '../../constant/liora-tui';
import { isConductorUxV2Enabled } from '../../commands/job-hotpath';
import type { ColorToken } from '../../theme';
import type { AppState, QueuedMessage, TranscriptEntry } from '../../types';
import type { TUIState } from '../../tui-state';
import { formatErrorMessage } from '../../utils/event-payload';
import {
  flushPromptInputState,
  type PromptInputRuntimeHost,
} from '../../utils/prompt-input-state';
import { requestTUIContentRender, requestTUILayoutRender } from '../../utils/render/frame-render';
import type { ImageAttachmentStore } from '../../utils/image/image-attachment-store';
import { extractMediaAttachments } from '../../utils/image/image-placeholder';
import { nextTranscriptId } from '../../features/transcript/transcript-id';
import {
  askUserQuestionTemplateForIncompleteBrief,
  attachStructuredBrief,
  intentBriefIncompleteForGreenfield,
} from '../../utils/job/intent-brief';
import { ttui } from '../../utils/tui-i18n';
import type { PromptStash } from '../../utils/prompt-stash';
import type { BtwPanelController } from '../panes/btw-panel';
import type { StreamingUIController } from '../streaming-ui/index';

interface SendMessageOptions {
  readonly displayText?: string;
  readonly parts?: readonly PromptPart[];
  readonly imageAttachmentIds?: readonly number[];
  readonly hasMedia?: boolean;
}

/** Host surface required by user-input / send / queue / steer dispatch. */
export interface MessageDispatchHost extends PromptInputRuntimeHost {
  state: TUIState;
  session: Session | undefined;
  deferUserMessages: boolean;
  lastUserInput: string | undefined;
  readonly harness: LioraHarness;
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
  readonly appStateController: { supportsCurrentModelCapability(capability: string): boolean };
  beginSessionRequest(): void;
  failSessionRequest(message: string): void;
  appendTranscriptEntry(entry: TranscriptEntry): void;
  track(event: string, properties?: Parameters<LioraHarness['track']>[1]): void;
  /** V3-1 latency window start; the job desk closes it on the first job event. */
  readonly controlTowerDesk: { markInputSubmitted(): void };
}

/**
 * User-input / send / queue / steer orchestration.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class MessageDispatchController {
  private lastTurnFailed = false;

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

  setLastTurnFailed(failed: boolean): void {
    this.lastTurnFailed = failed;
  }

  async retryLastTurn(): Promise<void> {
    const { host } = this;
    const session = host.session;
    if (session === undefined || host.lastUserInput === undefined) {
      host.showError(ttui('tui.retry.none'));
      return;
    }
    if (host.state.appState.streamingPhase !== 'idle') return;
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
      // Replay viewing has no live session to submit to.
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
      host.showError(LLM_NOT_SET_MESSAGE());
      return;
    }
    const extraction = extractMediaAttachments(text, host.imageStore);
    if (!this.validateMediaCapabilities(extraction)) return;
    const session = host.session;
    if (session === undefined) {
      host.showError(LLM_NOT_SET_MESSAGE());
      return;
    }

    // Conductor UX v2: Intent Composer brief → hotfix jobCreate or structured prefix.
    const briefSend = this.maybeSendWithIntentBrief(session, text, options?.displayText);
    if (briefSend) {
      host.updateQueueDisplay();
      requestTUIContentRender(host.state);
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

  /**
   * When Intent Composer has fields and conductor_ux_v2 is on:
   * - hotfix → session.jobCreate with structured brief (skip Conductor prompt)
   * - otherwise → attach structured brief prefix to the prompt
   * Returns true when the send was fully handled here.
   */
  private maybeSendWithIntentBrief(
    session: Session,
    text: string,
    displayText: string | undefined,
  ): boolean {
    if (!isConductorUxV2Enabled()) return false;
    const composer = this.host.state.intentComposer;
    if (composer === undefined || !composer.hasFields()) return false;
    const fields = composer.getFields();
    const mode = this.host.state.appState.conductorProjectMode ?? 'balanced';
    const shown = displayText ?? text;

    if (mode === 'greenfield' && intentBriefIncompleteForGreenfield(fields)) {
      const template = askUserQuestionTemplateForIncompleteBrief(fields);
      const prompt = [
        template,
        '',
        'User idea:',
        text,
        '',
        'Use AskUserQuestion to collect the missing brief fields, then JobCreate with delivery_mode=greenfield (and greenfield_chain when appropriate). Do not spawn a guesser.',
      ].join('\n');
      this.sendMessage(session, prompt, { displayText: shown });
      return true;
    }

    if (mode === 'hotfix') {
      const title = text.trim().split('\n')[0]?.slice(0, 120) || 'Hotfix';
      void session
        .jobCreate({
          title,
          kind: 'implement',
          prompt: text,
          successCriteria: fields.successCriteria,
          mustNotTouch: fields.mustNotTouch,
          verificationCommands: fields.verificationCommands,
          contextPaths: fields.contextPaths,
        })
        .then((result) => {
          this.host.showStatus(
            result.jobs.length > 0
              ? `Hotfix job created (${String(result.jobs.length)})`
              : result.text,
            'info',
          );
          this.host.controlTowerDesk.markInputSubmitted();
        })
        .catch((error: unknown) => {
          this.host.showError(formatErrorMessage(error));
        });
      // Echo the user line without prompting the main agent.
      this.host.appendTranscriptEntry({
        id: nextTranscriptId(),
        kind: 'user',
        turnId: undefined,
        renderMode: 'plain',
        content: shown,
        timestamp: Date.now(),
      });
      composer.clearFields();
      return true;
    }

    const withBrief = attachStructuredBrief(text, fields);
    this.sendMessage(session, withBrief, { displayText: shown });
    composer.clearFields();
    return true;
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
      });
    });
  }

  sendSkillActivation(session: Session, skillName: string, skillArgs: string): void {
    const { host } = this;
    host.beginSessionRequest();
    void session.activateSkill(skillName, skillArgs).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      host.failSessionRequest(`Skill "${skillName}" failed: ${message}`);
    });
  }

  steerMessage(session: Session, input: string[]): void {
    const { host } = this;
    if (host.deferUserMessages || host.state.appState.isCompacting) {
      for (const part of input) {
        this.enqueueMessage(part);
      }
      return;
    }
    if (host.state.appState.streamingPhase === 'idle') {
      for (const part of input) {
        this.sendMessageInternal(session, part);
      }
      return;
    }

    for (const part of input) {
      host.appendTranscriptEntry({
        id: nextTranscriptId(),
        kind: 'user',
        turnId: host.streamingUI.getTurnContext().turnId,
        renderMode: 'plain',
        content: part,
        timestamp: Date.now(),
      });
    }

    void session.steer(input.join('\n\n')).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      host.showError(ttui('tui.transcript.steerFailed', { message }));
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
    });

    // Track the last user input for `/retry` / Hub → Chat → Retry.
    if (options?.displayText === undefined) {
      host.lastUserInput = input;
      flushPromptInputState(host);
    }

    host.beginSessionRequest();
    // V3-1 latency window start: t0 for input → first JobCreate ACK. The job
    // desk closes the window when a job event arrives; non-Conductor sessions
    // simply never produce an ACK sample.
    host.controlTowerDesk.markInputSubmitted();

    const sdkInput = options?.parts ?? input;
    void session.prompt(sdkInput).catch((error: unknown) => {
      const message = formatErrorMessage(error);
      host.failSessionRequest(`Failed to send: ${message}`);
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
      host.state.appState.streamingPhase !== 'idle' ||
      host.state.appState.isCompacting
    ) {
      this.enqueueMessage(input, options);
      return;
    }
    this.sendMessageInternal(session, input, options);
  }

  private validateMediaCapabilities(
    extraction: ReturnType<typeof extractMediaAttachments>,
  ): boolean {
    const { host } = this;
    if (!extraction.hasMedia) return true;
    const imageUnsupported =
      extraction.imageAttachmentIds.length > 0 &&
      !host.appStateController.supportsCurrentModelCapability('image_in');
    const videoUnsupported =
      extraction.videoAttachmentIds.length > 0 &&
      !host.appStateController.supportsCurrentModelCapability('video_in');
    if (!imageUnsupported && !videoUnsupported) return true;

    // 'block' keeps the legacy hard error. 'analyze'/'path' send anyway: the
    // core transforms media (analyzer text or path note) before the model
    // sees it, so the prompt is never lost.
    if ((host.state.appState.nonVisionFallbackPolicy ?? 'analyze') === 'block') {
      host.showError(
        imageUnsupported
          ? 'Current model does not support image input.'
          : 'Current model does not support video input.',
      );
      return false;
    }
    if ((host.state.appState.nonVisionFallbackPolicy ?? 'analyze') === 'analyze') {
      const analyzer = this.findVisionAnalyzerModel(videoUnsupported && !imageUnsupported);
      if (analyzer !== undefined) {
        host.showStatus(
          ttui('tui.media.textOnlyAnalyze', { analyzer }),
          'success',
        );
      }
    }
    return true;
  }

  /**
   * Catalog heuristic for the pre-send toast: a vision-capable model whose
   * provider entry exists, preferring the current model's provider. The core
   * makes the authoritative (credential-aware) selection at send time.
   */
  private findVisionAnalyzerModel(video: boolean): string | undefined {
    const models = this.host.state.appState.availableModels;
    const wanted = video ? 'video_in' : 'image_in';
    const currentProvider = models[this.host.state.appState.model]?.provider;
    let first: string | undefined;
    for (const alias of Object.keys(models).toSorted()) {
      const entry = models[alias];
      if (entry?.capabilities?.includes(wanted) !== true) continue;
      if (currentProvider !== undefined && entry.provider === currentProvider) return alias;
      first ??= alias;
    }
    return first;
  }
}
