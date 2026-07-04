import {
  Container,
  createTerminalRenderer,
  measureRendererRegions,
  type RendererRootUI,
  type RendererTerminalHost,
  type TerminalRenderer,
} from '#/tui/renderer';

import { FooterComponent } from './components/chrome/footer';
import { GutterContainer } from './components/chrome/gutter-container';
import type { MoonLoader, SpinnerStyle } from './components/chrome/moon-loader';
import { TodoPanelComponent } from './components/chrome/todo-panel';
import type { SessionRow } from './components/dialogs/session-picker';
import type { TUIEditor } from './components/editor/editor-contract';
import { createTUIEditor } from './components/editor/editor-factory';
import { TranscriptViewportComponent } from './components/messages/transcript-viewport';
import { CHROME_GUTTER } from './constant/rendering';
import type { TasksBrowserState } from './controllers/tasks-browser';
import { currentTheme, type Theme } from './theme';
import { NativeEditorTextInputController } from './utils/native-editor-text-input';
import { createTerminalState, type TerminalState } from './utils/terminal-state';
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
  transcriptContainer: TranscriptViewportComponent;
  activityContainer: Container;
  todoPanelContainer: Container;
  todoPanel: TodoPanelComponent;
  queueContainer: Container;
  btwPanelContainer: Container;
  editorContainer: Container;
  footerContainer: Container;
  footer: FooterComponent;
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
  activeDialog: 'session-picker' | 'help' | null;
  tasksBrowser: TasksBrowserState | undefined;
  externalEditorRunning: boolean;
  queuedMessages: QueuedMessage[];
  swarmModeEntry: 'manual' | 'task' | undefined;
}

export function createTUIState(options: LioraTUIOptions): TUIState {
  const initialAppState = options.initialAppState;
  const theme = currentTheme;

  const renderer = options.renderer ?? createTerminalRenderer();
  const { terminal, ui } = renderer;

  const transcriptViewport = createTranscriptViewportState();
  renderer.setAutoFrameHold(() => !transcriptViewport.followOutput);
  const activityContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const todoPanelContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const todoPanel = new TodoPanelComponent();
  const queueContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const btwPanelContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const editorContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const footerContainer = new GutterContainer(CHROME_GUTTER, CHROME_GUTTER);
  const transcriptContainer = new TranscriptViewportComponent(
    CHROME_GUTTER,
    CHROME_GUTTER,
    transcriptViewport,
    (width) =>
      measureRendererRegions({
        terminalRows: terminal.rows,
        heights: {
          activity: measureContainerRows(activityContainer, width),
          todo: measureContainerRows(todoPanelContainer, width),
          queue: measureContainerRows(queueContainer, width),
          btw: measureContainerRows(btwPanelContainer, width),
          editor: measureContainerRows(editorContainer, width),
          footer: measureContainerRows(footerContainer, width),
        },
      }).transcriptRows,
  );
  const editor = createTUIEditor(ui);
  const nativeEditorTextInput = new NativeEditorTextInputController();
  const footer = new FooterComponent(
    { ...initialAppState },
    () => {
      renderer.requestRender();
    },
    () => transcriptViewport.snapshot(),
  );

  return {
    renderer,
    ui,
    terminal,
    transcriptViewport,
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
