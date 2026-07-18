import { describe, expect, it } from 'vitest';

import {
  RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
  RendererEditorTextInputController,
  RendererTextInput,
  createRendererEditorTextInput,
  handleRendererCommandPrefixTextInput,
  handleRendererEditorCursorKeyInput,
  handleRendererEditorMouseInput,
  handleRendererEditorTextMutationInput,
  isRendererEditorTextMutation,
  rendererEditorContentHeight,
  rendererEditorContentWidth,
  syncRendererEditorTextInputToTarget,
  type NativeInputEvent,
  type NativeInputKeyEvent,
  type RendererEditorCursor,
} from '../src';

describe('RendererTextInput', () => {
  it('edits multiline text from structured key and paste events', () => {
    const input = new RendererTextInput();

    input.handleInput(key('character', { text: 'h' }));
    input.handleInput(key('character', { text: 'i' }));
    input.handleInput(key('enter'));
    input.handleInput({ type: 'paste', raw: '\u001B[200~한🙂\u001B[201~', text: '한🙂' });

    expect(input.getLines()).toEqual(['hi', '한🙂']);
    expect(input.getCursor()).toEqual({ line: 1, column: '한🙂'.length });
  });

  it('moves and deletes by grapheme clusters instead of UTF-16 code units', () => {
    const input = new RendererTextInput({ text: 'a🙂b' });

    input.handleInput(key('left'));
    input.handleInput(key('backspace'));

    expect(input.getText()).toBe('ab');
    expect(input.getCursor()).toEqual({ line: 0, column: 1 });
  });

  it('renders styled cell lines and real cursor state without fake inverse text', () => {
    const input = new RendererTextInput({
      text: 'hello',
      style: { fg: '#ffffff' },
      cursorBlinking: false,
    });
    input.setCursor({ line: 0, column: 2 });

    const frame = input.render({ width: 10 });

    expect(frame.lines).toHaveLength(1);
    expect(frame.lines[0]).toEqual([
      { char: 'h', style: { fg: '#ffffff' } },
      { char: 'e', style: { fg: '#ffffff' } },
      { char: 'l', style: { fg: '#ffffff' } },
      { char: 'l', style: { fg: '#ffffff' } },
      { char: 'o', style: { fg: '#ffffff' } },
    ]);
    expect(frame.cursor).toEqual({
      x: 2,
      y: 0,
      visible: true,
      shape: 'bar',
      blinking: false,
    });
  });

  it('soft-wraps rendered rows and keeps the cursor visible inside a bounded viewport', () => {
    const input = new RendererTextInput({ text: 'abcdef' });

    const frame = input.render({ width: 2, height: 2 });

    expect(frame.lines.map(lineText)).toEqual(['cd', 'ef']);
    expect(frame.contentRows).toBe(3);
    expect(frame.viewportRow).toBe(1);
    expect(frame.cursor).toMatchObject({ x: 2, y: 1, visible: true });
  });

  it('moves vertically by wrapped visual rows when a layout width is known', () => {
    const input = new RendererTextInput({ text: 'abcdef' });
    input.setCursor({ line: 0, column: 3 });

    input.render({ width: 2 });
    input.handleInput(key('up'));
    expect(input.getCursor()).toEqual({ line: 0, column: 1 });

    input.handleInput(key('down'));
    expect(input.getCursor()).toEqual({ line: 0, column: 3 });
  });

  it('can use an explicit layout width for visual-row cursor navigation before render', () => {
    const input = new RendererTextInput({ text: 'abcdef\nghij' });
    input.setLayoutWidth(2);
    input.setCursor({ line: 0, column: 5 });

    input.handleInput(key('down'));

    expect(input.getCursor()).toEqual({ line: 1, column: 1 });
  });

  it('keeps a sticky display column while walking soft-wrapped visual rows', () => {
    // width 4 → "abcdefghij" wraps as abcd | efgh | ij
    const input = new RendererTextInput({ text: 'abcdefghij' });
    input.setLayoutWidth(4);
    input.setCursor({ line: 0, column: 2 }); // on 'c' (display col 2)

    input.handleInput(key('down'));
    expect(input.getCursor()).toEqual({ line: 0, column: 6 }); // 'g'
    input.handleInput(key('down'));
    expect(input.getCursor()).toEqual({ line: 0, column: 10 }); // end after 'j' (clamped)
    input.handleInput(key('up'));
    expect(input.getCursor()).toEqual({ line: 0, column: 6 });
  });

  it('jumps by blank-line paragraphs with Alt/Ctrl+↑/↓', () => {
    const input = new RendererTextInput({
      text: 'alpha\nbeta\n\ngamma\ndelta\n\nepsilon',
    });

    // Mid-paragraph: Alt+Up → start of current paragraph.
    input.setCursor({ line: 4, column: 2 }); // "delta"
    input.handleInput(key('up', { alt: true }));
    expect(input.getCursor().line).toBe(3); // "gamma" (paragraph start)

    // Already at paragraph start: Alt+Up → previous paragraph.
    input.handleInput(key('up', { alt: true }));
    expect(input.getCursor().line).toBe(0); // "alpha"

    // Ctrl+Down from document start → next paragraph.
    input.setCursor({ line: 0, column: 0 });
    input.handleInput(key('down', { ctrl: true }));
    expect(input.getCursor().line).toBe(3); // "gamma"

    input.handleInput(key('down', { alt: true }));
    expect(input.getCursor().line).toBe(6); // "epsilon"
  });

  it('extends and renders keyboard selections with a caller-owned style', () => {
    const input = new RendererTextInput({
      text: 'abcd',
      selectionStyle: { fg: '#ffffff', bg: '#214d77' },
    });
    input.setCursor({ line: 0, column: 0 });

    input.handleInput(key('right', { shift: true }));
    input.handleInput(key('right', { shift: true }));

    expect(input.getSelection()).toEqual({ anchor: 0, head: 2 });
    expect(input.getSelectionRange()).toEqual({ start: 0, end: 2 });
    expect(input.getSelectedText()).toBe('ab');
    expect(cellStyles(input.render({ width: 8 }).lines[0])).toEqual([
      { fg: '#ffffff', bg: '#214d77' },
      { fg: '#ffffff', bg: '#214d77' },
      undefined,
      undefined,
    ]);
  });

  it('replaces selected text on insert and clears the selection', () => {
    const input = new RendererTextInput({ text: 'abcde' });

    input.setSelection({ anchor: 1, head: 4 });
    input.handleInput(key('character', { text: 'X' }));

    expect(input.getText()).toBe('aXe');
    expect(input.getCursor()).toEqual({ line: 0, column: 2 });
    expect(input.getSelection()).toBeUndefined();
  });

  it('deletes multiline selections as one edit range', () => {
    const input = new RendererTextInput({ text: 'hello\nworld' });

    input.setSelection({ anchor: 3, head: 8 });
    input.handleInput(key('backspace'));

    expect(input.getText()).toBe('helrld');
    expect(input.getCursor()).toEqual({ line: 0, column: 3 });
    expect(input.getSelection()).toBeUndefined();
  });

  it('undoes and redoes edits through public APIs and control shortcuts', () => {
    const input = new RendererTextInput();

    input.handleInput(key('character', { text: 'a' }));
    input.handleInput(key('character', { text: 'b' }));
    expect(input.canUndo()).toBe(true);

    expect(input.undo()).toBe(true);
    expect(input.getText()).toBe('a');
    expect(input.canRedo()).toBe(true);

    expect(input.handleInput(key('character', { text: 'y', ctrl: true }))).toBe(true);
    expect(input.getText()).toBe('ab');
    expect(input.canRedo()).toBe(false);
  });

  it('restores atomic ranges and selection state across undo and redo', () => {
    const input = new RendererTextInput({
      text: 'a[paste]b',
      atomicRanges: [{ start: 1, end: 8, id: 'paste' }],
    });

    input.setSelection({ anchor: 1, head: 8 });
    input.handleInput(key('character', { text: 'X' }));
    expect(input.getText()).toBe('aXb');
    expect(input.getAtomicRanges()).toEqual([]);

    input.handleInput(key('character', { text: 'z', ctrl: true }));
    expect(input.getText()).toBe('a[paste]b');
    expect(input.getSelection()).toEqual({ anchor: 1, head: 8 });
    expect(input.getAtomicRanges()).toEqual([{ start: 1, end: 8, id: 'paste' }]);

    input.handleInput(key('character', { text: 'z', ctrl: true, shift: true }));
    expect(input.getText()).toBe('aXb');
    expect(input.getSelection()).toBeUndefined();
    expect(input.getAtomicRanges()).toEqual([]);
  });

  it('clears redo history after a new edit and respects the history limit', () => {
    const input = new RendererTextInput({ historyLimit: 1 });

    input.handleInput(key('character', { text: 'a' }));
    input.handleInput(key('character', { text: 'b' }));
    expect(input.undo()).toBe(true);
    expect(input.getText()).toBe('a');

    input.handleInput(key('character', { text: 'c' }));
    expect(input.getText()).toBe('ac');
    expect(input.canRedo()).toBe(false);

    expect(input.undo()).toBe(true);
    expect(input.getText()).toBe('a');
    expect(input.undo()).toBe(false);
  });

  it('moves by words from modified arrow and alt character keys', () => {
    const input = new RendererTextInput({ text: 'run npm test now' });

    input.handleInput(key('left', { ctrl: true }));
    expect(input.getCursor()).toEqual({ line: 0, column: 13 });

    input.handleInput(key('character', { text: 'b', alt: true }));
    expect(input.getCursor()).toEqual({ line: 0, column: 8 });

    input.handleInput(key('right', { ctrl: true, shift: true }));
    expect(input.getSelection()).toEqual({ anchor: 8, head: 12 });
  });

  it('moves to document boundaries with modified home and end keys', () => {
    const input = new RendererTextInput({ text: 'abc\ndef' });

    input.handleInput(key('home', { ctrl: true }));
    expect(input.getCursor()).toEqual({ line: 0, column: 0 });

    input.handleInput(key('end', { ctrl: true, shift: true }));
    expect(input.getCursor()).toEqual({ line: 1, column: 3 });
    expect(input.getSelectionRange()).toEqual({ start: 0, end: 7 });
    expect(input.getSelectedText()).toBe('abc\ndef');
  });

  it('moves by rendered pages through wrapped visual rows', () => {
    const input = new RendererTextInput({
      text: 'abcdef',
      layoutWidth: 2,
      layoutHeight: 2,
    });

    input.handleInput(key('pageup'));
    expect(input.getCursor()).toEqual({ line: 0, column: 2 });

    input.handleInput(key('pagedown', { shift: true }));
    expect(input.getCursor()).toEqual({ line: 0, column: 6 });
    expect(input.getSelectionRange()).toEqual({ start: 2, end: 6 });
  });

  it('deletes words and line fragments with terminal editor shortcuts', () => {
    const input = new RendererTextInput({ text: 'run npm test' });

    input.handleInput(key('backspace', { ctrl: true }));
    expect(input.getText()).toBe('run npm ');

    input.setCursor({ line: 0, column: 4 });
    input.handleInput(key('delete', { alt: true }));
    expect(input.getText()).toBe('run  ');

    input.setText('abc def');
    input.setCursor({ line: 0, column: 4 });
    input.handleInput(key('character', { text: 'u', ctrl: true }));
    expect(input.getText()).toBe('def');

    input.setText('abc def');
    input.setCursor({ line: 0, column: 4 });
    input.handleInput(key('character', { text: 'k', ctrl: true }));
    expect(input.getText()).toBe('abc ');
  });

  it('selects all text for replacement from keyboard shortcuts', () => {
    const input = new RendererTextInput({ text: 'replace me' });

    input.handleInput(key('f7'));
    expect(input.getSelectedText()).toBe('replace me');

    input.handleInput(key('character', { text: 'X' }));
    expect(input.getText()).toBe('X');
    expect(input.getSelection()).toBeUndefined();

    input.handleInput(key('character', { text: 'a', ctrl: true, shift: true }));
    expect(input.getSelectedText()).toBe('X');
  });

  it('places the cursor from relative mouse clicks', () => {
    const input = new RendererTextInput({ text: 'abcdef' });

    expect(input.handleMouse(mouse('press', { x: 3, y: 0 }), { x: 3, y: 0, width: 10 })).toBe(true);

    expect(input.getCursor()).toEqual({ line: 0, column: 3 });
    expect(input.getSelection()).toBeUndefined();
  });

  it('extends selections with shift-click and drag gestures', () => {
    const input = new RendererTextInput({ text: 'abcdef' });
    input.setCursor({ line: 0, column: 1 });

    input.handleMouse(mouse('press', { x: 4, y: 0, shift: true }), { x: 4, y: 0, width: 10 });
    expect(input.getSelection()).toEqual({ anchor: 1, head: 4 });

    input.handleMouse(mouse('drag', { x: 5, y: 0 }), { x: 5, y: 0, width: 10 });
    input.handleMouse(mouse('release', { x: 5, y: 0 }), { x: 5, y: 0, width: 10 });
    expect(input.getSelectionRange()).toEqual({ start: 1, end: 5 });
    expect(input.getSelectedText()).toBe('bcde');
  });

  it('maps mouse positions through wrapped viewport rows', () => {
    const input = new RendererTextInput({ text: 'abcdef' });
    const frame = input.render({ width: 2, height: 2 });

    input.handleMouse(mouse('press', { x: 1, y: 0 }), {
      x: 1,
      y: 0,
      width: 2,
      viewportRow: frame.viewportRow,
    });

    expect(frame.viewportRow).toBe(1);
    expect(input.getCursor()).toEqual({ line: 0, column: 3 });
  });

  it('renders placeholder text without moving the real cursor', () => {
    const input = new RendererTextInput({
      placeholder: 'Ask anything',
      placeholderStyle: { dim: true },
    });

    const frame = input.render({ width: 20, focused: false });

    expect(lineText(frame.lines[0])).toBe('Ask anything');
    expect(frame.lines[0]).toEqual(
      Array.from('Ask anything', (char) => ({ char, style: { dim: true } })),
    );
    expect(frame.cursor).toMatchObject({ x: 0, y: 0, visible: false });
  });

  it('supports common control-key editing without taking unrelated shortcuts', () => {
    const input = new RendererTextInput({ text: 'abc' });

    expect(input.handleInput(key('character', { text: 'a', ctrl: true }))).toBe(true);
    input.handleInput(key('delete'));
    expect(input.getText()).toBe('bc');
    expect(input.handleInput(key('escape'))).toBe(false);
  });

  it('keeps single-line inputs from accepting line breaks', () => {
    const input = new RendererTextInput({ multiline: false });

    expect(input.handleInput(key('enter'))).toBe(false);
    input.handleInput({ type: 'paste', raw: 'paste', text: 'a\nb' });

    expect(input.getText()).toBe('ab');
  });

  it('keeps cursor movement out of caller-owned atomic ranges', () => {
    const text = 'run [paste #1] now';
    const input = new RendererTextInput({
      text,
      atomicRanges: [{ start: 4, end: 14, id: 'paste' }],
    });

    input.setCursor({ line: 0, column: 14 });
    input.handleInput(key('left'));
    expect(input.getCursor()).toEqual({ line: 0, column: 4 });

    input.handleInput(key('right'));
    expect(input.getCursor()).toEqual({ line: 0, column: 14 });
  });

  it('deletes atomic ranges as indivisible spans', () => {
    const input = new RendererTextInput({
      text: 'a[paste]b',
      atomicRanges: [{ start: 1, end: 8 }],
    });

    input.setCursor({ line: 0, column: 8 });
    input.handleInput(key('backspace'));

    expect(input.getText()).toBe('ab');
    expect(input.getCursor()).toEqual({ line: 0, column: 1 });
    expect(input.getAtomicRanges()).toEqual([]);
  });

  it('keeps atomic ranges aligned when editing before them', () => {
    const input = new RendererTextInput({
      text: 'a[paste]b',
      atomicRanges: [{ start: 1, end: 8, id: 'paste' }],
    });

    input.setCursor({ line: 0, column: 0 });
    input.handleInput(key('character', { text: '>' }));

    expect(input.getText()).toBe('>a[paste]b');
    expect(input.getAtomicRanges()).toEqual([{ start: 2, end: 9, id: 'paste' }]);
  });

  it('snaps externally assigned cursors out of atomic range interiors', () => {
    const input = new RendererTextInput({
      text: 'a[paste]b',
      atomicRanges: [{ start: 1, end: 8 }],
    });

    input.setCursor({ line: 0, column: 4 });

    expect(input.getCursor()).toEqual({ line: 0, column: 1 });
  });
});

describe('RendererEditorTextInput bridge', () => {
  it('exposes the editor-frame text input geometry used by native chrome', () => {
    expect(RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY).toEqual({
      contentX: 4,
      contentY: 1,
      contentRightInset: 2,
      contentBottomInset: 1,
    });
    expect(rendererEditorContentWidth(
      { x: 0, y: 0, width: 20, height: 6 },
      RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
    )).toBe(14);
    expect(rendererEditorContentHeight(
      { x: 0, y: 0, width: 20, height: 6 },
      RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
    )).toBe(4);
  });

  it('projects host editor state into renderer text input with caller atomic ranges', () => {
    const editor = mutableEditor('run [paste #1] now', { line: 0, col: 18 });
    const input = createRendererEditorTextInput(editor, {
      atomicRangesForText: (text) => [{ start: text.indexOf('['), end: text.indexOf(']') + 1 }],
    });

    expect(input.getText()).toBe('run [paste #1] now');
    expect(input.getCursor()).toEqual({ line: 0, column: 18 });
    expect(input.getAtomicRanges()).toEqual([{ start: 4, end: 14 }]);
  });

  it('routes mouse and cursor keys through caller-provided editor geometry', () => {
    const editor = mutableEditor('hello');
    const controller = new RendererEditorTextInputController();
    const geometry = {
      contentX: 2,
      contentY: 1,
      contentRightInset: 0,
      contentBottomInset: 1,
    };

    expect(handleRendererEditorMouseInput(
      controller,
      editor,
      mouse('press', { x: 4, y: 1 }),
      { x: 0, y: 0, width: 12, height: 3 },
      { geometry },
    )).toBe(true);
    expect(editor.getCursor()).toEqual({ line: 0, col: 2 });

    expect(handleRendererEditorCursorKeyInput(
      controller,
      editor,
      key('left'),
      { x: 0, y: 0, width: 12, height: 3 },
      { geometry },
    )).toBe(true);
    expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
  });

  it('routes text mutations into the host editor without claiming unrelated shortcuts', () => {
    const editor = mutableEditor('');
    const controller = new RendererEditorTextInputController();

    expect(isRendererEditorTextMutation(key('character', { text: 'x' }))).toBe(true);
    expect(isRendererEditorTextMutation(key('escape'))).toBe(false);
    expect(handleRendererEditorTextMutationInput(
      controller,
      editor,
      key('character', { text: 'x' }),
      undefined,
    )).toBe(true);

    expect(editor.getText()).toBe('x');
    expect(editor.getCursor()).toEqual({ line: 0, col: 1 });
  });

  it('uses applyNativeTextInputSync when the host editor provides it', () => {
    const editor = mutableEditor('');
    let setTextCalls = 0;
    const synced = {
      ...editor,
      setText: (next: string) => {
        setTextCalls += 1;
        editor.setText(next);
      },
      applyNativeTextInputSync: (next: string, cursor: RendererEditorCursor) => {
        editor.setText(next);
        editor.setCursorPosition(cursor);
      },
    };
    const controller = new RendererEditorTextInputController();
    const input = controller.inputForEditor(synced);

    input.handleInput(key('character', { text: '한' }));
    syncRendererEditorTextInputToTarget(synced, input);

    expect(setTextCalls).toBe(0);
    expect(synced.getText()).toBe('한');
    expect(synced.getCursor()).toEqual({ line: 0, col: '한'.length });
  });

  it('preserves controller text when the host editor lags behind during render', () => {
    const editor = mutableEditor('');
    const synced = {
      ...editor,
      applyNativeTextInputSync: (next: string, cursor: RendererEditorCursor) => {
        editor.setText(next);
        editor.setCursorPosition(cursor);
      },
    };
    const controller = new RendererEditorTextInputController();
    const input = controller.inputForEditor(synced);

    input.handleInput(key('character', { text: '안' }));
    input.handleInput(key('character', { text: '녕' }));
    expect(input.getText()).toBe('안녕');

    // Simulate a stale host buffer (for example a render that ran before sync).
    editor.setText('안');

    const rebound = controller.inputForEditor(synced);
    expect(rebound).toBe(input);
    expect(rebound.getText()).toBe('안녕');
    expect(synced.getText()).toBe('안녕');
    expect(synced.getCursor()).toEqual({ line: 0, col: '안녕'.length });
  });

  it('does not restore controller text when the host editor is cleared', () => {
    const editor = mutableEditor('');
    const synced = {
      ...editor,
      applyNativeTextInputSync: (next: string, cursor: RendererEditorCursor) => {
        editor.setText(next);
        editor.setCursorPosition(cursor);
      },
    };
    const controller = new RendererEditorTextInputController();
    const input = controller.inputForEditor(synced);

    input.handleInput(key('character', { text: '안' }));
    input.handleInput(key('character', { text: '녕' }));
    expect(input.getText()).toBe('안녕');

    // Simulate the host clearing the editor after submit (or Ctrl-C).
    editor.setText('');

    const rebound = controller.inputForEditor(synced);
    expect(rebound).not.toBe(input);
    expect(rebound.getText()).toBe('');
    expect(synced.getText()).toBe('');
  });

  it('handles command-prefix mode transitions before text mutation fallback', () => {
    const editor = mutableEditor('');
    const controller = new RendererEditorTextInputController();
    let mode: 'prompt' | 'command' = 'prompt';
    const modeChanges: string[] = [];
    const interactions: string[] = [];
    const afterInputs: string[] = [];
    const handle = (event: Parameters<typeof handleRendererCommandPrefixTextInput>[2]) =>
      handleRendererCommandPrefixTextInput(controller, editor, event, undefined, {
        mode,
        commandTrigger: '!',
        onModeChange: (next) => {
          mode = next;
          modeChanges.push(next);
        },
        onInteraction: () => interactions.push(editor.getText()),
        onAfterTextInput: () => afterInputs.push(editor.getText()),
      });

    expect(handle(key('character', { text: '!' }))).toBe(true);
    expect(mode).toBe('command');
    expect(editor.getText()).toBe('');

    expect(handle(key('character', { text: 'l' }))).toBe(true);
    expect(editor.getText()).toBe('l');
    expect(afterInputs).toEqual(['l']);

    editor.setText('');
    expect(handle(key('escape'))).toBe(true);
    expect(mode).toBe('prompt');

    expect(modeChanges).toEqual(['command', 'prompt']);
    expect(interactions).toEqual(['', '', '']);
  });

  it('strips command-prefix pasted text and leaves unrelated shortcuts unclaimed', () => {
    const editor = mutableEditor('');
    const controller = new RendererEditorTextInputController();
    let mode: 'prompt' | 'command' = 'prompt';

    expect(handleRendererCommandPrefixTextInput(
      controller,
      editor,
      { type: 'paste', raw: '\u001B[200~!ls\u001B[201~', text: '!ls' },
      undefined,
      {
        mode,
        commandTrigger: '!',
        onModeChange: (next) => {
          mode = next;
        },
      },
    )).toBe(true);

    expect(mode).toBe('command');
    expect(editor.getText()).toBe('ls');
    expect(handleRendererCommandPrefixTextInput(
      controller,
      editor,
      key('pageup'),
      undefined,
      { mode },
    )).toBe(false);
  });
});

function key(
  keyName: NativeInputKeyEvent['key'],
  options: Partial<Omit<NativeInputKeyEvent, 'type' | 'key' | 'raw'>> = {},
): NativeInputKeyEvent {
  const event: {
    type: 'key';
    key: NativeInputKeyEvent['key'];
    raw: string;
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    text?: string;
    eventType?: NativeInputKeyEvent['eventType'];
  } = {
    type: 'key',
    key: keyName,
    raw: options.text ?? keyName,
    ctrl: options.ctrl ?? false,
    alt: options.alt ?? false,
    shift: options.shift ?? false,
  };
  if (options.text !== undefined) event.text = options.text;
  if (options.eventType !== undefined) event.eventType = options.eventType;
  return event;
}

function mouse(
  action: 'press' | 'release' | 'drag',
  options: {
    readonly x: number;
    readonly y: number;
    readonly shift?: boolean;
  },
): Extract<NativeInputEvent, { type: 'mouse' }> {
  return {
    type: 'mouse',
    raw: '<mouse>',
    button: action === 'drag' ? 'none' : 'left',
    action,
    x: options.x,
    y: options.y,
    ctrl: false,
    alt: false,
    shift: options.shift ?? false,
  };
}

function lineText(line: unknown): string {
  if (!Array.isArray(line)) return '';
  return line.map((cell: { readonly char?: string }) => cell.char ?? '').join('');
}

function cellStyles(line: unknown): unknown[] {
  if (!Array.isArray(line)) return [];
  return line.map((cell: { readonly style?: unknown }) => cell.style);
}

function mutableEditor(initialText: string, initialCursor?: RendererEditorCursor) {
  let text = initialText;
  let cursor = initialCursor ?? { line: 0, col: text.length };
  return {
    getText: () => text,
    setText: (next: string) => {
      text = next;
    },
    getCursor: () => cursor,
    setCursorPosition: (next: RendererEditorCursor) => {
      cursor = next;
    },
  };
}
