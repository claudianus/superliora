import type { Session } from '@superliora/sdk';

import {
  ClipboardMediaError,
  readClipboardMediaAll,
  readMediaPath,
  type ClipboardMedia,
} from '#/utils/clipboard/clipboard-image';
import { preparePastedImage } from '#/utils/image/prepare-pasted-image';
import { editInExternalEditor, resolveEditorCommand } from '#/utils/process/external-editor';

import {
   CTRL_C_HINT,
   CTRL_D_HINT,
  DOUBLE_ESC_WINDOW_MS,
  EXIT_CONFIRM_WINDOW_MS,
  LARGE_PASTE_CONFIRM_WINDOW_MS,
  LARGE_PASTE_WARN_CHARS,
   LLM_NOT_SET_MESSAGE,
   NO_ACTIVE_SESSION_MESSAGE,
} from '../../constant/liora-tui';
import { primaryChord } from '../../utils/os-shortcuts';
import { formatErrorMessage } from '../../utils/event-payload';
import {
  flushPromptInputState,
  schedulePromptInputDraftPersist,
  type PromptInputRuntimeHost,
} from '../../utils/prompt-input-state';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { ttui } from '../../utils/tui-i18n';
import type { ImageAttachmentStore } from '../../utils/image/image-attachment-store';
import { parseDroppedFilePaths } from '../../utils/media/media-drop';
import { formatBytes } from '../../components/messages/tool-renderers/chip-format';
import { copyTranscriptSelectionToClipboard } from '../../features/transcript/transcript-selection';
import type { ColorToken } from '../../theme';
import type { PendingExit, QueuedMessage } from '../../types';
import type { TranscriptScrollAction } from '../../features/transcript/transcript-viewport';
import type { TUIState } from '../../tui-state';
import type { PromptStash } from '../../utils/prompt-stash';
import { focusIntentComposer } from '../../features/control-tower/conductor-ux';
import type { BtwPanelController } from '../panes/btw-panel';

export interface EditorKeyboardHost extends PromptInputRuntimeHost {
  state: TUIState;
  session: Session | undefined;
  cancelInFlight: (() => void) | undefined;
  lastUserInput: string | undefined;
  readonly promptStash: PromptStash;

  handleUserInput(text: string): void;
  readonly btwPanelController: BtwPanelController;
  steerMessage(session: Session, input: string[]): void;
  readonly messageDispatch: { recallLastQueued(): QueuedMessage | undefined };
  showError(msg: string): void;
  track(event: string, props?: Record<string, unknown>): void;
  updateEditorBorderHighlight(text?: string): void;
  updateQueueDisplay(): void;
  toggleToolOutputExpansion(): void;
  toggleTodoPanelExpansion(): void;
  detachCurrentForegroundTask(): void;
  cancelRunningShellCommand(): void;
  hideSessionPicker(): void;
  hideExtensionsModal(): void;
  openUndoSelector(): void;
  stop(exitCode?: number): Promise<void>;
  handleInputModeChange(mode: 'prompt' | 'bash'): void;
  clearQueuedMessages(): void;
  showHistorySearch(initialQuery?: string): void;
  showCommandHub(): void;
  showTranscriptSearch(): void;
  stashPromptToggle(): void;
  setExternalEditorRunning(running: boolean): void;
  scrollTranscriptViewport(action: TranscriptScrollAction): boolean;
  showStatus(msg: string, color?: ColorToken): void;
  setAskMode(enabled: boolean): void;
  readonly jobBoardController: { openDeck(jobId?: string): void };
  openJobInbox?(): void;
}

/**
 * Shift-Tab cycles the convenience modes. Build (the default, no mode) and Ask
 * (investigate only) are the two stops.
 */
export function nextShiftTabMode(askMode: boolean): 'build' | 'ask' {
  return askMode ? 'build' : 'ask';
}

function pasteKind(
  imageCount: number,
  videoCount: number,
  fileCount: number,
  audioCount: number,
): string {
  const kinds = [
    imageCount > 0,
    videoCount > 0,
    fileCount > 0,
    audioCount > 0,
  ].filter(Boolean).length;
  if (kinds > 1) return 'mixed';
  if (videoCount > 0) return 'video';
  if (fileCount > 0) return 'file';
  if (audioCount > 0) return 'audio';
  return 'image';
}

export class EditorKeyboardController {
  private pendingExit: PendingExit | null = null;
  private pendingUndoEsc: { readonly timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly host: EditorKeyboardHost,
    private readonly imageStore: ImageAttachmentStore,
  ) {}

  install(): void {
    const { host } = this;
    const editor = host.state.editor;

    editor.onSubmit = (text: string) => {
      host.handleUserInput(text);
    };

    editor.onChange = (text: string) => {
      if (this.pendingExit) this.clearPendingExit();
      host.updateEditorBorderHighlight(text);
      // Debounce draft persistence so a hard kill mid-type still restores text.
      schedulePromptInputDraftPersist(host);
    };

    editor.onNonEscapeInput = () => {
      this.clearPendingUndoEsc();
    };

    editor.onShiftTab = () => {
      const next = nextShiftTabMode(host.state.appState.askMode);
      host.track('shift_tab_mode', { target: next });
      host.setAskMode(next === 'ask');
    };

    editor.onCtrlC = () => {
      if (host.state.transcriptSelection.hasSelection) {
        void copyTranscriptSelectionToClipboard(host.state).then((copied) => {
          if (copied) host.state.toast.show('Copied to clipboard');
        });
        return;
      }

      if (host.cancelInFlight !== undefined) {
        const cancel = host.cancelInFlight;
        host.cancelInFlight = undefined;
        this.clearPendingExit();
        cancel();
        return;
      }

      if (host.state.appState.isCompacting) {
        this.clearPendingExit();

        if (this.clearEditorTextIfPresent()) return;

        this.cancelCurrentCompaction();
        return;
      }

      if (host.btwPanelController.cancelRunning()) {
        this.clearPendingExit();
        return;
      }
      if (host.btwPanelController.closeOrCancel()) {
        this.clearPendingExit();
        return;
      }

      if (host.state.appState.streamingPhase !== 'idle') {
        this.clearPendingExit();

        if (this.clearEditorTextIfPresent()) return;

        this.cancelCurrentStream('ctrl-c');
        return;
      }

      if (this.pendingExit?.kind === 'ctrl-c') {
        this.clearPendingExit();
        void host.stop();
        return;
      }

      if (editor.getText().length > 0) {
        editor.setText('');
      }
      this.armPendingExit('ctrl-c', CTRL_C_HINT());
    };

    editor.onCtrlD = () => {
      if (this.pendingExit?.kind === 'ctrl-d') {
        this.clearPendingExit();
        void host.stop();
        return;
      }
      this.armPendingExit('ctrl-d', CTRL_D_HINT());
    };

    editor.onEscape = () => {
      if (this.pendingExit) this.clearPendingExit();
      // Esc cancels an in-flight login/catalog load (mirrors Ctrl-C), so the
      // user is not forced to remember "only Ctrl-C works" during OAuth flows.
      if (host.cancelInFlight !== undefined) {
        const cancel = host.cancelInFlight;
        host.cancelInFlight = undefined;
        this.clearPendingExit();
        cancel();
        return;
      }
      if (host.state.activeDialog === 'session-picker') {
        host.hideSessionPicker();
        this.clearPendingUndoEsc();
        return;
      }
      if (host.state.activeDialog === 'extensions') {
        host.hideExtensionsModal();
        this.clearPendingUndoEsc();
        return;
      }
      if (host.state.appState.isCompacting) {
        this.cancelCurrentCompaction();
        this.clearPendingUndoEsc();
        return;
      }
      if (host.btwPanelController.closeOrCancel()) {
        this.clearPendingUndoEsc();
        return;
      }
      if (host.state.appState.streamingPhase !== 'idle') {
        this.cancelCurrentStream('esc');
        this.clearPendingUndoEsc();
        return;
      }
      if (this.pendingUndoEsc !== null) {
        this.clearPendingUndoEsc();
        host.openUndoSelector();
        return;
      }
      this.armPendingUndoEsc();
    };

    editor.onInputModeChange = (mode) => {
      host.handleInputModeChange(mode);
    };

    editor.onOpenExternalEditor = () => {
      host.track('shortcut_editor');
      void this.openExternalEditor();
    };

    // Ctrl-O cycles 4-level transcript density; Ctrl-T expands the todo panel.
    editor.onToggleToolExpand = () => {
      host.track('shortcut_expand');
      host.toggleToolOutputExpansion();
    };
    editor.onToggleTodoExpand = (): boolean => {
      if (!host.state.todoPanel.hasOverflow()) return false;
      this.clearPendingExit();
      host.track('shortcut_todo_expand');
      host.toggleTodoPanelExpansion();
      return true;
    };

    editor.onCtrlS = () => {
      if (
        host.state.appState.streamingPhase === 'idle' ||
        host.state.appState.streamingPhase === 'shell' ||
        host.state.appState.isCompacting
      ) {
        host.state.toast.show('Steer works while a turn is running', 2200);
        return;
      }
      const text = editor.getText().trim();
      const editorIsBash = editor.inputMode === 'bash';

      // Steer only what the editor shows. The old behavior swept the entire
      // queued-message buffer into one interjection, silently consuming
      // follow-ups the user had queued for after the turn; the queue hint
      // never said Ctrl-S would eat the whole queue.
      const parts: string[] = [];
      if (!editorIsBash && text.length > 0) parts.push(text);

      if (parts.length === 0) {
        host.state.toast.show(`Type a steer message first, then ${primaryChord('S')}`, 2200);
        return;
      }
      editor.setText('');
      const session = host.session;
      if (host.state.appState.model.trim().length === 0 || session === undefined) {
        host.showError(LLM_NOT_SET_MESSAGE());
      } else {
        host.steerMessage(session, parts);
      }
      host.updateQueueDisplay();
      flushPromptInputState(host);
      requestTUILayoutRender(host.state);
    };

    editor.onCtrlB = (): boolean => {
      // Shell command execution is treated as a streaming phase ('shell'), so
      // this gate already covers it; idle gets a tip instead of a silent miss.
      if (host.state.appState.streamingPhase === 'idle' || host.state.appState.isCompacting) {
        host.state.toast.show('Background works while a turn is running', 2200);
        return false;
      }
      host.track('shortcut_background_task');
      host.detachCurrentForegroundTask();
      return true;
    };

    editor.onInsertNewline = () => {
      host.track('shortcut_newline');
    };

    editor.onTextPaste = () => {
      host.track('shortcut_paste', { kind: 'text' });
    };

    let browseMode: 'prompt' | 'bash' | null = null;
    if ('setHistoryFilter' in editor && typeof editor.setHistoryFilter === 'function') {
      editor.setHistoryFilter((entry: string) => {
        const mode = browseMode ?? editor.inputMode;
        return mode === 'bash' ? entry.startsWith('!') : true;
      });
    }
    editor.onRecall = (entry: string) => {
      if (entry.startsWith('!')) {
        if ('setInputMode' in editor && typeof editor.setInputMode === 'function') {
          (editor as { setInputMode(mode: 'prompt' | 'bash'): void }).setInputMode('bash');
        } else {
          editor.inputMode = 'bash';
          editor.onInputModeChange?.('bash');
        }
        return entry.slice(1);
      }
      if ('setInputMode' in editor && typeof editor.setInputMode === 'function') {
        (editor as { setInputMode(mode: 'prompt' | 'bash'): void }).setInputMode('prompt');
      } else {
        editor.inputMode = 'prompt';
        editor.onInputModeChange?.('prompt');
      }
      return undefined;
    };
    editor.onHistoryDraftSave = () => {
      browseMode = editor.inputMode;
      return editor.inputMode;
    };
    editor.onHistoryDraftRestore = (state: unknown) => {
      const mode = state as 'prompt' | 'bash';
      if ('setInputMode' in editor && typeof editor.setInputMode === 'function') {
        (editor as { setInputMode(mode: 'prompt' | 'bash'): void }).setInputMode(mode);
      } else {
        editor.inputMode = mode;
        editor.onInputModeChange?.(mode);
      }
      browseMode = null;
    };

    editor.onUpArrowEmpty = () => {
      const recalled = host.messageDispatch.recallLastQueued();
      if (recalled !== undefined) {
        const text = recalled.displayText ?? recalled.text;
        // The recall pops the item off the durable queue; without this
        // backup, clearing the editor afterwards destroyed the message
        // permanently. Stash keeps it recoverable via Ctrl-X.
        host.promptStash.push({ text, mode: recalled.mode ?? 'prompt' });
        editor.setText(text);
        // Restore the queued item's mode so a recalled `!` command runs as a
        // shell command again instead of being submitted as a normal prompt.
        const mode = recalled.mode ?? 'prompt';
        if (editor.inputMode !== mode) {
          editor.inputMode = mode;
          editor.onInputModeChange?.(mode);
        }
        host.updateQueueDisplay();
        flushPromptInputState(host);
        requestTUILayoutRender(host.state);
        return true;
      }
      if (host.state.appState.streamingPhase === 'idle' && !host.state.appState.isCompacting) {
        return false;
      }
      return host.btwPanelController.scroll('up');
    };

    editor.onDownArrowEmpty = () => host.btwPanelController.scroll('down');
    editor.onTranscriptPageUp = () => host.scrollTranscriptViewport('page-up');
    editor.onTranscriptPageDown = () => host.scrollTranscriptViewport('page-down');
    editor.onTranscriptTop = () => host.scrollTranscriptViewport('top');
    editor.onTranscriptBottom = () => host.scrollTranscriptViewport('bottom');

    editor.onPasteImage = async () => this.handleClipboardImagePaste();

    editor.onPasteText = (text) => this.handleDroppedMediaPaste(text);

    editor.onHistorySearch = () => {
      // History search is a pure local dialog (reads the history file, edits
      // the editor); it never touches the session, so it stays usable while a
      // turn runs. Seed the query with the current draft instead of refusing.
      const draft = editor.getText();
      if (draft.length > 0) {
        host.showHistorySearch(draft);
        return;
      }
      host.showHistorySearch();
    };
    editor.onCommandHub = () => {
      // Hub is safe mid-turn: buildDefaultCommandHubItems already disables
      // idle-only actions (undo/rewind/…) while streaming or compacting.
      // Operators still need Settings, model, help, cancel-adjacent jumps.
      host.showCommandHub();
    };
    editor.onOpenJobDeck = () => {
      const jobs = host.state.appState.conductorJobs?.jobs ?? [];
      if (jobs.length === 0) {
        host.showStatus(ttui('tui.session.noJobsYet'), 'textMuted');
        return;
      }
      host.jobBoardController.openDeck();
    };
    editor.onOpenJobInbox = () => {
      host.openJobInbox?.();
    };
    editor.onOpenIntentComposer = () => {
      focusIntentComposer({
        state: host.state,
        session: host.session,
        showStatus: (msg, color) => host.showStatus(msg, color),
        jobBoardController: host.jobBoardController,
      });
    };
    editor.onTranscriptSearch = () => {
      host.showTranscriptSearch();
    };
    editor.onStashToggle = () => {
      host.stashPromptToggle();
    };
  }

  clearPendingExit(): void {
    if (!this.pendingExit) return;
    clearTimeout(this.pendingExit.timer);
    this.host.state.footer.setTransientHint(null);
    this.pendingExit = null;
  }

  private armPendingUndoEsc(): void {
    this.clearPendingUndoEsc();
    const timer = setTimeout(() => {
      if (this.pendingUndoEsc?.timer === timer) {
        this.pendingUndoEsc = null;
      }
    }, DOUBLE_ESC_WINDOW_MS);
    this.pendingUndoEsc = { timer };
  }

  private clearPendingUndoEsc(): void {
    if (!this.pendingUndoEsc) return;
    clearTimeout(this.pendingUndoEsc.timer);
    this.pendingUndoEsc = null;
  }

  private armPendingExit(kind: 'ctrl-c' | 'ctrl-d', hint: string): void {
    this.clearPendingExit();
    this.host.state.footer.setTransientHint(hint);

    const timer = setTimeout(() => {
      if (this.pendingExit?.timer === timer) {
        this.clearPendingExit();
        requestTUILayoutRender(this.host.state);
      }
    }, EXIT_CONFIRM_WINDOW_MS);

    this.pendingExit = { kind, timer };
    requestTUILayoutRender(this.host.state);
  }

  /**
   * Clear the editor while preserving the draft. The old behavior destroyed
   * the text silently: a reflexive Ctrl-C mid-turn lost a long draft with no
   * toast and no Ctrl-X restore path. Stash parity keeps it recoverable.
   */
  private clearEditorTextIfPresent(): boolean {
    const editor = this.host.state.editor;
    const text = editor.getText();
    if (text.length === 0) return false;
    this.host.promptStash.push({ text, mode: editor.inputMode });
    editor.setText('');
    this.host.state.toast.show(ttui('tui.editor.draftClearedStashed'), 2200);
    flushPromptInputState(this.host);
    return true;
  }

  private cancelCurrentStream(source: 'esc' | 'ctrl-c'): void {
    // Cancel any running `!` shell command (treated as a streaming phase) in
    // addition to the agent turn, so Esc / Ctrl+C interrupts it too.
    this.host.cancelRunningShellCommand();
    void this.host.session?.cancel({ source });
  }

  private cancelCurrentCompaction(): void {
    const session = this.host.session;
    if (session === undefined) return;
    void session.cancelCompaction().catch((error: unknown) => {
      const message = formatErrorMessage(error);
      this.host.showError(ttui('tui.editor.cancelCompactionFailed', { message }));
    });
  }

  private async handleClipboardImagePaste(): Promise<boolean> {
    let items: ClipboardMedia[];
    try {
      items = await readClipboardMediaAll();
    } catch (error) {
      if (error instanceof ClipboardMediaError) {
        this.host.showError(error.message);
        return true;
      }
      return false;
    }
    if (items.length === 0) {
      this.host.showError(ttui('tui.clipboard.imageEmpty'));
      return false;
    }

    const segments: string[] = [];
    let imageCount = 0;
    let videoCount = 0;
    let fileCount = 0;
    let audioCount = 0;
    for (const media of items) {
      const segment = await this.attachClipboardMedia(media);
      if (segment === null) continue;
      segments.push(segment);
      if (media.kind === 'video') videoCount += 1;
      else if (media.kind === 'document') fileCount += 1;
      else if (media.kind === 'audio') audioCount += 1;
      else imageCount += 1;
    }
    if (segments.length === 0) {
      this.host.showError(ttui('tui.clipboard.imageAttachFailed'));
      // Consume the paste key so we do not fall through to path-like text when
      // the clipboard held image bytes we could not decode.
      return true;
    }

    this.host.state.editor.insertTextAtCursor?.(`${segments.join(' ')} `);
    requestTUILayoutRender(this.host.state);
    this.host.track('shortcut_paste', {
      kind: pasteKind(imageCount, videoCount, fileCount, audioCount),
      count: segments.length,
    });
    return true;
  }

  /**
   * Attach a single clipboard media item into the image store and return its
   * placeholder text, or `null` when the payload is not attachable.
   */
  private async attachClipboardMedia(media: ClipboardMedia): Promise<string | null> {
    if (media.kind === 'video') {
      const attachment = this.imageStore.addVideo(media.mimeType, media.sourcePath, media.filename);
      return attachment.placeholder;
    }
    if (media.kind === 'document') {
      const attachment = this.imageStore.addFile(media.mimeType, media.sourcePath, media.filename);
      return attachment.placeholder;
    }
    if (media.kind === 'audio') {
      const attachment = this.imageStore.addAudio(media.mimeType, media.sourcePath, media.filename);
      return attachment.placeholder;
    }
    const prepared = await preparePastedImage(media.bytes);
    if (prepared === null) return null;
    const attachment = this.imageStore.addImage(
      prepared.bytes,
      prepared.mime,
      prepared.width,
      prepared.height,
    );
    if (prepared.changed) {
      this.host.showStatus(
        ttui('tui.clipboard.imageResized', {
          from: formatBytes(prepared.originalByteLength),
          to: formatBytes(prepared.bytes.length),
        }),
        'textMuted',
      );
    }
    return attachment.placeholder;
  }

  /**
   * Attach images/videos dropped onto the terminal. Terminals deliver drops
   * as pasted path text; `parseDroppedFilePaths` only returns a list when
   * the entire paste resolves to existing files, so ordinary text pastes
   * never reach the attachment path. Non-media files in a mixed drop keep
   * their path in the prompt; if nothing attachable was dropped the paste
   * falls through to normal text insertion.
   *
   * Drop attach is async (downscale huge images) but the editor paste hook
   * is sync — claim the paste only when at least one path is media so plain
   * file paths still fall through to text paste.
   *
   * Right-click / bracketed paste of a bitmap (Win+Shift+S, browser copy)
   * arrives as empty or non-path text. Probe the OS clipboard first so those
   * pastes attach the same way as Ctrl/Cmd+V.
   */
  /**
   * Large-paste guard (D2). A paste above {@link LARGE_PASTE_WARN_CHARS} no
   * longer inserts silently: the first paste shows a size-aware confirm
   * toast and is claimed; pasting again (or after the confirm window) is
   * treated as deliberate and inserts. Prevents both the editor freeze from
   * giant logs and the accidental model send of a whole file.
   */
  private guardLargePaste(text: string): boolean {
    if (text.length <= LARGE_PASTE_WARN_CHARS) return false;
    const now = Date.now();
    const withinConfirm = this.largePasteConfirmedAt !== undefined &&
      now - this.largePasteConfirmedAt < LARGE_PASTE_CONFIRM_WINDOW_MS;
    if (withinConfirm) {
      this.largePasteConfirmedAt = undefined;
      return false;
    }
    this.largePasteConfirmedAt = now;
    const lines = text.split('\n').length;
    this.host.state.toast.show(
      ttui('tui.editor.largePaste', { size: formatBytes(text.length), count: lines }),
      4200,
    );
    return true;
  }

  private largePasteConfirmedAt: number | undefined;

  private handleDroppedMediaPaste(text: string): boolean {
    if (this.guardLargePaste(text)) return true;
    const paths = parseDroppedFilePaths(text);
    if (paths === null || paths.length === 0) {
      if (text.trim().length > 0) return false;
      // Empty bracketed paste (right-click of a bitmap). Claim it so the
      // editor does not insert a blank, then attach OS clipboard bytes.
      void this.attachClipboardBitmapIfPresent();
      return true;
    }

    let hasMedia = false;
    for (const path of paths) {
      try {
        if (readMediaPath(path) !== null) {
          hasMedia = true;
          break;
        }
      } catch (error) {
        if (error instanceof ClipboardMediaError) {
          this.host.showError(error.message);
          // Oversized video still counts as a media drop (error already shown).
          return true;
        }
      }
    }
    if (!hasMedia) return false;

    void this.attachDroppedMediaPaths(paths);
    return true;
  }

  /**
   * Attach a bitmap sitting on the OS clipboard when the paste payload itself
   * is empty (right-click / bracketed paste of Win+Shift+S or a browser image).
   * Stay silent when the clipboard has no image so an empty right-click paste
   * does not toast `imageEmpty`.
   */
  private async attachClipboardBitmapIfPresent(): Promise<void> {
    let items: ClipboardMedia[];
    try {
      items = await readClipboardMediaAll();
    } catch (error) {
      if (error instanceof ClipboardMediaError) {
        this.host.showError(error.message);
      }
      return;
    }
    if (items.length === 0) return;

    const segments: string[] = [];
    let imageCount = 0;
    let videoCount = 0;
    let fileCount = 0;
    let audioCount = 0;
    for (const media of items) {
      const segment = await this.attachClipboardMedia(media);
      if (segment === null) continue;
      segments.push(segment);
      if (media.kind === 'video') videoCount += 1;
      else if (media.kind === 'document') fileCount += 1;
      else if (media.kind === 'audio') audioCount += 1;
      else imageCount += 1;
    }
    if (segments.length === 0) {
      this.host.showError(ttui('tui.clipboard.imageAttachFailed'));
      return;
    }

    this.host.state.editor.insertTextAtCursor?.(`${segments.join(' ')} `);
    requestTUILayoutRender(this.host.state);
    this.host.track('shortcut_paste', {
      kind: pasteKind(imageCount, videoCount, fileCount, audioCount),
      count: segments.length,
    });
  }

  private async attachDroppedMediaPaths(paths: readonly string[]): Promise<void> {
    const segments: string[] = [];
    let attached = 0;
    for (const path of paths) {
      let media: ClipboardMedia | null;
      try {
        media = readMediaPath(path);
      } catch (error) {
        if (error instanceof ClipboardMediaError) {
          this.host.showError(error.message);
        }
        media = null;
      }
      if (media === null) {
        segments.push(path);
        continue;
      }
      const segment = await this.attachClipboardMedia(media);
      if (segment === null) {
        segments.push(path);
        continue;
      }
      segments.push(segment);
      attached += 1;
    }

    if (attached === 0) return;
    this.host.state.editor.insertTextAtCursor?.(`${segments.join(' ')} `);
    requestTUILayoutRender(this.host.state);
    this.host.track('shortcut_paste', { kind: 'drop', count: attached });
  }

  private async openExternalEditor(): Promise<void> {
    const { state } = this.host;
    if (state.externalEditorRunning) return;
    const cmd = resolveEditorCommand(state.appState.editorCommand);
    if (cmd === undefined) {
      this.host.showError(ttui('tui.status.noEditor'));
      return;
    }
    this.host.setExternalEditorRunning(true);
    const seed = state.editor.getExpandedText?.() ?? state.editor.getText();
    state.renderer.stop();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    try {
      const result = await editInExternalEditor(seed, cmd);
      if (result !== undefined) {
        state.editor.setText(result.replaceAll('\r\n', '\n').replace(/\n$/, ''));
      }
    } catch (error) {
      const msg = formatErrorMessage(error);
      this.host.showError(ttui('tui.editor.externalFailed', { message: msg }));
    } finally {
      if (typeof process.stdin.pause === 'function') {
        process.stdin.pause();
      }
      state.renderer.start();
      state.ui.setFocus(state.editor);
      state.renderer.requestRender(true);
      this.host.setExternalEditorRunning(false);
    }
  }
}