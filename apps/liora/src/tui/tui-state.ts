import {
  Container,
  createTerminalRenderer,
  measureRendererRegions,
  type RendererRect,
  type RendererRootUI,
  type RendererTerminalHost,
  type TerminalRenderer,
} from '#/tui/renderer';

import { FooterComponent } from './components/chrome/footer';
import { GutterContainer } from './components/chrome/gutter-container';
import { HeaderComponent } from './components/chrome/header';
import type { MoonLoader, SpinnerStyle } from './components/chrome/moon-loader';
import { TodoPanelComponent } from './components/chrome/todo-panel';
import type { SessionRow } from './components/dialogs/session-picker';
import type { TUIEditor } from './components/editor/editor-contract';
import { createTUIEditor } from './components/editor/editor-factory';
import { TranscriptViewportComponent } from './components/messages/transcript-viewport';
import { CHROME_GUTTER } from './constant/rendering';
import type { TasksBrowserState } from './controllers/tasks-browser';
import { currentTheme, type Theme } from './theme';
import { resolveStageLayout, STAGE_MAX_WIDTH } from './controllers/stage-layout';
import { NativeEditorTextInputController } from './utils/native-editor-text-input';
import { createTerminalState, type TerminalState } from './utils/terminal-state';
import {
  createTranscriptSelectionState,
  shouldHoldTranscriptAnimation,
  type TranscriptSelectionState,
} from './utils/transcript-selection';
import {
  createTranscriptViewportState,
  type TranscriptViewportState,
} from './utils/transcript-viewport';
import {
  INITIAL_LIVE_PANE,
  type AppState,
  type LioraTUIOptions,
  type LivePaneState,
  type QueuedMessage,
  type TranscriptEntry,
  type TUIStartupState,
} from './types';

export interface TUIState {
  renderer: TerminalRenderer;
  ui: RendererRootUI;
  terminal: RendererTerminalHost;
  transcriptViewport: TranscriptViewportState;
  transcriptSelection: TranscriptSelectionState;
  transcriptContainer: TranscriptViewportComponent;
  activityContainer: Container;
  todoPanelContainer: Container;
  todoPanel: TodoPanelComponent;
  queueContainer: Container;
  btwPanelContainer: Container;
  editorContainer: Container;
  footerContainer: Container;
  footer: FooterComponent;
  headerContainer: Container;
  header: HeaderComponent;
  editor: TUIEditor;
  nativeEditorTextInput: NativeEditorTextInputController;
  theme: Theme;
  appState: AppState;
  startupState: TUIStartupState;
  livePane: LivePaneState;
  transcriptEntries: TranscriptEntry[];
  terminalState: TerminalState;
  activitySpinner: { instance: MoonLoader; style: SpinnerStyle } | null;
  toolOutputExpanded: boolean;
  sessions: SessionRow[];
  loadingSessions: boolean;
  sessionsScope: 'cwd' | 'all';
  activeDialog:
    | 'session-picker'
    | 'help'
    | 'files'
    | 'file-viewer'
    | 'command' // any command-driven editor-replacement dialog (api-key, provider picker, etc.)
    | null;
  tasksBrowser: TasksBrowserState | undefined;
  externalEditorRunning: boolean;
  queuedMessages: QueuedMessage[];
  swarmModeEntry: 'manual' | 'task' | 'ultrawork' | undefined;
  /**
   * Cached editor rect from the last call to getTUIStateNativeEditorRect.
   * Avoids a full layout recomputation (planTUINativeStage) on every keystroke.
   * Keyed by (columns, rows, editorLineCount) so it self-invalidates on
   * terminal resize or editor content height change (Enter / backspace).
   */
  cachedEditorRect?: RendererRect;
  cachedEditorRectColumns?: number;
  cachedEditorRectRows?: number;
  cachedEditorRectLineCount?: number;
  /**
   * Cached transcript layout from the last resolveTranscriptHitTestContext call.
   * Avoids a second planTUINativeStage call on mouse clicks. Shares the same
   * invalidation key as the editor rect cache (columns, rows, editorLineCount).
   */
  cachedTranscriptRect?: RendererRect;
  cachedTranscriptVisibleRows?: number;
  cachedTranscriptStageWidth?: number;
  cachedTranscriptColumns?: number;
  cachedTranscriptRows?: number;
  cachedTranscriptLineCount?: number;
  /**
   * Set true when the startup splash morph finishes and the real UI tree is
   * restored. The next frame suppresses its full-clear so the last morph frame
   * cross-fades into the real layout without a black flash. Consumed (reset to
   * false) by the native render callback on the first post-splash frame.
   */
  splashJustDisposed?: boolean;
}

export function createTUIState(options: LioraTUIOptions): TUIState {
  const initialAppState = options.initialAppState;
  const theme = currentTheme;

  const renderer = options.renderer ?? createTerminalRenderer();
  const { terminal, ui } = renderer;

  const transcriptViewport = createTranscriptViewportState();
  const transcriptSelection = createTranscriptSelectionState();
  renderer.setAutoFrameHold(() =>
    shouldHoldTranscriptAnimation({ followOutput: transcriptViewport.followOutput, transcriptSelection }),
  );
  const activityContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const todoPanelContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const todoPanel = new TodoPanelComponent();
  const queueContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const btwPanelContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const editorContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const footerContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const headerContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const transcriptContainer = new TranscriptViewportComponent(
    CHROME_GUTTER,
    CHROME_GUTTER,
    transcriptViewport,
    (_width) => {
      const probeWidth = Math.min(terminal.columns, STAGE_MAX_WIDTH);
      const hasRailContent =
        measureContainerRows(todoPanelContainer, probeWidth) > 0 ||
        measureContainerRows(activityContainer, probeWidth) > 0 ||
        measureContainerRows(queueContainer, probeWidth) > 0 ||
        measureContainerRows(btwPanelContainer, probeWidth) > 0;
      const stage = resolveStageLayout({
        width: terminal.columns,
        height: terminal.rows,
        hasRailContent,
      });
      const contentWidth = stage.stage.width;
      const rail = stage.mode === 'rail';
      return measureRendererRegions({
        terminalRows: terminal.rows,
        terminalColumns: terminal.columns,
        contentX: stage.stage.x,
        contentWidth,
        contentY: stage.stage.y,
        contentHeight: stage.stage.height,
        heights: {
          header: measureContainerRows(headerContainer, contentWidth),
          activity: rail ? 0 : measureContainerRows(activityContainer, contentWidth),
          todo: rail ? 0 : measureContainerRows(todoPanelContainer, contentWidth),
          queue: rail ? 0 : measureContainerRows(queueContainer, contentWidth),
          btw: rail ? 0 : measureContainerRows(btwPanelContainer, contentWidth),
          editor: measureContainerRows(editorContainer, contentWidth),
          footer: measureContainerRows(footerContainer, contentWidth),
        },
      }).transcriptRows;
    },
  );
  const editor = createTUIEditor(ui);
  if ('setDisablePasteBurst' in editor) {
    (editor as { setDisablePasteBurst(disabled: boolean): void }).setDisablePasteBurst(
      initialAppState.disablePasteBurst ?? false,
    );
  }
  const nativeEditorTextInput = new NativeEditorTextInputController();
  const footer = new FooterComponent(
    { ...initialAppState },
    () => {
      renderer.invalidateFrame('content');
    },
    () => transcriptViewport.snapshot(),
  );
  const header = new HeaderComponent({ ...initialAppState }, () => {
    renderer.invalidateFrame('content');
  });

  return {
    renderer,
    ui,
    terminal,
    transcriptViewport,
    transcriptSelection,
    transcriptContainer,
    activityContainer,
    todoPanelContainer,
    todoPanel,
    queueContainer,
    btwPanelContainer,
    editorContainer,
    footerContainer,
    editor,
    nativeEditorTextInput,
    footer,
    headerContainer,
    header,
    theme,
    appState: { ...initialAppState },
    startupState: 'pending',
    livePane: { ...INITIAL_LIVE_PANE },
    transcriptEntries: [],
    terminalState: createTerminalState(),
    activitySpinner: null,
    toolOutputExpanded: false,
    sessions: [],
    loadingSessions: false,
    sessionsScope: 'cwd',
    activeDialog: null,
    tasksBrowser: undefined,
    externalEditorRunning: false,
    queuedMessages: [],
    swarmModeEntry: undefined,
  };
}

function measureContainerRows(container: Container, width: number): number {
  return container.render(width).length;
}
