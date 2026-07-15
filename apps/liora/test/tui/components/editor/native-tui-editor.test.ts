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
});
