import { afterEach, describe, expect, it, vi } from 'vitest';

import { NativeTUIEditor } from '#/tui/components/editor/native-tui-editor';
import type { AutocompleteItem, AutocompleteProvider } from '#/tui/renderer';
import type { TUIEditor } from '#/tui/components/editor/editor-contract';

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
    editor.setArgumentHints(new Map([['goal', '[status]']]));
    editor.setText('/goal');

    expect(editor.render(24)).toContain('│ > /goal [status]     │');

    const shellEditor = makeEditor();
    shellEditor.setArgumentHints(new Map([['goal', '[status]']]));
    shellEditor.handleInput('!');
    shellEditor.setText('/goal');
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
    editor.handleInput('\u001b[A'); // CSI A = up
    expect(editor.getCursor().col).toBeLessThan(18);

    const afterUp = editor.getCursor().col;
    editor.handleInput('\u001b[B'); // CSI B = down
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

// ---------------------------------------------------------------------------
// Ghost text (prompt intelligence)
// ---------------------------------------------------------------------------

describe('NativeTUIEditor ghost text', () => {
  it('sets and gets ghost text', () => {
    const editor = makeEditor();
    expect(editor.getGhostText()).toBeUndefined();

    editor.setGhostText('hello world', 'inline');
    expect(editor.getGhostText()).toBe('hello world');

    editor.setGhostText(undefined, 'inline');
    expect(editor.getGhostText()).toBeUndefined();
  });

  it('renders ghost text in the editor frame', () => {
    const editor = makeEditor();
    editor.setText('hello');
    editor.setCursorPosition({ line: 0, col: 5 });
    editor.setGhostText(' world', 'inline');

    const rendered = editor.render(30).map((line) => line.replaceAll(/\u001B\[[0-9;]*m/g, ''));
    expect(rendered.join('\n')).toContain('hello world');
  });

  it('accepts inline ghost text with Tab (inserts at cursor)', () => {
    const editor = makeEditor();
    const acceptGhost = vi.fn();
    editor.onAcceptGhost = acceptGhost;
    editor.setText('hello');
    editor.setCursorPosition({ line: 0, col: 5 });
    editor.setGhostText(' world', 'inline');

    editor.handleInput('\t');

    expect(editor.getText()).toBe('hello world');
    expect(editor.getGhostText()).toBeUndefined();
    expect(acceptGhost).toHaveBeenCalledOnce();
  });

  it('accepts suggestion ghost text with Tab (fills editor)', () => {
    const editor = makeEditor();
    const acceptGhost = vi.fn();
    editor.onAcceptGhost = acceptGhost;
    editor.setGhostText('fix the bug', 'suggestion');

    editor.handleInput('\t');

    expect(editor.getText()).toBe('fix the bug');
    expect(editor.getGhostText()).toBeUndefined();
    expect(acceptGhost).toHaveBeenCalledOnce();
  });

  it('does not accept ghost when autocomplete menu is open', async () => {
    vi.useFakeTimers();
    const editor = new NativeTUIEditor({ autocompleteDebounceMs: 0 });
    const provider = providerReturning([
      { value: 'help', label: 'help', description: 'Show help' },
    ]);
    editor.setAutocompleteProvider(provider);
    editor.setGhostText(' world', 'inline');

    editor.handleInput('/');
    await vi.runAllTimersAsync();
    await flushAutocomplete();
    expect(editor.isShowingAutocomplete()).toBe(true);

    // Tab should be consumed by autocomplete, not ghost
    editor.handleInput('\t');
    expect(editor.getText()).toBe('/help ');
  });

  it('cycles suggestions with ↑/↓ when editor is empty and ghostKind is suggestion', () => {
    const editor = makeEditor();
    const cycleGhost = vi.fn();
    editor.onCycleGhost = cycleGhost;
    editor.setGhostText('suggestion one', 'suggestion');

    editor.handleInput('\u001B[A'); // up
    expect(cycleGhost).toHaveBeenCalledWith(-1);

    editor.handleInput('\u001B[B'); // down
    expect(cycleGhost).toHaveBeenCalledWith(1);
  });

  it('does not cycle suggestions when ghostKind is inline', () => {
    const editor = makeEditor();
    const cycleGhost = vi.fn();
    editor.onCycleGhost = cycleGhost;
    editor.setGhostText('inline completion', 'inline');

    // ↑ with empty text + inline ghost should NOT cycle
    editor.handleInput('\u001B[A');
    expect(cycleGhost).not.toHaveBeenCalled();
  });

  it('closes ghost text with Esc', () => {
    const editor = makeEditor();
    editor.setGhostText('hello world', 'inline');
    expect(editor.getGhostText()).toBe('hello world');

    editor.handleInput('\u001B'); // escape

    expect(editor.getGhostText()).toBeUndefined();
  });

  it('clears ghost text when text changes', () => {
    const editor = makeEditor();
    editor.setText('hello');
    editor.setGhostText(' world', 'inline');
    expect(editor.getGhostText()).toBe(' world');

    editor.handleInput('x');

    expect(editor.getGhostText()).toBeUndefined();
  });

  it('clears ghost text when cursor moves via setCursorPosition', () => {
    const editor = makeEditor();
    editor.setText('hello');
    editor.setCursorPosition({ line: 0, col: 5 });
    editor.setGhostText(' world', 'inline');
    expect(editor.getGhostText()).toBe(' world');

    editor.setCursorPosition({ line: 0, col: 2 });

    expect(editor.getGhostText()).toBeUndefined();
  });

  it('clears ghost text on submit', async () => {
    vi.useFakeTimers();
    const editor = makeEditor();
    editor.onSubmit = vi.fn();
    editor.setText('hello');
    editor.setGhostText(' world', 'inline');

    editor.handleInput('\r');
    await vi.runAllTimersAsync();

    expect(editor.getGhostText()).toBeUndefined();
  });

  it('invalidates layout cache when ghost changes', () => {
    const editor = makeEditor();
    editor.setText('hi');
    const rowsWithoutGhost = editor.getNativeLayoutRowCount(24);

    editor.setGhostText(' this is a longer ghost text that might wrap', 'inline');
    const rowsWithGhost = editor.getNativeLayoutRowCount(24);

    // Ghost text may increase row count if it causes wrapping
    expect(rowsWithGhost).toBeGreaterThanOrEqual(rowsWithoutGhost);
  });
});
