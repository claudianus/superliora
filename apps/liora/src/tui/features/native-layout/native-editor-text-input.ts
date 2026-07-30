import {
  RENDERER_EDITOR_CONTENT_X,
  RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
  RENDERER_EDITOR_PROMPT_X,
  RendererEditorTextInputController,
  createRendererEditorTextInput,
  handleRendererCommandPrefixTextInput,
  handleRendererEditorCursorKeyInput,
  handleRendererEditorMouseInput,
  rendererEditorContentHeight,
  rendererEditorContentWidth,
  syncRendererEditorTextInputToTarget,
  type NativeInputKeyEvent,
  type NativeInputMouseEvent,
  type NativeInputPasteEvent,
  type RendererEditorCursor,
  type RendererEditorTextInputOptions,
  type RendererEditorTextInputSource,
  type RendererEditorTextInputTarget,
  type RendererTextInput,
  type RendererTextInputAtomicRange,
  type RendererRect,
} from '#/tui/renderer';

export const NATIVE_EDITOR_PROMPT_X = RENDERER_EDITOR_PROMPT_X;
export const NATIVE_EDITOR_CONTENT_X = RENDERER_EDITOR_CONTENT_X;
export const NATIVE_EDITOR_GEOMETRY = RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY;

export type NativeEditorCursor = RendererEditorCursor;

export type NativeEditorTextInputSource = RendererEditorTextInputSource;

export interface NativeEditorTextInputTarget extends RendererEditorTextInputTarget {
  inputMode?: 'prompt' | 'bash';
  onInputModeChange?: (mode: 'prompt' | 'bash') => void;
  onInsertNewline?: () => void;
  recordNativeInputInteraction?: () => void;
  reopenAutocompleteAfterNativeInput?: () => void;
  setCursorPosition?(cursor: NativeEditorCursor): void;
}

export type NativeEditorTextInputOptions = Omit<
  RendererEditorTextInputOptions,
  'atomicRangesForText'
>;

const PASTE_MARKER_RE = /\[paste #(\d+)(?: (?:\+\d+ lines|\d+ chars))?\]/g;

export function createNativeEditorTextInput(
  editor: NativeEditorTextInputSource,
  options: NativeEditorTextInputOptions = {},
): RendererTextInput {
  return createRendererEditorTextInput(editor, {
    ...options,
    atomicRangesForText: nativeEditorAtomicRangesForText,
  });
}

export class NativeEditorTextInputController extends RendererEditorTextInputController {
  constructor() {
    super({ atomicRangesForText: nativeEditorAtomicRangesForText });
  }
}

export function nativeEditorAtomicRangesForText(
  text: string,
): readonly RendererTextInputAtomicRange[] {
  const ranges: RendererTextInputAtomicRange[] = [];

  for (const match of text.matchAll(PASTE_MARKER_RE)) {
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      id: `paste:${match[1]}`,
    });
  }

  return ranges;
}

export function syncNativeEditorTextInputToEditor(
  editor: NativeEditorTextInputTarget,
  input: RendererTextInput,
): void {
  syncRendererEditorTextInputToTarget(editor, input);
}

export function handleNativeEditorMouseInput(
  controller: NativeEditorTextInputController,
  editor: NativeEditorTextInputTarget,
  event: NativeInputMouseEvent,
  rect: RendererRect | undefined,
): boolean {
  return handleRendererEditorMouseInput(controller, editor, event, rect, {
    geometry: NATIVE_EDITOR_GEOMETRY,
  });
}

export function handleNativeEditorKeyInput(
  controller: NativeEditorTextInputController,
  editor: NativeEditorTextInputTarget,
  event: NativeInputKeyEvent,
  rect: RendererRect | undefined,
): boolean {
  return handleRendererEditorCursorKeyInput(controller, editor, event, rect, {
    geometry: NATIVE_EDITOR_GEOMETRY,
  });
}

export function handleNativeEditorTextInput(
  controller: NativeEditorTextInputController,
  editor: NativeEditorTextInputTarget,
  event: NativeInputKeyEvent | NativeInputPasteEvent,
  rect: RendererRect | undefined,
): boolean {
  return handleRendererCommandPrefixTextInput(controller, editor, event, rect, {
    geometry: NATIVE_EDITOR_GEOMETRY,
    mode: editor.inputMode === 'bash' ? 'command' : 'prompt',
    commandTrigger: '!',
    onModeChange: (mode) => {
      const inputMode = mode === 'command' ? 'bash' : 'prompt';
      editor.inputMode = inputMode;
      editor.onInputModeChange?.(inputMode);
    },
    onInteraction: () => {
      editor.recordNativeInputInteraction?.();
    },
    onInsertNewline: () => {
      editor.onInsertNewline?.();
    },
    onAfterTextInput: () => {
      editor.reopenAutocompleteAfterNativeInput?.();
    },
  });
}

export function nativeEditorContentWidth(rect: RendererRect | undefined): number | undefined {
  return rendererEditorContentWidth(rect, NATIVE_EDITOR_GEOMETRY);
}

export function nativeEditorContentHeight(rect: RendererRect | undefined): number | undefined {
  return rendererEditorContentHeight(rect, NATIVE_EDITOR_GEOMETRY);
}
