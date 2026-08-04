import type { CreateSessionOptions, LioraHarness, Session } from '@superliora/sdk';

import type { SessionLoadingOverlayComponent } from '../../components/dialogs/session/session-loading-overlay';
import type { ColorToken } from '../../theme';
import type { LioraTUIOptions } from '../../types';
import type { TUIState } from '../../tui-state';
import type { DisposableRegistry } from '../../utils/disposables';
import type { TUIStateNativeInputRouter } from '../../features/native-layout/native-input-router';
import type { PromptInputRuntimeHost } from '../../utils/prompt-input-state';
import type { PromptStash } from '../../utils/prompt-stash';
import type { AppearanceController } from '../appearance/index';
import type { AuthFlowController } from '../auth/auth-flow';
import type { ClipboardImageHintController } from '../clipboard/clipboard-image-hint';
import type { DialogsController } from '../dialogs/index';
import type { EditorKeyboardController } from '../shell/editor-keyboard';
import type { PanesController } from '../panes/panes';
import type { PromptIntelligenceController } from '../prompt/prompt-intelligence';
import type { SessionBrowserController } from '../session/session-browser';
import type { SessionEventHandler } from '../session-event/handler';
import type { SessionReplayRenderer } from '../session-replay/index';
import type { StreamingUIController } from '../streaming-ui/index';
import type { TasksBrowserController } from '../panes/tasks-browser';
import type { TranscriptRenderController } from '../transcript/transcript-render';
import type { UsageMonitorController } from '../usage/usage-monitor';

export type MutableCreateSessionOptions = {
  -readonly [P in keyof CreateSessionOptions]: CreateSessionOptions[P];
};

/** Host surface required by TUI startup, shutdown, and signal handling. */
export interface StartupLifecycleHost extends PromptInputRuntimeHost {
  harness: LioraHarness;
  options: LioraTUIOptions;
  session: Session | undefined;
  state: TUIState;
  aborted: boolean;
  lastUserInput: string | undefined;
  readonly promptStash: PromptStash;
  signalCleanupHandlers: Array<() => void>;
  isShuttingDown: boolean;
  eventLoopStarted: boolean;
  startupNotice: string | undefined;
  nativeInputRouter: TUIStateNativeInputRouter | undefined;
  nativeInputModalDispose: (() => void) | undefined;
  clipboardImageHintController: ClipboardImageHintController | undefined;
  terminalFocusTrackingDispose: (() => void) | undefined;
  fdPath: string | null;
  fdDownloadStarted: boolean;
  detachHintClearTimer: ReturnType<typeof setTimeout> | undefined;
  sessionLoadingOverlay: SessionLoadingOverlayComponent | undefined;
  nativeRendererDiagnosticsHudEnabled: boolean;
  readonly reverseRpcDisposers: Array<() => void>;
  readonly disposables: DisposableRegistry;
  readonly transcriptRender: TranscriptRenderController;
  readonly authFlow: AuthFlowController;
  readonly appearanceController: AppearanceController;
  readonly sessionBrowser: SessionBrowserController;
  readonly sessionReplay: SessionReplayRenderer;
  readonly sessionEventHandler: SessionEventHandler;
  readonly usageMonitor: UsageMonitorController;
  readonly editorKeyboard: EditorKeyboardController;
  readonly tasksBrowserController: TasksBrowserController;
  readonly jobBoardController: { close(): void; show(): void; openDeck(jobId?: string): void };
  readonly promptIntelligence: PromptIntelligenceController;
  readonly dialogs: DialogsController;
  readonly panes: PanesController;
  readonly streamingUI: StreamingUIController;

  onExit?: (exitCode?: number) => Promise<void>;

  setupAutocomplete(): void;
  loadPersistedInputHistory(): Promise<void>;
  refreshDynamicSlashCommands(session?: Session): Promise<void>;
  setSession(session: Session): Promise<void>;
  syncRuntimeState(session: Session): Promise<void>;
  closeSession(reason: string): Promise<void>;
  requireSession(): Session;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  showCommandHub(options?: { readonly intro?: boolean }): void;
  sendNormalUserInput(text: string, options?: { readonly displayText?: string }): void;
  isSessionLoadingOverlayActive(): boolean;
  beginSessionLoading(sessionId?: string, title?: string): void;
  reportSessionLoading(patch: {
    readonly phase?: import('../../components/dialogs/session/session-loading-overlay').SessionLoadingPhase;
    readonly progress?: number;
    readonly detail?: string;
    readonly sessionId?: string;
    readonly title?: string;
  }): void;
  endSessionLoading(): void;
  refreshTerminalThemeTracking(): void;
  readonly appStateController: { supportsCurrentModelCapability(capability: string): boolean };
  stop(exitCode?: number): Promise<void>;
}
