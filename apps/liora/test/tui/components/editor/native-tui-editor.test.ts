import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindTUIEditorPromptLeak, createTUIEditor } from '#/tui/components/editor/editor-factory';
import { NativeTUIEditor } from '#/tui/components/editor/native-tui-editor';
import type { AutocompleteItem, AutocompleteProvider } from '#/tui/renderer';
import type { TUIEditor } from '#/tui/components/editor/editor-contract';
import { clipboardHasImage } from '#/utils/clipboard/clipboard-has-image';
import { readClipboardText } from '#/utils/clipboard/clipboard-text';

vi.mock('#/utils/clipboard/clipboard-text', () => ({
  readClipboardText: vi.fn(async () => null),
  copyTextToClipboard: vi.fn(async () => {}),
}));

vi.mock('#/utils/clipboard/clipboard-has-image', () => ({
  clipboardHasImage: vi.fn(async () => false),
}));

function makeEditor(): NativeTUIEditor {
  return new NativeTUIEditor();
}

afterEach(() => {
  vi.useRealTimers();
});

async function flushAutocomplete(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function providerReturning(items: AutocompleteItem[]): AutocompleteProvider {
  return {
    getSuggestions: vi.fn(async () => ({ items, prefix: '/' })),
    applyCompletion: vi.fn((lines, cursorLine, cursorCol, item, prefix) => {
      const line = lines[cursorLine] ?? '';
      const beforePrefix = line.slice(0, cursorCol - prefix.length);
      const afterCursor = line.slice(cursorCol);
      const next = `${beforePrefix}/${item.value} ${afterCursor}`;
      return { lines: [next], cursorLine, cursorCol: beforePrefix.length + item.value.length + 2 };
    }),
  };
}

describe('NativeTUIEditor', () => {
  it('satisfies the TUI editor contract without the legacy editor subclass', () => {
    const editor: TUIEditor = makeEditor();

    editor.setText('hello');
    editor.setCursorPosition({ line: 0, col: 2 });

    expect(editor.getText()).toBe('hello');
    expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
    expect(editor.render(12)).toEqual([
      '╭──────────╮',
      '│ > hello  │',
      '╰──────────╯',
    ]);
  });

  it('requests a frame when setCursorPosition moves the caret only', () => {
    // Cursor-only model updates must schedule present; without requestRender the
    // next ambient paint keeps a stale editor row (Windows conpty black lines /
    // vanished prompt glyphs).
    const requestRender = vi.fn();
    const editor = new NativeTUIEditor({ requestRender });
    editor.setText('hello');
    requestRender.mockClear();

    editor.setCursorPosition({ line: 0, col: 3 });

    expect(editor.getCursor()).toEqual({ line: 0, col: 3 });
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('requests a frame when applyNativeTextInputSync moves the caret with unchanged text', () => {
    const requestRender = vi.fn();
    const editor = new NativeTUIEditor({ requestRender });
    editor.setText('hello');
    editor.setCursorPosition({ line: 0, col: 0 });
    requestRender.mockClear();

    editor.applyNativeTextInputSync('hello', { line: 0, col: 4 });

    expect(editor.getText()).toBe('hello');
    expect(editor.getCursor()).toEqual({ line: 0, col: 4 });
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('keeps typed prompt characters on the painted surface after incremental keystrokes', () => {
    // Display-only hole: buffer still had text while a short viewport/content
    // height dropped the input row from the painted frame.
    const editor = makeEditor();
    editor.handleInput('h');
    editor.handleInput('e');
    editor.handleInput('l');
    editor.handleInput('l');
    editor.handleInput('o');
    expect(editor.getText()).toBe('hello');
    const painted = editor.render(16).join('\n');
    expect(painted).toContain('hello');
    expect(painted).toMatch(/> hello/);
  });

  it('edits text and fires change callbacks through native input decoding', () => {
    const editor = makeEditor();
    const changes: string[] = [];
    editor.onChange = (text) => changes.push(text);

    editor.handleInput('a');
    editor.handleInput('b');
    editor.handleInput('\u007F');

    expect(editor.getText()).toBe('a');
    expect(changes).toEqual(['a', 'ab', 'a']);
  });

  it('submits plain Enter, clears text, and keeps local history', async () => {
    vi.useFakeTimers();
    const editor = makeEditor();
    const submit = vi.fn();
    editor.onSubmit = submit;

    editor.setText('first');
    editor.handleInput('\r');
    await vi.runAllTimersAsync();
    editor.handleInput('\u001B[A');

    expect(submit).toHaveBeenCalledWith('first');
    expect(editor.getText()).toBe('first');
  });

  it('enters and exits bash input mode without storing the trigger in text', () => {
    const editor = makeEditor();
    const modes: string[] = [];
    editor.onInputModeChange = (mode) => modes.push(mode);

    editor.handleInput('!');
    expect(editor.inputMode).toBe('bash');
    expect(editor.getText()).toBe('');

    editor.handleInput('echo hi');
    expect(editor.getText()).toBe('echo hi');

    editor.setText('');
    editor.handleInput('\u007F');
    expect(editor.inputMode).toBe('prompt');
    expect(modes).toEqual(['bash', 'prompt']);
  });

  it('routes app-level shortcuts before native text mutation', () => {
    const editor = makeEditor();
    const ctrlC = vi.fn();
    const openExternalEditor = vi.fn();
    editor.onCtrlC = ctrlC;
    editor.onOpenExternalEditor = openExternalEditor;

    editor.handleInput('\u0003');
    editor.handleInput('\u0007');

    expect(ctrlC).toHaveBeenCalledOnce();
    expect(openExternalEditor).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('');
  });

  it('fires the stash toggle on Ctrl-X without mutating text', () => {
    const editor = makeEditor();
    const stashToggle = vi.fn();
    editor.onStashToggle = stashToggle;

    editor.handleInput('\u0018');

    expect(stashToggle).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('');
  });

  it.each(['\u001B[115;5u', '\u0013'])('routes queue/steer shortcuts without changing the draft (%j)', (key) => {
    const editor = makeEditor();
    const steer = vi.fn();
    editor.onCtrlS = steer;
    editor.setText('queued follow-up');

    editor.handleInput(key);

    expect(steer).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('queued follow-up');
  });

  it.each(['\u001B[98;5u', '\u0002'])('routes background shortcuts without changing the draft (%j)', (key) => {
    const editor = makeEditor();
    const background = vi.fn(() => true);
    editor.onCtrlB = background;
    editor.setText('continue working');

    editor.handleInput(key);

    expect(background).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('continue working');
  });

  it('keeps printable CSI-u prompt input distinct from modified shortcuts', () => {
    const editor = makeEditor();
    const steer = vi.fn();
    editor.onCtrlS = steer;

    editor.handleInput('\u001B[115u');
    editor.handleInput('\u001B[112u');

    expect(editor.getText()).toBe('sp');
    expect(steer).not.toHaveBeenCalled();
  });

  it('uses transcript navigation hooks while the prompt is empty', () => {
    const editor = makeEditor();
    const pageUp = vi.fn(() => true);
    editor.onTranscriptPageUp = pageUp;

    editor.handleInput('\u001B[5~');

    expect(pageUp).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('');
  });

  it('renders slash command argument hints through the native editor frame', () => {
    const editor = makeEditor();
    editor.setArgumentHints(new Map([['jobs', '[status]']]));
    editor.setText('/jobs');

    expect(editor.render(24)).toContain('│ > /jobs [status]     │');

    const shellEditor = makeEditor();
    shellEditor.setArgumentHints(new Map([['jobs', '[status]']]));
    shellEditor.handleInput('!');
    shellEditor.setText('/jobs');
    expect(shellEditor.render(24).join('\n')).not.toContain('[status]');
  });

  it('renders the shell mode label on the native editor top border', () => {
    const editor = makeEditor();
    editor.handleInput('!');

    expect(editor.render(30).join('\n')).toContain('! shell mode');
  });

  it('requests, renders, and applies autocomplete suggestions without the legacy editor', async () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const editor = new NativeTUIEditor({ requestRender, autocompleteDebounceMs: 0 });
    const provider = providerReturning([
      { value: 'help', label: 'help', description: 'Show help' },
      { value: 'history', label: 'history', description: 'Show history' },
    ]);
    editor.setAutocompleteProvider(provider);

    editor.handleInput('/');
    await vi.runAllTimersAsync();
    await flushAutocomplete();

    expect(editor.isShowingAutocomplete()).toBe(true);
    expect(requestRender).toHaveBeenCalled();
    expect(editor.render(24).join('\n')).toContain('❯ help');

    editor.handleInput('\u001B[B');
    expect(editor.render(24).join('\n')).toContain('❯ history');

    editor.handleInput('\t');
    expect(editor.getText()).toBe('/history ');
    expect(editor.isShowingAutocomplete()).toBe(false);
  });

  it('reports layout row count from multiline content without string roundtrip', () => {
    const editor = new NativeTUIEditor();
    editor.setText('a\nb\nc');

    expect(editor.getNativeLayoutRowCount(24)).toBe(5);
    expect(editor.render(24)).toHaveLength(5);
  });

  it('skips autocomplete provider work for plain prose keystrokes', async () => {
    vi.useFakeTimers();
    const requestRender = vi.fn();
    const editor = new NativeTUIEditor({ requestRender, autocompleteDebounceMs: 0 });
    const getSuggestions = vi.fn(async () => null);
    editor.setAutocompleteProvider({
      getSuggestions,
      applyCompletion: (lines, cursorLine, cursorCol) => ({
        lines,
        cursorLine,
        cursorCol,
      }),
    });

    editor.handleInput('h');
    editor.handleInput('e');
    editor.handleInput('l');
    editor.handleInput('l');
    editor.handleInput('o');
    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(editor.getText()).toBe('hello');
    expect(getSuggestions).not.toHaveBeenCalled();
    expect(editor.isShowingAutocomplete()).toBe(false);
  });

  it('moves the cursor by soft-wrapped visual rows with ↑/↓ after a layout measure', () => {
    const editor = makeEditor();
    // content width at 24 cols: 24 - 4 - 2 = 18. 40 chars → 3 visual rows
    // (0–18, 18–36, 36–40).
    editor.setText('abcdefghijklmnopqrstuvwxyzabcdefghijklmn');
    // Warm layout width (same path as paint).
    expect(editor.getNativeLayoutRowCount(24)).toBe(5);

    // Start on the second visual row so ↑ has a soft-wrap target.
    editor.setCursorPosition({ line: 0, col: 20 });
    editor.handleInput('\u001B[A'); // CSI A = up
    expect(editor.getCursor().col).toBeLessThan(18);

    const afterUp = editor.getCursor().col;
    editor.handleInput('\u001B[B'); // CSI B = down
    expect(editor.getCursor().col).toBeGreaterThan(afterUp);
  });

  it('grows layout rows for long soft-wrapped single-line prompts', () => {
    const editor = makeEditor();
    // content width at 24 cols: 24 - contentX(4) - rightInset(2) = 18.
    // 40 ASCII chars soft-wrap to 3 visual rows → frame = 2 + 3 = 5.
    editor.setText('abcdefghijklmnopqrstuvwxyzabcdefghijklmn');
    expect(editor.getNativeLayoutRowCount(24)).toBe(5);
    expect(editor.render(24)).toHaveLength(5);

    // Short single-line stays a closed 3-row box.
    editor.setText('hi');
    expect(editor.getNativeLayoutRowCount(24)).toBe(3);
    expect(editor.render(24)).toHaveLength(3);
  });

  it('grows layout rows for hard-newline multiline prompts', () => {
    const editor = makeEditor();
    editor.setText('line one\nline two\nline three');
    // 3 content rows → 2 + 3 = 5 frame rows (top/bottom borders).
    expect(editor.getNativeLayoutRowCount(40)).toBe(5);
    expect(editor.render(40)).toHaveLength(5);
  });

  it('grows layout rows when slash autocomplete opens without changing text', async () => {
    vi.useFakeTimers();
    const editor = new NativeTUIEditor({ autocompleteDebounceMs: 0 });
    const provider = providerReturning([
      { value: 'help', label: 'help', description: 'Show help' },
      { value: 'history', label: 'history', description: 'Show history' },
      { value: 'status', label: 'status', description: 'Show status' },
    ]);
    editor.setAutocompleteProvider(provider);

    // Warm the layout cache on plain text first (empty → still 3 rows).
    expect(editor.getNativeLayoutRowCount(24)).toBe(3);

    editor.handleInput('/');
    // Text is now `/` but suggestions are async; after flush the overlay opens
    // with the same text and must bust the (width, text) layout cache.
    await vi.runAllTimersAsync();
    await flushAutocomplete();

    expect(editor.isShowingAutocomplete()).toBe(true);
    expect(editor.getText()).toBe('/');
    const rows = editor.getNativeLayoutRowCount(24);
    // top + input + 3 suggestions + bottom border
    expect(rows).toBe(6);
    expect(editor.render(24)).toHaveLength(6);
    const rendered = editor.render(24).map((line) => line.replaceAll(/\u001B\[[0-9;]*m/g, ''));
    // Prompt/`/` must remain visible — not only a top border stub.
    expect(rendered.some((line) => line.includes('> /') || line.includes('/'))).toBe(true);
    expect(rendered.join('\n')).toContain('help');
  });
});

describe('NativeTUIEditor history and autocomplete', () => {
  it('keeps browsing history after the first restore (not a one-shot)', () => {
    const editor = makeEditor();
    editor.addToHistory('first');
    editor.addToHistory('second');
    editor.addToHistory('third');

    editor.handleInput('\u001B[A');
    expect(editor.getText()).toBe('third');
    editor.handleInput('\u001B[A');
    expect(editor.getText()).toBe('second');
    editor.handleInput('\u001B[A');
    expect(editor.getText()).toBe('first');
    editor.handleInput('\u001B[B');
    expect(editor.getText()).toBe('second');
    editor.handleInput('\u001B[B');
    expect(editor.getText()).toBe('third');
    editor.handleInput('\u001B[B');
    expect(editor.getText()).toBe('');
  });

  it('lets native ↑/↓ keep browsing history after the first restore', () => {
    const editor = makeEditor();
    editor.addToHistory('alpha');
    editor.addToHistory('beta');
    editor.handleInput('\u001B[A');
    expect(editor.getText()).toBe('beta');

    const handledUp = editor.handleHistoryNavigation?.({
      type: 'key',
      key: 'up',
      raw: '\u001B[A',
      ctrl: false,
      alt: false,
      shift: false,
    });
    expect(handledUp).toBe(true);
    expect(editor.getText()).toBe('alpha');

    const handledDown = editor.handleHistoryNavigation?.({
      type: 'key',
      key: 'down',
      raw: '\u001B[B',
      ctrl: false,
      alt: false,
      shift: false,
    });
    expect(handledDown).toBe(true);
    expect(editor.getText()).toBe('beta');
  });

  it('opens Ctrl-R history search without mutating the prompt', () => {
    const editor = makeEditor();
    const search = vi.fn();
    editor.onHistorySearch = search;

    expect(editor.tryHandleAppShortcut('\u0012')).toBe(true);
    expect(search).toHaveBeenCalledOnce();
    expect(editor.getText()).toBe('');
  });

  it('opens autocomplete with Tab when a slash trigger is present', async () => {
    const provider = providerReturning([
      { value: 'help', label: 'help', description: 'Show help' },
    ]);
    const editor = makeEditor();
    editor.setAutocompleteProvider(provider);
    editor.setText('/');
    editor.setCursorPosition({ line: 0, col: 1 });

    editor.handleInput('\t');
    await flushAutocomplete();

    expect(provider.getSuggestions).toHaveBeenCalled();
    expect(editor.isShowingAutocomplete()).toBe(true);
  });

  it('does not open autocomplete with Tab on plain prose', async () => {
    const provider = providerReturning([
      { value: 'help', label: 'help', description: 'Show help' },
    ]);
    const editor = makeEditor();
    editor.setAutocompleteProvider(provider);
    editor.setText('hello');
    editor.setCursorPosition({ line: 0, col: 5 });

    editor.handleInput('\t');
    await flushAutocomplete();

    expect(provider.getSuggestions).not.toHaveBeenCalled();
    expect(editor.isShowingAutocomplete()).toBe(false);
  });

});

describe('NativeTUIEditor image paste binding', () => {
  const ESC = String.fromCodePoint(0x1b);
  // Windows terminals reserve Ctrl+V for their own paste, so the binding is
  // Alt+V there and Ctrl+V everywhere else (mirrors handleAppShortcut).
  const pasteRaw = process.platform === 'win32' ? `${ESC}v` : String.fromCodePoint(0x16);
  // Shift+Insert: classic terminal paste (CSI u / legacy).
  const shiftInsertRaw = `${ESC}[2;2~`;

  it('invokes onPasteImage and consumes the paste key', async () => {
    const editor = makeEditor();
    editor.setText('draft');
    const onPasteImage = vi.fn(async () => true);
    editor.onPasteImage = onPasteImage;

    expect(editor.tryHandleAppShortcut(pasteRaw)).toBe(true);
    await vi.waitFor(() =>{  expect(onPasteImage).toHaveBeenCalledTimes(1); });
    // Consumed by the image handler: no text mutation.
    expect(editor.getText()).toBe('draft');
  });

  it('invokes onPasteImage for Shift+Insert', async () => {
    const editor = makeEditor();
    editor.setText('draft');
    const onPasteImage = vi.fn(async () => true);
    editor.onPasteImage = onPasteImage;

    expect(editor.tryHandleAppShortcut(shiftInsertRaw)).toBe(true);
    await vi.waitFor(() => {
      expect(onPasteImage).toHaveBeenCalledTimes(1);
    });
    expect(editor.getText()).toBe('draft');
  });

  it('falls back to a clipboard text paste when no image is available', async () => {
    vi.mocked(readClipboardText).mockResolvedValueOnce('from clipboard');
    vi.mocked(clipboardHasImage).mockResolvedValueOnce(false);
    const editor = makeEditor();
    editor.onPasteImage = async () => false;

    expect(editor.tryHandleAppShortcut(pasteRaw)).toBe(true);
    await vi.waitFor(() =>{  expect(editor.getText()).toBe('from clipboard'); });
  });

  it('retries image attach when the first attempt fails but the media probe still sees an image', async () => {
    vi.mocked(clipboardHasImage).mockResolvedValue(true);
    const editor = makeEditor();
    editor.setText('draft');
    const onPasteImage = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    editor.onPasteImage = onPasteImage;

    expect(editor.tryHandleAppShortcut(pasteRaw)).toBe(true);
    await vi.waitFor(() => {
      expect(onPasteImage).toHaveBeenCalledTimes(2);
    });
    // Retry succeeded — no silent no-op, no path-text fallback.
    expect(editor.getText()).toBe('draft');
  });

  it('falls back to clipboard text when image attach keeps failing after retry', async () => {
    vi.mocked(readClipboardText).mockResolvedValueOnce('from clipboard after miss');
    vi.mocked(clipboardHasImage).mockResolvedValue(true);
    const editor = makeEditor();
    // Empty buffer so paste inserts only the clipboard text (not append to draft).
    const onPasteImage = vi.fn(async () => false);
    editor.onPasteImage = onPasteImage;

    expect(editor.tryHandleAppShortcut(pasteRaw)).toBe(true);
    await vi.waitFor(() => {
      expect(editor.getText()).toBe('from clipboard after miss');
    });
    // First attempt + one retry; never swallow paste entirely.
    expect(onPasteImage.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(clipboardHasImage).toHaveBeenCalled();
  });

  it('keeps Hangul inserts at the buffer end', () => {
    const editor = makeEditor();
    editor.setText('안');
    editor.setCursorPosition({ line: 0, col: '안'.length });
    editor.handleInput('녕');

    expect(editor.getText()).toBe('안녕');
    expect(editor.getCursor()).toEqual({ line: 0, col: '안녕'.length });
  });

  it('snaps setCursorPosition out of a mid-cluster column before insert (Hangul NFD)', () => {
    const editor = makeEditor();
    // NFD "한" is multiple code units; a mid-cluster caret must not eat the syllable.
    const hangul = '한'.normalize('NFD');
    editor.setText(hangul);
    expect(hangul.length).toBeGreaterThan(1);
    editor.setCursorPosition({ line: 0, col: 1 });
    // Forward grapheme snap: caret must not stay mid-cluster.
    expect(editor.getCursor().col === 0 || editor.getCursor().col === hangul.length).toBe(true);
    editor.insertTextAtCursor('x');
    expect(editor.getText()).toContain('한'.normalize('NFD')[0]!);
    // Full jamo run survives; insert lands on a boundary.
    expect(editor.getText().includes('x')).toBe(true);
    expect(editor.getText().replace('x', '')).toBe(hangul);
  });

  it('gives onPasteText first claim on bracketed paste (terminal file drops)', () => {
    const editor = makeEditor();
    const onPasteText = vi.fn(() => true);
    editor.onPasteText = onPasteText;

    editor.handleInput(`${ESC}[200~/tmp/dropped.png${ESC}[201~`);

    expect(onPasteText).toHaveBeenCalledWith('/tmp/dropped.png');
    expect(editor.getText()).toBe('');
  });

  it('inserts pasted text normally when onPasteText declines', () => {
    const editor = makeEditor();
    editor.onPasteText = () => false;

    editor.handleInput(`${ESC}[200~hello world${ESC}[201~`);

    expect(editor.getText()).toBe('hello world');
  });

  it('rejects compileUnsafe / dist-native / stack blobs and keeps a draft', () => {
    const statuses: string[] = [];
    const editor = new NativeTUIEditor({
      onPromptLeak: (message) => statuses.push(message),
      leakBlockedMessage: 'Diagnostic output was kept out of the prompt',
    });
    editor.setText('keep this draft');

    editor.setText('Error: compileUnsafe boom\n    at Module._load (node:internal/modules/cjs/loader:1:1)');
    expect(editor.getText()).toBe('keep this draft');

    editor.setText('see dist-native/intermediates/main.cjs for the dump');
    expect(editor.getText()).toBe('keep this draft');

    editor.setText('Error: boom\n    at foo (app.ts:1:1)\n    at bar (app.ts:2:2)');
    expect(editor.getText()).toBe('keep this draft');
    expect(statuses).toHaveLength(3);
    expect(statuses[0]).toContain('Diagnostic output');

    editor.setText('please restore this draft');
    expect(editor.getText()).toBe('please restore this draft');
  });

  it('rejects compileUnsafe via applyNativeTextInputSync, paste, and late-bound showStatus', () => {
    const leak = [
      'Error: compileUnsafe boom',
      '    at Module._load (node:internal/modules/cjs/loader:1:1)',
    ].join('\n');
    const esc = String.fromCodePoint(0x1b);
    const statuses: string[] = [];
    const editor = createTUIEditor({ requestRender: () => {} } as never);
    editor.setText('keep this draft');

    editor.applyNativeTextInputSync?.(leak, { line: 0, col: leak.length });
    expect(editor.getText()).toBe('keep this draft');
    expect(statuses).toHaveLength(0);

    bindTUIEditorPromptLeak(editor, (message) => statuses.push(message));
    editor.applyNativeTextInputSync?.(leak, { line: 0, col: leak.length });
    expect(editor.getText()).toBe('keep this draft');
    expect(statuses).toHaveLength(1);

    editor.handleInput(`${esc}[200~${leak}${esc}[201~`);
    expect(editor.getText()).toBe('keep this draft');
    expect(statuses).toHaveLength(2);
  });
});
