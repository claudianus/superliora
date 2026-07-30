import type { Component, Focusable } from '#/tui/renderer';
import { getInputHistoryFile } from '#/utils/paths';
import { loadInputHistory } from '#/utils/history/input-history';
import type { Session } from '@superliora/sdk';

import type { LioraSlashCommand, SlashCommandHelpMode } from '../commands';
import {
  buildDefaultCommandHubItems,
  commandHubKeepsOpen,
  commandHubNestsPicker,
  CommandHubComponent,
  cyclePermissionMode,
  isCommandHubCycleId,
  type CommandHubItem,
  type CommandHubSelectMode,
} from '../components/dialogs/command-hub';
import {
  CommandPaletteComponent,
  rankPaletteEntries,
  type PaletteEntry,
} from '../components/dialogs/command-palette';
import {
  advancedHelpIntro,
  advancedKeyboardShortcuts,
  HelpPanelComponent,
} from '../components/dialogs/help-panel';
import { HistorySearchDialogComponent } from '../components/dialogs/history-search-dialog';
import {
  SessionLoadingOverlayComponent,
  type SessionLoadingPhase,
} from '../components/dialogs/session-loading-overlay';
import { ShortcutsPanelComponent } from '../components/dialogs/shortcuts-panel';
import { TranscriptSearchDialogComponent } from '../components/dialogs/transcript-search';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_ONBOARDING_PREFERENCES,
  saveTuiConfig,
} from '../config';
import type { ApprovalPanelData, QuestionPanelData } from '../reverse-rpc/types';
import type { ColorToken } from '../theme';
import type { TUIState } from '../tui-state';
import type { AppState } from '../types';
import { commandHubActionToSlash } from '../utils/command-hub-actions';
import type { CenterModalMountOptions } from '../utils/center-modal';
import { noteSuccessFeedback } from '../utils/feedback-vfx';
import {
  flushSuppressedTUIFrame,
  requestTUIContentRender,
  requestTUILayoutRender,
} from '../utils/frame-render';
import { hubRecencyScore, noteHubActionUse } from '../utils/hub-recents';
import type { TUIStateNativeInputRouter } from '../utils/native-input-router';
import type { PromptStash } from '../utils/prompt-stash';
import { resolveTranscriptEntryLineOffset } from '../utils/transcript-entry-layout';
import { resolveTranscriptHitTestContext } from '../utils/transcript-hit-test';
import { jumpTranscriptViewportToLine } from '../utils/transcript-viewport';
import { ttui } from '../utils/tui-i18n';

function helpModeFromArgs(args: string): SlashCommandHelpMode {
  const normalized = args.trim().toLowerCase();
  if (normalized === 'diagnostics' || normalized === 'diagnostic' || normalized === 'internal') {
    return 'diagnostics';
  }
  return normalized === 'advanced' || normalized === 'manual' ? 'advanced' : 'primary';
}

/**
 * Host surface required by the dialog-mounting shell (editor-replacement /
 * center-modal mechanics, session-loading overlay, prompt stash) and the
 * Command Hub / palette / history / transcript search entry points.
 */
export interface DialogsHost {
  state: TUIState;
  session: Session | undefined;
  readonly promptStash: PromptStash;
  skillCommands: readonly LioraSlashCommand[];
  nativeInputRouter: TUIStateNativeInputRouter | undefined;
  nativeInputModalDispose: (() => void) | undefined;
  nativeInputModalSequence: number;
  centerModalSequence: number;
  openCommandHub: CommandHubComponent | undefined;
  deferredApproval: ApprovalPanelData | undefined;
  deferredQuestion: QuestionPanelData | undefined;
  sessionLoadingOverlay: SessionLoadingOverlayComponent | undefined;
  sessionLoadingPulseTimer: ReturnType<typeof setInterval> | undefined;

  setAppState(patch: Partial<AppState>): void;
  showStatus(message: string, color?: ColorToken): void;
  updateEditorBorderHighlight(text?: string): void;
  updateQueueDisplay(): void;
  showApprovalPanel(payload: ApprovalPanelData): void;
  showQuestionDialog(payload: QuestionPanelData): void;
  cancelRunningShellCommand(): void;
  getSlashCommands(mode?: SlashCommandHelpMode): readonly LioraSlashCommand[];
  dispatchSlash(command: string): void;
}

/**
 * Dialog-mounting shell (editor-replacement / center-modal mechanics, session
 * loading overlay, prompt stash) plus the Command Hub, command palette,
 * history search, transcript search, and help-panel entry points.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class DialogsController {
  constructor(private readonly host: DialogsHost) {}

  // -------------------------------------------------------------------------
  // Session loading overlay
  // -------------------------------------------------------------------------

  isSessionLoadingOverlayActive(): boolean {
    return this.host.sessionLoadingOverlay !== undefined;
  }

  beginSessionLoading(sessionId?: string, title?: string): void {
    const { host } = this;
    host.setAppState({ isReplaying: true });
    if (host.sessionLoadingOverlay !== undefined) {
      this.reportSessionLoading({
        phase: 'opening',
        progress: 0.08,
        sessionId,
        title,
        detail: ttui('tui.sessionLoading.phase.opening'),
      });
      return;
    }
    // Drop any open picker/dashboard so a second resume cannot start mid-load.
    if (
      host.state.activeDialog === 'session-picker' ||
      host.state.activeDialog === 'agent-dashboard' ||
      host.state.activeDialog === 'command' ||
      host.state.activeDialog === 'help' ||
      host.state.activeDialog === 'search'
    ) {
      host.state.activeDialog = null;
    }
    const overlay = new SessionLoadingOverlayComponent({
      sessionId,
      title,
      phase: 'opening',
      progress: 0.08,
      detail: ttui('tui.sessionLoading.phase.opening'),
    });
    host.sessionLoadingOverlay = overlay;
    host.state.activeDialog = 'session-loading';
    this.mountEditorReplacement(overlay);
    this.startSessionLoadingPulse();
    // Paint immediately so the user never sees a silent freeze.
    flushSuppressedTUIFrame(host.state, 'layout');
  }

  reportSessionLoading(patch: {
    readonly phase?: SessionLoadingPhase;
    readonly progress?: number;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly title?: string;
  }): void {
    const overlay = this.host.sessionLoadingOverlay;
    if (overlay === undefined) return;
    overlay.update(patch);
    // Mid-hydrate content frames are suppressed by batch mount; force a layout
    // paint so the modal spinner/bar stay alive.
    flushSuppressedTUIFrame(this.host.state, 'layout');
  }

  endSessionLoading(): void {
    const { host } = this;
    this.stopSessionLoadingPulse();
    host.sessionLoadingOverlay = undefined;
    host.setAppState({ isReplaying: false });
    if (host.state.activeDialog === 'session-loading') {
      host.state.activeDialog = null;
      this.restoreEditor();
    } else {
      // Overlay was already replaced; still force a final layout paint.
      flushSuppressedTUIFrame(host.state, 'layout');
    }
  }

  async runWithBusyOverlay<T>(
    options: {
      readonly title?: string;
      readonly detail?: string;
      readonly sessionId?: string;
      readonly phase?: SessionLoadingPhase;
    },
    work: () => Promise<T> | T,
  ): Promise<T> {
    const already = this.isSessionLoadingOverlayActive();
    if (!already) {
      this.beginSessionLoading(options.sessionId, options.title);
    }
    this.reportSessionLoading({
      phase: options.phase ?? 'working',
      detail: options.detail ?? ttui('tui.sessionLoading.phase.working'),
      sessionId: options.sessionId,
      title: options.title,
    });
    // Let the modal paint before potentially-blocking work.
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      return await work();
    } finally {
      if (!already) {
        this.endSessionLoading();
      }
    }
  }

  private startSessionLoadingPulse(): void {
    this.stopSessionLoadingPulse();
    this.host.sessionLoadingPulseTimer = setInterval(() => {
      if (this.host.sessionLoadingOverlay === undefined) {
        this.stopSessionLoadingPulse();
        return;
      }
      flushSuppressedTUIFrame(this.host.state, 'content');
    }, 100);
  }

  /** Also called directly from `LioraTUI#stop` during shutdown. */
  stopSessionLoadingPulse(): void {
    const { host } = this;
    if (host.sessionLoadingPulseTimer === undefined) return;
    clearInterval(host.sessionLoadingPulseTimer);
    host.sessionLoadingPulseTimer = undefined;
  }

  // -------------------------------------------------------------------------
  // Editor-replacement / center-modal shell
  // -------------------------------------------------------------------------

  mountEditorReplacement(panel: Component & Focusable): void {
    const { host } = this;
    // Center modals own the input stack — close them before editor takeover.
    if (host.state.centerModalStack.length > 0) this.closeAllCenterModals();
    host.state.editorContainer.clear();
    host.state.editorContainer.addChild(panel);
    host.state.ui.setFocus(panel);
    this.mountNativeInputModal(panel);
    // Track that a command-driven dialog owns the editor area so background
    // approval/question events do not clobber it mid-flow (BUG-7). Help and
    // session-picker set their own specific dialog id after this call.
    // Keep session-loading sticky so restore paths cannot silently drop the lock.
    if (host.state.activeDialog === null) host.state.activeDialog = 'command';
    requestTUIContentRender(host.state);
  }

  /**
   * Float a PREMIUM panel in the viewport center (Command Hub, Settings, …).
   * Does not replace the editor strip. See PREMIUM.md §8.2.
   */
  mountCenterModal(
    panel: Component & Focusable,
    options: CenterModalMountOptions = {},
  ): void {
    const { host } = this;
    const mode = options.mode ?? 'push';
    if (mode === 'replace' && host.state.centerModalStack.length > 0) {
      this.closeCenterModal();
    }
    // Block only true full-page takeovers (not center-modal dialog ids).
    switch (host.state.activeDialog) {
      case 'session-loading':
      case 'files':
      case 'file-viewer':
      case 'diff-review':
      case 'commit-browser':
      case 'blame':
      case 'error-navigator':
      case 'search':
      case 'agent-dashboard':
        return;
      default:
        break;
    }
    const inputRouter = host.nativeInputRouter;
    if (inputRouter === undefined || panel.handleInput === undefined) return;
    const id = `center-modal:${String(++host.centerModalSequence)}`;
    const handleInput = panel.handleInput.bind(panel);
    const disposeInput = inputRouter.pushLegacyModalTarget(
      {
        id,
        handleInput: (data) => {
          handleInput(data);
        },
      },
      { restoreFocus: false },
    );
    host.state.centerModalStack.push({
      id,
      panel,
      disposeInput,
      label: options.label,
    });
    host.state.activeDialog = 'center-modal';
    host.state.ui.setFocus(panel);
    requestTUIContentRender(host.state);
  }

  /** Pop the top center modal. Restores editor focus when the stack is empty. */
  closeCenterModal(): void {
    const { host } = this;
    const top = host.state.centerModalStack.pop();
    if (top === undefined) return;
    if (top.panel === host.openCommandHub) {
      host.openCommandHub = undefined;
    }
    top.disposeInput();
    if (host.state.centerModalStack.length === 0) {
      this.clearCenterModalDialogMarker();
      host.nativeInputRouter?.focusEditor();
      host.state.ui.setFocus(host.state.editor);
      this.flushDeferredReverseRpcPanels();
    } else {
      const next = host.state.centerModalStack.at(-1)!;
      host.state.ui.setFocus(next.panel);
      if (next.panel instanceof CommandHubComponent) {
        this.refreshOpenCommandHub();
      }
    }
    requestTUIContentRender(host.state);
  }

  closeAllCenterModals(): void {
    const { host } = this;
    while (host.state.centerModalStack.length > 0) {
      const top = host.state.centerModalStack.pop();
      top?.disposeInput();
    }
    host.openCommandHub = undefined;
    this.clearCenterModalDialogMarker();
    host.nativeInputRouter?.focusEditor();
    host.state.ui.setFocus(host.state.editor);
    requestTUIContentRender(host.state);
    this.flushDeferredReverseRpcPanels();
  }

  private clearCenterModalDialogMarker(): void {
    const { host } = this;
    switch (host.state.activeDialog) {
      case 'center-modal':
      case 'help':
      case 'extensions':
      case 'session-picker':
        host.state.activeDialog = null;
        break;
      default:
        break;
    }
  }

  private flushDeferredReverseRpcPanels(): void {
    const { host } = this;
    const approval = host.deferredApproval;
    if (approval !== undefined) {
      host.deferredApproval = undefined;
      host.showApprovalPanel(approval);
      return;
    }
    const question = host.deferredQuestion;
    if (question !== undefined) {
      host.deferredQuestion = undefined;
      host.showQuestionDialog(question);
    }
  }

  restoreEditor(): void {
    const { host } = this;
    // Never restore the free editor while history is still loading.
    if (host.sessionLoadingOverlay !== undefined) {
      host.state.editorContainer.clear();
      host.state.editorContainer.addChild(host.sessionLoadingOverlay);
      host.state.ui.setFocus(host.sessionLoadingOverlay);
      this.mountNativeInputModal(host.sessionLoadingOverlay);
      host.state.activeDialog = 'session-loading';
      requestTUIContentRender(host.state);
      return;
    }
    host.state.editorContainer.clear();
    host.state.editorContainer.addChild(host.state.editor);
    host.state.ui.setFocus(host.state.editor);
    host.nativeInputModalDispose?.();
    host.nativeInputModalDispose = undefined;
    host.nativeInputRouter?.focusEditor();
    // Only clear a generic command-dialog marker. Help/session-picker/
    // agent-dashboard manage their own `activeDialog` lifecycle and may
    // already be null here.
    if (host.state.activeDialog === 'command' || host.state.activeDialog === 'session-loading') {
      host.state.activeDialog = null;
    }
    requestTUIContentRender(host.state);
    // Flush any reverse-RPC panel that was deferred while a command dialog was
    // open (BUG-7). Approval takes priority, then question.
    const approval = host.deferredApproval;
    if (approval !== undefined) {
      host.deferredApproval = undefined;
      host.showApprovalPanel(approval);
      return;
    }
    const question = host.deferredQuestion;
    if (question !== undefined) {
      host.deferredQuestion = undefined;
      host.showQuestionDialog(question);
    }
  }

  private mountNativeInputModal(panel: Component & Focusable): void {
    const { host } = this;
    const inputRouter = host.nativeInputRouter;
    if (inputRouter === undefined || panel.handleInput === undefined) return;
    host.nativeInputModalDispose?.();
    const id = `editor-replacement:${String(++host.nativeInputModalSequence)}`;
    const handleInput = panel.handleInput.bind(panel);
    host.nativeInputModalDispose = inputRouter.pushLegacyModalTarget({
      id,
      handleInput: (data) => {
        handleInput(data);
      },
    });
  }

  restoreInputText(text: string): void {
    const { host } = this;
    this.restoreEditor();
    host.state.editor.setText(text);
    host.updateEditorBorderHighlight(text);
    requestTUIContentRender(host.state);
  }

  /** Ctrl-X: stash the current draft, or pop the latest stash when the editor is empty. */
  stashPromptToggle(): void {
    const { host } = this;
    const editor = host.state.editor;
    const text = editor.getText();
    if (text.trim().length > 0) {
      host.promptStash.push({ text, mode: editor.inputMode });
      editor.setText('');
      host.updateEditorBorderHighlight('');
      host.showStatus(ttui('tui.stash.stashed', { count: String(host.promptStash.size) }));
      requestTUIContentRender(host.state);
      return;
    }
    const entry = host.promptStash.pop();
    if (entry === undefined) {
      host.showStatus(ttui('tui.stash.empty'));
      return;
    }
    this.restoreInputText(entry.text);
    // Restore the stashed mode like queue recall does, so a draft saved in
    // shell mode comes back ready to run as a `!` command.
    const mode = entry.mode;
    if (editor.inputMode !== mode) {
      editor.inputMode = mode;
      editor.onInputModeChange?.(mode);
    }
    host.updateQueueDisplay();
    requestTUILayoutRender(host.state);
    host.showStatus(ttui('tui.stash.restored', { count: String(host.promptStash.size) }));
  }

  // -------------------------------------------------------------------------
  // History search (Ctrl-R), Command Hub (? / Ctrl-K), transcript search (Ctrl-F)
  // -------------------------------------------------------------------------

  showHistorySearch(): void {
    const { host } = this;
    if (host.state.activeDialog !== null && host.state.activeDialog !== 'center-modal') return;
    void this.openHistorySearch();
  }

  private async openHistorySearch(): Promise<void> {
    const { host } = this;
    let entries: { content: string }[] = [];
    try {
      entries = await loadInputHistory(getInputHistoryFile(host.state.appState.workDir));
    } catch {
      entries = [];
    }
    // Most-recent-first ordering for search UX.
    const items = [...new Set(entries.map((e) => e.content))].reverse();
    const dialog = new HistorySearchDialogComponent({
      items,
      onSelect: (text) => {
        this.restoreEditor();
        host.state.editor.setText(text);
        host.updateEditorBorderHighlight(text);
        requestTUIContentRender(host.state);
      },
      onCancel: () => {
        this.restoreEditor();
      },
    });
    this.mountEditorReplacement(dialog);
  }

  /** Open the beginner Command Hub (replaces the old Ctrl-Space palette). */
  showCommandPalette(): void {
    this.showCommandHub();
  }

  /**
   * Power-user omnibox: fuzzy-search every slash command, skill, and a few
   * session actions, then run the selection. Opened from the Hub
   * (Help → Command palette); Esc returns to the Hub when it is stacked
   * below. Recently run entries float to the top via Hub recency scoring.
   */
  showCommandPaletteOmnibox(): void {
    const { host } = this;
    if (
      host.state.activeDialog !== null &&
      host.state.activeDialog !== 'center-modal' &&
      host.state.activeDialog !== 'help'
    ) {
      return;
    }
    const entries = rankPaletteEntries(this.buildPaletteEntries(), (entry) =>
      hubRecencyScore(this.paletteRecencyKey(entry)),
    );
    const palette = new CommandPaletteComponent({
      entries,
      onSelect: (entry) => {
        this.closeAllCenterModals();
        this.runPaletteEntry(entry);
      },
      onCancel: () => {
        this.closeCenterModal();
      },
    });
    this.mountCenterModal(palette, { mode: 'push', label: 'Palette' });
  }

  private buildPaletteEntries(): PaletteEntry[] {
    const { host } = this;
    const skillNames = new Set(host.skillCommands.map((command) => command.name));
    const commands: PaletteEntry[] = host.getSlashCommands('advanced').map((command) => ({
      kind: skillNames.has(command.name) ? 'skill' : 'command',
      value: command.name,
      label: `/${command.name}`,
      description: command.description,
      aliases: command.aliases,
    }));
    const actions: PaletteEntry[] = [
      {
        kind: 'action',
        value: 'hub',
        label: 'Command Hub',
        description: 'Open the guided dashboard',
      },
      {
        kind: 'action',
        value: 'shortcuts',
        label: 'Keyboard shortcuts',
        description: 'Keybinding cheatsheet',
      },
      {
        kind: 'action',
        value: 'transcript-search',
        label: 'Search transcript',
        description: 'Find text in this chat',
      },
      {
        kind: 'action',
        value: 'history',
        label: 'Input history',
        description: 'Reuse a past prompt',
      },
    ];
    return [...actions, ...commands];
  }

  private runPaletteEntry(entry: PaletteEntry): void {
    const { host } = this;
    noteHubActionUse(this.paletteRecencyKey(entry));
    noteSuccessFeedback();
    if (entry.kind === 'action') {
      switch (entry.value) {
        case 'hub':
          this.showCommandHub();
          return;
        case 'shortcuts':
          this.mountCenterModal(
            new ShortcutsPanelComponent({
              onClose: () => this.closeCenterModal(),
            }),
            { mode: 'push', label: 'Shortcuts' },
          );
          return;
        case 'transcript-search':
          this.showTranscriptSearch();
          return;
        case 'history':
          void this.openHistorySearch();
          return;
        default:
          return;
      }
    }
    host.dispatchSlash(`/${entry.value}`);
  }

  /** Namespaced so palette runs never match Hub item ids in recency lookups. */
  private paletteRecencyKey(entry: PaletteEntry): string {
    return `palette:${entry.kind}:${entry.value}`;
  }

  showCommandHub(
    options: { readonly initialQuery?: string; readonly intro?: boolean } = {},
  ): void {
    const { host } = this;
    if (
      host.state.activeDialog !== null &&
      host.state.activeDialog !== 'center-modal' &&
      host.state.activeDialog !== 'help'
    ) {
      return;
    }
    this.closeAllCenterModals();
    const hub = new CommandHubComponent({
      items: this.buildCommandHubItems(),
      initialQuery: options.initialQuery,
      intro: options.intro === true,
      onIntroDismiss: () => {
        void this.markHubIntroSeen();
      },
      onSelect: (item, mode) => {
        this.handleCommandHubSelect(item, mode);
      },
      onCancel: () => {
        this.closeCenterModal();
      },
    });
    host.openCommandHub = hub;
    this.mountCenterModal(hub, { mode: 'push', label: 'Hub' });
    if (options.intro === true) {
      noteSuccessFeedback();
      host.state.toast.show('Command Hub — Space toggles modes · type to search', 3200);
    }
  }

  private buildCommandHubItems(): CommandHubItem[] {
    const { host } = this;
    const signedIn =
      host.state.appState.model.trim().length > 0 ||
      Object.keys(host.state.appState.availableProviders).length > 0;
    return buildDefaultCommandHubItems({
      planMode: host.state.appState.planMode,
      swarmMode: host.state.appState.swarmMode,
      ultraworkMode: host.state.appState.ultraworkMode,
      premiumQualityMode: host.state.appState.premiumQualityMode,
      permissionMode: host.state.appState.permissionMode,
      model: host.state.appState.model,
      thinkingLevel: host.state.appState.thinkingLevel,
      streamingPhase: host.state.appState.streamingPhase,
      isCompacting: host.state.appState.isCompacting,
      signedIn,
    });
  }

  /** Also called directly from `LioraTUI#setAppState` when Hub-visible state changes. */
  refreshOpenCommandHub(): void {
    const { host } = this;
    const hub = host.openCommandHub;
    if (hub === undefined) return;
    hub.setItems(this.buildCommandHubItems());
    requestTUIContentRender(host.state);
  }

  private async markHubIntroSeen(): Promise<void> {
    const { host } = this;
    const previous = host.state.appState.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES;
    if (previous.hubIntroSeen) return;
    const onboarding = { ...previous, hubIntroSeen: true };
    host.setAppState({ onboarding });
    try {
      await saveTuiConfig({
        theme: host.state.appState.theme,
        permissionMode: host.state.appState.permissionMode,
        disablePasteBurst: host.state.appState.disablePasteBurst ?? false,
        editorCommand: host.state.appState.editorCommand,
        notifications: host.state.appState.notifications,
        upgrade: host.state.appState.upgrade,
        appearance: host.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
        onboarding,
      });
    } catch {
      // Best-effort persistence; intro still dismissed in-session.
    }
  }

  private handleCommandHubSelect(item: CommandHubItem, mode: CommandHubSelectMode): void {
    const { host } = this;
    noteHubActionUse(item.id);

    // Permission: Space cycles in place; Enter opens the picker (nested).
    if (isCommandHubCycleId(item.id)) {
      if (mode === 'space') {
        const next = cyclePermissionMode(host.state.appState.permissionMode);
        host.dispatchSlash(`/permission ${next}`);
        host.openCommandHub?.noteToggleFlash(item.id);
        noteSuccessFeedback();
        host.state.toast.show(`Permission → ${next}`, 1600);
        return;
      }
      host.dispatchSlash('/permission');
      return;
    }

    if (commandHubKeepsOpen(item.id)) {
      const slash = commandHubActionToSlash(item.id);
      if (slash !== undefined) {
        host.dispatchSlash(slash);
      }
      const label = item.label;
      const nextOn = item.badge !== 'ON';
      noteSuccessFeedback();
      host.state.toast.show(`${label} → ${nextOn ? 'ON' : 'off'}`, 1400);
      // Space: stay in Hub and flip more. Enter: apply and return to chat.
      if (mode === 'enter') {
        this.closeCenterModal();
      } else {
        host.openCommandHub?.noteToggleFlash(item.id);
      }
      return;
    }

    if (item.id === 'now.steer') {
      this.closeAllCenterModals();
      host.state.footer.setTransientHint('Steer: type, then Ctrl-S');
      host.state.toast.show('Type steer text · Ctrl-S to send', 2800);
      requestTUIContentRender(host.state);
      return;
    }
    if (item.id === 'now.stop') {
      this.closeAllCenterModals();
      host.cancelRunningShellCommand();
      void host.session?.cancel({ source: 'ctrl-c' });
      noteSuccessFeedback();
      host.state.toast.show('Stopped', 1400);
      return;
    }

    if (commandHubNestsPicker(item.id)) {
      this.handleCommandHubAction(item, { nest: true });
      return;
    }

    this.closeCenterModal();
    this.handleCommandHubAction(item, { nest: false });
  }

  private handleCommandHubAction(
    item: CommandHubItem,
    options: { readonly nest: boolean },
  ): void {
    const { host } = this;
    if (item.id === 'help.palette') {
      this.showCommandPaletteOmnibox();
      return;
    }
    if (item.id === 'help.shortcuts') {
      this.mountCenterModal(
        new ShortcutsPanelComponent({
          onClose: () => this.closeCenterModal(),
        }),
        { mode: 'push', label: 'Shortcuts' },
      );
      return;
    }
    if (item.id === 'help.commands') {
      // Nest under Hub so Esc returns (don't wipe the stack).
      this.mountCenterModal(
        new HelpPanelComponent({
          commands: host.getSlashCommands('advanced'),
          intro: advancedHelpIntro(),
          commandSectionTitle: 'All slash commands',
          shortcuts: advancedKeyboardShortcuts(),
          onClose: () => {
            this.closeCenterModal();
          },
        }),
        { mode: options.nest ? 'push' : 'replace', label: 'Commands' },
      );
      return;
    }
    if (item.id === 'workspace.search') {
      this.restoreInputText('/search ');
      host.state.toast.show('Type a search pattern after /search', 2200);
      return;
    }
    if (item.id === 'chat.btw') {
      this.restoreInputText('/btw ');
      host.state.toast.show('Type your side question after /btw', 2200);
      return;
    }

    const slash = commandHubActionToSlash(item.id);
    if (slash !== undefined) {
      host.dispatchSlash(slash);
    }
  }

  showTranscriptSearch(): void {
    const { host } = this;
    if (host.state.activeDialog !== null) return;
    const entries = host.state.transcriptEntries
      .map((entry, index) => {
        // Strip ANSI/control noise from searchable text.
        const text = entry.content.replace(/\u001B\[[0-9;]*m/g, '').trim();
        return { index, text };
      })
      .filter((entry) => entry.text.length > 0);
    const dialog = new TranscriptSearchDialogComponent({
      entries,
      onSelect: (index) => {
        // Keep the dialog open so the user can jump to more matches; just
        // scroll the matching entry into view.
        this.scrollToTranscriptIndex(index);
      },
      onCancel: () => {
        this.restoreEditor();
      },
    });
    this.mountEditorReplacement(dialog);
  }

  /** Also used by the Error Navigator (`showErrors`, kept on `LioraTUI`). */
  scrollToTranscriptIndex(index: number): void {
    const { host } = this;
    const entry = host.state.transcriptEntries[index];
    if (entry === undefined) return;
    // Exact jump: resolve the entry's first line in the current transcript
    // layout and move the viewport start there. Resolving the hit-test
    // context also warms the cached transcript layout.
    const context = resolveTranscriptHitTestContext(host.state);
    if (context !== undefined) {
      const line = resolveTranscriptEntryLineOffset(host.state, entry.id, context.stageWidth);
      if (line !== undefined) {
        jumpTranscriptViewportToLine(host.state.transcriptViewport, line);
        requestTUIContentRender(host.state);
        return;
      }
    }
    // Roughly map a transcript entry index to a scroll position. The viewport
    // is line-based; we approximate by scrolling to the entry proportionally.
    const total = host.state.transcriptEntries.length;
    if (total === 0) return;
    // Jump to bottom first, then up by the offset of entries after the target.
    host.state.transcriptViewport.scroll('bottom');
    const entriesAfter = total - 1 - index;
    // Each entry is at least one rendered line; scroll up by a few lines per
    // entry as a heuristic. The viewport clamps automatically.
    for (let i = 0; i < entriesAfter * 3; i++) {
      host.state.transcriptViewport.scroll('line-up');
    }
    requestTUIContentRender(host.state);
  }

  // -------------------------------------------------------------------------
  // Help panel
  // -------------------------------------------------------------------------

  showHelpPanel(args = ''): void {
    const { host } = this;
    const mode = helpModeFromArgs(args);
    // Beginner path: `/help` opens the Command Hub, not a wall of slash names.
    if (mode === 'primary') {
      this.showCommandHub();
      return;
    }
    this.closeAllCenterModals();
    this.mountCenterModal(
      new HelpPanelComponent({
        commands: host.getSlashCommands(mode),
        intro: mode === 'diagnostics'
          ? 'Advanced QA commands for SuperLiora harness development.'
          : advancedHelpIntro(),
        commandSectionTitle: mode === 'diagnostics'
          ? 'Diagnostic commands'
          : 'All slash commands',
        shortcuts: mode === 'advanced' ? advancedKeyboardShortcuts() : undefined,
        onClose: () => {
          this.closeCenterModal();
        },
      }),
    );
  }
}
