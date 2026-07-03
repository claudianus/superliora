import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOUBLE_ESC_WINDOW_MS } from '#/tui/constant/kimi-tui';
import {
  EditorKeyboardController,
  nextShiftTabModeTarget,
  type EditorKeyboardHost,
} from '#/tui/controllers/editor-keyboard';
import type { ImageAttachmentStore } from '#/tui/utils/image-attachment-store';

interface Harness {
  readonly host: EditorKeyboardHost;
  readonly editor: Record<string, ((...args: never[]) => unknown) | undefined>;
  readonly openUndoSelector: ReturnType<typeof vi.fn>;
  readonly cancelRunningShellCommand: ReturnType<typeof vi.fn>;
  readonly handlePlanToggle: ReturnType<typeof vi.fn>;
  readonly handleUltraworkModeToggle: ReturnType<typeof vi.fn>;
  readonly scrollTranscriptViewport: ReturnType<typeof vi.fn>;
}

function createHarness(
  options: {
    streamingPhase?: string;
    isCompacting?: boolean;
    planMode?: boolean;
    ultraworkMode?: boolean;
  } = {},
): Harness {
  const editor: Record<string, ((...args: never[]) => unknown) | undefined> = {};
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
        planMode: options.planMode ?? false,
        ultraworkMode: options.ultraworkMode ?? false,
      },
      footer: { setTransientHint: vi.fn() },
      ui: { requestRender: vi.fn() },
    },
    session,
    track: vi.fn(),
    handlePlanToggle,
    handleUltraworkModeToggle,
    scrollTranscriptViewport,
    btwPanelController: { closeOrCancel: vi.fn(() => false) },
    openUndoSelector,
    cancelRunningShellCommand,
  } as unknown as EditorKeyboardHost;

  const controller = new EditorKeyboardController(
    host,
    undefined as unknown as ImageAttachmentStore,
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
  };
}

function pressEscape(editor: Harness['editor']): void {
  const handler = editor['onEscape'];
  if (handler === undefined) throw new Error('onEscape handler not installed');
  (handler as () => void)();
}

function pressNonEscape(editor: Harness['editor']): void {
  const handler = editor['onNonEscapeInput'];
  if (handler === undefined) throw new Error('onNonEscapeInput handler not installed');
  (handler as () => void)();
}

function pressShiftTab(editor: Harness['editor']): void {
  const handler = editor['onShiftTab'];
  if (handler === undefined) throw new Error('onShiftTab handler not installed');
  (handler as () => void)();
}

function pressTranscriptPageUp(editor: Harness['editor']): void {
  const handler = editor['onTranscriptPageUp'];
  if (handler === undefined) throw new Error('onTranscriptPageUp handler not installed');
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
