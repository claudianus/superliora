import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DOUBLE_ESC_WINDOW_MS } from '#/tui/constant/liora-tui';
import {
  EditorKeyboardController,
  nextShiftTabModeTarget,
  type EditorKeyboardHost,
} from '#/tui/controllers/shell/editor-keyboard';
import { ImageAttachmentStore } from '#/tui/utils/image/image-attachment-store';

interface Harness {
  readonly host: EditorKeyboardHost;
  readonly editor: Record<string, unknown>;
  readonly openUndoSelector: ReturnType<typeof vi.fn>;
  readonly cancelRunningShellCommand: ReturnType<typeof vi.fn>;
  readonly handlePlanToggle: ReturnType<typeof vi.fn>;
  readonly handleUltraworkModeToggle: ReturnType<typeof vi.fn>;
  readonly scrollTranscriptViewport: ReturnType<typeof vi.fn>;
  readonly toastShow: ReturnType<typeof vi.fn>;
  readonly showCommandPalette: ReturnType<typeof vi.fn>;
  readonly showHistorySearch: ReturnType<typeof vi.fn>;
}

function createHarness(
  options: {
    streamingPhase?: string;
    isCompacting?: boolean;
    planMode?: boolean;
    ultraworkMode?: boolean;
    editorText?: string;
    imageStore?: ImageAttachmentStore;
  } = {},
): Harness {
  let editorText = options.editorText ?? '';
  const toastShow = vi.fn();
  const showCommandPalette = vi.fn();
  const showHistorySearch = vi.fn();
  const editor: Record<string, unknown> = {
    getText: () => editorText,
    setText: (text: string) => {
      editorText = text;
    },
    insertTextAtCursor: vi.fn(),
    inputMode: 'prompt',
  };
  const openUndoSelector = vi.fn();
  const cancelRunningShellCommand = vi.fn();
  const handlePlanToggle = vi.fn();
  const handleUltraworkModeToggle = vi.fn();
  const scrollTranscriptViewport = vi.fn(() => true);
  const session = { cancel: vi.fn(async () => {}) };

  const host = {
    state: {
      editor,
      activeDialog: null,
      appState: {
        streamingPhase: options.streamingPhase ?? 'idle',
        isCompacting: options.isCompacting ?? false,
        isBackgroundCompacting: false,
        planMode: options.planMode ?? false,
        ultraworkMode: options.ultraworkMode ?? false,
        model: 'test-model',
      },
      footer: { setTransientHint: vi.fn() },
      ui: { requestRender: vi.fn() },
      toast: { show: toastShow },
      queuedMessages: [],
    },
    session,
    track: vi.fn(),
    handlePlanToggle,
    handleUltraworkModeToggle,
    scrollTranscriptViewport,
    btwPanelController: { closeOrCancel: vi.fn(() => false), scroll: vi.fn(() => false) },
    openUndoSelector,
    cancelRunningShellCommand,
    showCommandPalette,
    showHistorySearch,
    showError: vi.fn(),
    updateQueueDisplay: vi.fn(),
    steerMessage: vi.fn(),
    detachCurrentForegroundTask: vi.fn(),
  } as unknown as EditorKeyboardHost;

  const controller = new EditorKeyboardController(
    host,
    options.imageStore ?? (undefined as unknown as ImageAttachmentStore),
  );
  controller.install();

  return {
    host,
    editor,
    openUndoSelector,
    cancelRunningShellCommand,
    handlePlanToggle,
    handleUltraworkModeToggle,
    scrollTranscriptViewport,
    toastShow,
    showCommandPalette,
    showHistorySearch,
  };
}

function pressEscape(editor: Harness['editor']): void {
  const handler = editor['onEscape'];
  if (typeof handler !== 'function') throw new Error('onEscape handler not installed');
  (handler as () => void)();
}

function pressNonEscape(editor: Harness['editor']): void {
  const handler = editor['onNonEscapeInput'];
  if (typeof handler !== 'function') throw new Error('onNonEscapeInput handler not installed');
  (handler as () => void)();
}

function pressShiftTab(editor: Harness['editor']): void {
  const handler = editor['onShiftTab'];
  if (typeof handler !== 'function') throw new Error('onShiftTab handler not installed');
  (handler as () => void)();
}

function pressTranscriptPageUp(editor: Harness['editor']): void {
  const handler = editor['onTranscriptPageUp'];
  if (typeof handler !== 'function') throw new Error('onTranscriptPageUp handler not installed');
  (handler as () => void)();
}

describe('EditorKeyboardController Ultrawork toggle', () => {
  it('keeps Shift-Tab focused on the primary off and Ultrawork states', () => {
    expect(nextShiftTabModeTarget({ ultraworkMode: false })).toBe('ultrawork');
    expect(nextShiftTabModeTarget({ ultraworkMode: true })).toBe('off');
  });

  it('turns off all planning modes after Ultrawork', () => {
    const { editor, handlePlanToggle, handleUltraworkModeToggle } = createHarness({
      planMode: true,
      ultraworkMode: true,
    });

    pressShiftTab(editor);

    expect(handleUltraworkModeToggle).toHaveBeenCalledWith(false);
    expect(handlePlanToggle).not.toHaveBeenCalled();
  });

  it('enters Ultrawork directly from the off state', () => {
    const { editor, handlePlanToggle, handleUltraworkModeToggle } = createHarness({
      planMode: false,
      ultraworkMode: false,
    });

    pressShiftTab(editor);

    expect(handleUltraworkModeToggle).toHaveBeenCalledWith(true);
    expect(handlePlanToggle).not.toHaveBeenCalled();
  });
});

describe('EditorKeyboardController transcript viewport shortcuts', () => {
  it('routes editor PageUp to the transcript viewport', () => {
    const { editor, scrollTranscriptViewport } = createHarness();

    pressTranscriptPageUp(editor);

    expect(scrollTranscriptViewport).toHaveBeenCalledWith('page-up');
  });
});

describe('EditorKeyboardController double-Esc undo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the undo selector when Esc is pressed twice within the window while idle', () => {
    const { editor, openUndoSelector } = createHarness();

    pressEscape(editor);
    expect(openUndoSelector).not.toHaveBeenCalled();

    pressEscape(editor);
    expect(openUndoSelector).toHaveBeenCalledOnce();
  });

  it('does nothing for a single Esc while idle', () => {
    const { editor, openUndoSelector } = createHarness();

    pressEscape(editor);

    expect(openUndoSelector).not.toHaveBeenCalled();
  });

  it('does not trigger when the second Esc arrives after the window expires', () => {
    const { editor, openUndoSelector } = createHarness();

    pressEscape(editor);
    vi.advanceTimersByTime(DOUBLE_ESC_WINDOW_MS + 1);
    pressEscape(editor);

    expect(openUndoSelector).not.toHaveBeenCalled();
  });

  it('does not trigger when another key is pressed between the two Esc presses', () => {
    const { editor, openUndoSelector } = createHarness();

    pressEscape(editor);
    pressNonEscape(editor);
    pressEscape(editor);

    expect(openUndoSelector).not.toHaveBeenCalled();
  });

  it('does not trigger undo while streaming; Esc cancels the stream instead', () => {
    const { editor, host, openUndoSelector, cancelRunningShellCommand } = createHarness({
      streamingPhase: 'waiting',
    });

    pressEscape(editor);
    pressEscape(editor);

    expect(openUndoSelector).not.toHaveBeenCalled();
    expect(cancelRunningShellCommand).toHaveBeenCalled();
    const session = host.session as unknown as { cancel: ReturnType<typeof vi.fn> };
    expect(session.cancel).toHaveBeenCalled();
  });
});

describe('EditorKeyboardController gated shortcut toasts', () => {
  it('toasts instead of opening Hub while streaming', () => {
    const { editor, toastShow, showCommandPalette } = createHarness({
      streamingPhase: 'waiting',
    });

    const handler = editor['onCommandPalette'];
    if (typeof handler !== 'function') throw new Error('onCommandPalette not installed');
    (handler as () => void)();

    expect(showCommandPalette).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(
      'Wait for the turn to finish, or Ctrl-C to stop',
      2200,
    );
  });

  it('toasts when Ctrl-R is pressed with a non-empty prompt', () => {
    const { editor, toastShow, showHistorySearch } = createHarness({
      editorText: 'draft',
    });

    const handler = editor['onHistorySearch'];
    if (typeof handler !== 'function') throw new Error('onHistorySearch not installed');
    (handler as () => void)();

    expect(showHistorySearch).not.toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(
      'Clear the prompt first (Ctrl-R searches history)',
      2200,
    );
  });

  it('toasts when Ctrl-S is pressed while idle', () => {
    const { editor, toastShow } = createHarness({ streamingPhase: 'idle' });

    const handler = editor['onCtrlS'];
    if (typeof handler !== 'function') throw new Error('onCtrlS not installed');
    (handler as () => void)();

    expect(toastShow).toHaveBeenCalledWith('Steer works while a turn is running', 2200);
  });

  it('toasts when Ctrl-B is pressed while idle', () => {
    const { editor, toastShow } = createHarness({ streamingPhase: 'idle' });

    const handler = editor['onCtrlB'];
    if (typeof handler !== 'function') throw new Error('onCtrlB not installed');
    (handler as () => boolean)();

    expect(toastShow).toHaveBeenCalledWith('Background works while a turn is running', 2200);
  });
});

describe('EditorKeyboardController dropped media paste', () => {
  // 1x1 transparent PNG.
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  let dir: string;
  let pngPath: string;
  let videoPath: string;
  let textPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'editor-drop-'));
    pngPath = join(dir, 'shot.png');
    videoPath = join(dir, 'clip.mp4');
    textPath = join(dir, 'notes.txt');
    writeFileSync(pngPath, Buffer.from(PNG_BASE64, 'base64'));
    writeFileSync(videoPath, 'not really mp4 bytes');
    writeFileSync(textPath, 'hello');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function createDropHarness(): {
    store: ImageAttachmentStore;
    harness: Harness;
    paste: (text: string) => boolean;
    insertTextAtCursor: ReturnType<typeof vi.fn>;
  } {
    const store = new ImageAttachmentStore();
    const harness = createHarness({ imageStore: store });
    const state = harness.host.state as unknown as Record<string, unknown>;
    state['transcriptContainer'] = { isBatchMounting: false };
    state['renderer'] = { invalidateFrame: vi.fn() };
    const onPasteText = harness.editor['onPasteText'];
    if (typeof onPasteText !== 'function') throw new Error('onPasteText not installed');
    return {
      store,
      harness,
      paste: onPasteText as (text: string) => boolean,
      insertTextAtCursor: harness.editor['insertTextAtCursor'] as ReturnType<typeof vi.fn>,
    };
  }

  it('attaches a dropped image and inserts its placeholder', () => {
    const { store, paste, insertTextAtCursor } = createDropHarness();

    expect(paste(`${pngPath}\n`)).toBe(true);

    expect(store.size()).toBe(1);
    expect(insertTextAtCursor).toHaveBeenCalledWith('[image #1 (1×1)] ');
  });

  it('attaches a dropped video file', () => {
    const { store, paste, insertTextAtCursor } = createDropHarness();

    expect(paste(videoPath)).toBe(true);

    expect(store.size()).toBe(1);
    expect(insertTextAtCursor).toHaveBeenCalledWith('[video #1 clip.mp4] ');
  });

  it('keeps non-media paths next to media placeholders in a mixed drop', () => {
    const { paste, insertTextAtCursor } = createDropHarness();

    expect(paste(`${pngPath}\n${textPath}`)).toBe(true);

    expect(insertTextAtCursor).toHaveBeenCalledWith(`[image #1 (1×1)] ${textPath} `);
  });

  it('declines non-media drops so the paste stays plain text', () => {
    const { store, paste, insertTextAtCursor } = createDropHarness();

    expect(paste(textPath)).toBe(false);

    expect(store.size()).toBe(0);
    expect(insertTextAtCursor).not.toHaveBeenCalled();
  });

  it('declines ordinary pasted prose', () => {
    const { paste, insertTextAtCursor } = createDropHarness();

    expect(paste('please review the screenshot')).toBe(false);
    expect(insertTextAtCursor).not.toHaveBeenCalled();
  });
});
