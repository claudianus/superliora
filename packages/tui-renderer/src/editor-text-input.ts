import type { RendererRect } from './compositor';
import type { NativeInputKeyEvent, NativeInputMouseEvent, NativeInputPasteEvent } from './input-events';
import {
  RendererTextInput,
  type RendererTextInputAtomicRange,
  type RendererTextInputOptions,
} from './text-input';

export interface RendererEditorCursor {
  readonly line: number;
  readonly col: number;
}

export interface RendererEditorTextInputSource {
  getText(): string;
  getCursor(): RendererEditorCursor;
}

export interface RendererEditorTextInputTarget extends RendererEditorTextInputSource {
  setText(text: string): void;
  setCursorPosition?(cursor: RendererEditorCursor): void;
  /**
   * Optional fast path for native editor sync: update text/cursor without the
   * heavier `setText` side effects (for example closing autocomplete overlays).
   */
  applyNativeTextInputSync?(text: string, cursor: RendererEditorCursor): void;
}

export type RendererEditorAtomicRangesForText = (
  text: string,
) => readonly RendererTextInputAtomicRange[];

export type RendererEditorTextInputOptions = Omit<
  RendererTextInputOptions,
  'atomicRanges' | 'text'
> & {
  readonly atomicRangesForText?: RendererEditorAtomicRangesForText;
};

export interface RendererEditorTextInputControllerOptions {
  readonly atomicRangesForText?: RendererEditorAtomicRangesForText;
}

export interface RendererEditorTextInputGeometry {
  readonly contentX?: number;
  readonly contentY?: number;
  readonly contentRightInset?: number;
  readonly contentBottomInset?: number;
}

export interface RendererEditorTextInputHandleOptions {
  readonly geometry?: RendererEditorTextInputGeometry;
  readonly inputOptions?: RendererEditorTextInputOptions;
}

export type RendererCommandPrefixInputMode = 'prompt' | 'command';

export interface RendererCommandPrefixTextInputOptions
  extends RendererEditorTextInputHandleOptions {
  readonly mode: RendererCommandPrefixInputMode;
  readonly commandTrigger?: string;
  readonly onModeChange?: (mode: RendererCommandPrefixInputMode) => void;
  readonly onInteraction?: () => void;
  readonly onInsertNewline?: () => void;
  readonly onAfterTextInput?: () => void;
}

const DEFAULT_GEOMETRY: Required<RendererEditorTextInputGeometry> = {
  contentX: 0,
  contentY: 0,
  contentRightInset: 0,
  contentBottomInset: 0,
};

export function createRendererEditorTextInput(
  editor: RendererEditorTextInputSource,
  options: RendererEditorTextInputOptions = {},
): RendererTextInput {
  const text = editor.getText();
  const cursor = editor.getCursor();
  const { atomicRangesForText, ...textInputOptions } = options;
  const input = new RendererTextInput({
    ...textInputOptions,
    text,
    atomicRanges: atomicRangesForText?.(text) ?? [],
  });

  input.setCursor({ line: cursor.line, column: cursor.col });
  return input;
}

export class RendererEditorTextInputController {
  private input: RendererTextInput | undefined;

  constructor(private readonly defaults: RendererEditorTextInputControllerOptions = {}) {}

  inputForEditor(
    editor: RendererEditorTextInputSource,
    options: RendererEditorTextInputOptions = {},
  ): RendererTextInput {
    const text = editor.getText();
    const existing = this.input;
    if (existing === undefined || existing.getText() !== text) {
      const syncTarget = editor as RendererEditorTextInputTarget;
      const controllerText = existing?.getText();
      if (
        existing !== undefined &&
        controllerText !== undefined &&
        controllerText.length > text.length &&
        controllerText.startsWith(text) &&
        syncTarget.applyNativeTextInputSync !== undefined
      ) {
        const cursor = existing.getCursor();
        syncTarget.applyNativeTextInputSync(controllerText, {
          line: cursor.line,
          col: cursor.column,
        });
        this.applyLiveInputOptions(existing, editor, options, controllerText);
        return existing;
      }

      this.input = createRendererEditorTextInput(editor, this.optionsWithDefaults(options));
      return this.input;
    }

    this.applyLiveInputOptions(existing, editor, options, text);
    return existing;
  }

  reset(): void {
    this.input = undefined;
  }

  private optionsWithDefaults(options: RendererEditorTextInputOptions): RendererEditorTextInputOptions {
    return {
      ...options,
      atomicRangesForText: options.atomicRangesForText ?? this.defaults.atomicRangesForText,
    };
  }

  private atomicRangesForText(
    options: RendererEditorTextInputOptions,
    text: string,
  ): readonly RendererTextInputAtomicRange[] {
    const atomicRangesForText = options.atomicRangesForText ?? this.defaults.atomicRangesForText;
    return atomicRangesForText?.(text) ?? [];
  }

  private applyLiveInputOptions(
    input: RendererTextInput,
    editor: RendererEditorTextInputSource,
    options: RendererEditorTextInputOptions,
    text: string,
  ): void {
    if (options.focused !== undefined) input.setFocused(options.focused);
    input.setLayoutWidth(options.layoutWidth);
    input.setLayoutHeight(options.layoutHeight);
    input.setAtomicRanges(this.atomicRangesForText(options, text));

    if (input.getSelection() === undefined) {
      const editorCursor = editor.getCursor();
      const inputCursor = input.getCursor();
      if (
        inputCursor.line !== editorCursor.line ||
        inputCursor.column !== editorCursor.col
      ) {
        input.setCursor({
          line: editorCursor.line,
          column: editorCursor.col,
        });
      }
    }
  }
}

export function syncRendererEditorTextInputToTarget(
  editor: RendererEditorTextInputTarget,
  input: RendererTextInput,
): void {
  const text = input.getText();
  const cursor = input.getCursor();
  const nextCursor = { line: cursor.line, col: cursor.column };
  if (editor.applyNativeTextInputSync !== undefined) {
    editor.applyNativeTextInputSync(text, nextCursor);
    return;
  }
  if (editor.getText() !== text) editor.setText(text);
  editor.setCursorPosition?.(nextCursor);
}

export function handleRendererEditorMouseInput(
  controller: RendererEditorTextInputController,
  editor: RendererEditorTextInputTarget,
  event: NativeInputMouseEvent,
  rect: RendererRect | undefined,
  options: RendererEditorTextInputHandleOptions = {},
): boolean {
  if (rect === undefined) return false;
  if (event.button !== 'left' && event.button !== 'none') return false;
  if (event.action !== 'press' && event.action !== 'drag' && event.action !== 'release') {
    return false;
  }

  const geometry = normalizeGeometry(options.geometry);
  const localY = Math.floor(event.y - rect.y - geometry.contentY);
  const contentHeight = rendererEditorContentHeight(rect, geometry) ?? 1;
  if (localY < 0 || localY >= contentHeight) return false;

  const contentWidth = rendererEditorContentWidth(rect, geometry) ?? 1;
  const localX = Math.floor(event.x - rect.x - geometry.contentX);
  if (localX < 0 || localX >= contentWidth) return false;

  const input = controller.inputForEditor(
    editor,
    focusedInputOptions(contentWidth, contentHeight, options.inputOptions),
  );
  const viewportRow = input.render({
    width: contentWidth,
    height: contentHeight,
    focused: true,
  }).viewportRow;
  const handled = input.handleMouse(event, {
    x: localX,
    y: localY,
    width: contentWidth,
    viewportRow,
  });
  if (!handled) return false;

  syncRendererEditorTextInputToTarget(editor, input);
  return true;
}

export function handleRendererEditorCursorKeyInput(
  controller: RendererEditorTextInputController,
  editor: RendererEditorTextInputTarget,
  event: NativeInputKeyEvent,
  rect: RendererRect | undefined,
  options: RendererEditorTextInputHandleOptions = {},
): boolean {
  if (!isRendererEditorCursorKey(event)) return false;
  if (editor.getText().length === 0) return false;

  const geometry = normalizeGeometry(options.geometry);
  const contentWidth = rendererEditorContentWidth(rect, geometry);
  const contentHeight = rendererEditorContentHeight(rect, geometry);
  const input = controller.inputForEditor(
    editor,
    focusedInputOptions(contentWidth, contentHeight, options.inputOptions),
  );
  if (
    isRendererEditorPageKey(event) &&
    !rendererEditorHasScrollableText(input, contentWidth, contentHeight)
  ) {
    return false;
  }
  const handled = input.handleInput(event);
  if (!handled) return false;

  syncRendererEditorTextInputToTarget(editor, input);
  return true;
}

export function handleRendererEditorTextMutationInput(
  controller: RendererEditorTextInputController,
  editor: RendererEditorTextInputTarget,
  event: NativeInputKeyEvent | NativeInputPasteEvent,
  rect: RendererRect | undefined,
  options: RendererEditorTextInputHandleOptions = {},
): boolean {
  if (!isRendererEditorTextMutation(event)) return false;

  const geometry = normalizeGeometry(options.geometry);
  const input = controller.inputForEditor(
    editor,
    focusedInputOptions(
      rendererEditorContentWidth(rect, geometry),
      rendererEditorContentHeight(rect, geometry),
      options.inputOptions,
    ),
  );
  const handled = input.handleInput(event);
  if (!handled) return false;

  syncRendererEditorTextInputToTarget(editor, input);
  return true;
}

export function handleRendererCommandPrefixTextInput(
  controller: RendererEditorTextInputController,
  editor: RendererEditorTextInputTarget,
  event: NativeInputKeyEvent | NativeInputPasteEvent,
  rect: RendererRect | undefined,
  options: RendererCommandPrefixTextInputOptions,
): boolean {
  const commandTrigger = normalizeCommandTrigger(options.commandTrigger);
  const textBefore = editor.getText();

  if (
    event.type === 'key' &&
    (event.key === 'backspace' || event.key === 'escape') &&
    options.mode === 'command' &&
    textBefore.length === 0
  ) {
    options.onInteraction?.();
    options.onModeChange?.('prompt');
    return true;
  }

  if (
    event.type === 'key' &&
    event.key === 'character' &&
    event.text === commandTrigger &&
    options.mode === 'prompt' &&
    textBefore.length === 0
  ) {
    options.onInteraction?.();
    options.onModeChange?.('command');
    return true;
  }

  if (!isRendererEditorTextMutation(event)) return false;

  options.onInteraction?.();
  const handled = handleRendererEditorTextMutationInput(controller, editor, event, rect, options);
  if (!handled) return false;

  if (event.type === 'key' && event.key === 'enter') options.onInsertNewline?.();

  if (
    event.type === 'paste' &&
    options.mode === 'prompt' &&
    textBefore.length === 0 &&
    editor.getText().startsWith(commandTrigger)
  ) {
    options.onModeChange?.('command');
    editor.setText(editor.getText().slice(commandTrigger.length));
  }

  options.onAfterTextInput?.();
  return true;
}

export function rendererEditorContentWidth(
  rect: RendererRect | undefined,
  geometry: RendererEditorTextInputGeometry = DEFAULT_GEOMETRY,
): number | undefined {
  if (rect === undefined) return undefined;
  const normalized = normalizeGeometry(geometry);
  return Math.max(1, Math.floor(rect.width) - normalized.contentX - normalized.contentRightInset);
}

export function rendererEditorContentHeight(
  rect: RendererRect | undefined,
  geometry: RendererEditorTextInputGeometry = DEFAULT_GEOMETRY,
): number | undefined {
  if (rect === undefined) return undefined;
  const normalized = normalizeGeometry(geometry);
  return Math.max(1, Math.floor(rect.height) - normalized.contentY - normalized.contentBottomInset);
}

export function isRendererEditorCursorKey(event: NativeInputKeyEvent): boolean {
  if (event.eventType === 'release') return false;

  switch (event.key) {
    case 'left':
    case 'right':
      return true;
    case 'up':
    case 'down':
      return !event.ctrl && !event.alt;
    case 'home':
    case 'end':
      return !event.alt;
    case 'pagedown':
    case 'pageup':
      return !event.ctrl && !event.alt;
    case 'backspace':
    case 'character':
    case 'delete':
    case 'enter':
    case 'escape':
    case 'f1':
    case 'f2':
    case 'f3':
    case 'f4':
    case 'f5':
    case 'f6':
    case 'f7':
    case 'f8':
    case 'f9':
    case 'f10':
    case 'f11':
    case 'f12':
    case 'insert':
    case 'menu':
    case 'tab':
      return false;
  }
}

export function isRendererEditorPageKey(event: NativeInputKeyEvent): boolean {
  return event.key === 'pageup' || event.key === 'pagedown';
}

export function isRendererEditorTextMutation(
  event: NativeInputKeyEvent | NativeInputPasteEvent,
): boolean {
  if (event.type === 'paste') return true;
  if (event.eventType === 'release') return false;

  switch (event.key) {
    case 'character':
      if (event.ctrl && !event.alt) {
        return event.text?.toLowerCase() === 'z' || event.text?.toLowerCase() === 'y';
      }
      return event.text !== undefined && !event.ctrl && !event.alt;
    case 'backspace':
    case 'delete':
      return true;
    case 'enter':
      return event.shift || event.raw !== '\r';
    case 'down':
    case 'end':
    case 'escape':
    case 'f1':
    case 'f2':
    case 'f3':
    case 'f4':
    case 'f5':
    case 'f6':
    case 'f7':
    case 'f8':
    case 'f9':
    case 'f10':
    case 'f11':
    case 'f12':
    case 'home':
    case 'insert':
    case 'left':
    case 'menu':
    case 'pagedown':
    case 'pageup':
    case 'right':
    case 'tab':
    case 'up':
      return false;
  }
}

function rendererEditorHasScrollableText(
  input: RendererTextInput,
  width: number | undefined,
  height: number | undefined,
): boolean {
  if (width === undefined || height === undefined) return false;
  return input.render({
    width,
    height,
    focused: true,
  }).contentRows > height;
}

function focusedInputOptions(
  contentWidth: number | undefined,
  contentHeight: number | undefined,
  inputOptions: RendererEditorTextInputOptions | undefined,
): RendererEditorTextInputOptions {
  return {
    ...inputOptions,
    focused: inputOptions?.focused ?? true,
    cursorShape: inputOptions?.cursorShape ?? 'bar',
    cursorBlinking: inputOptions?.cursorBlinking ?? true,
    layoutWidth: contentWidth,
    layoutHeight: contentHeight,
  };
}

function normalizeGeometry(
  geometry: RendererEditorTextInputGeometry | undefined,
): Required<RendererEditorTextInputGeometry> {
  return {
    contentX: geometry?.contentX ?? DEFAULT_GEOMETRY.contentX,
    contentY: geometry?.contentY ?? DEFAULT_GEOMETRY.contentY,
    contentRightInset: geometry?.contentRightInset ?? DEFAULT_GEOMETRY.contentRightInset,
    contentBottomInset: geometry?.contentBottomInset ?? DEFAULT_GEOMETRY.contentBottomInset,
  };
}

function normalizeCommandTrigger(trigger: string | undefined): string {
  return trigger === undefined || trigger.length === 0 ? '!' : trigger;
}
