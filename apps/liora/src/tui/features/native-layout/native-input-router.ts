import {
  encodeNativeInputAsLegacySequence,
  NativeInputRouter,
  rendererViewportActionForInput,
  type NativeInputEvent,
  type NativeInputRouteResult,
} from '#/tui/renderer';

import type { TUIState } from '../../tui-state';
import {
  handleNativeEditorKeyInput,
  handleNativeEditorMouseInput,
  handleNativeEditorTextInput,
} from './native-editor-text-input';
import { noteTUIInputInteraction } from '#/tui/utils/input/input-interaction';
import { getTUIStateNativeEditorRect } from './native-layout-frame';
import {
  handleStageResizeMouseInput,
  resetStageResizePointerShape,
} from '#/tui/features/stage/stage-resize-mouse';
import {
  handleToolOutputMouse,
  resetToolOutputMouseState,
} from '#/tui/utils/tool/tool-output-mouse';
import { handleTranscriptDensityMouse } from '#/tui/features/transcript/transcript-density-mouse';
import { handleTranscriptSelectionMouseInput } from '#/tui/features/transcript/transcript-selection-mouse';
import type { TranscriptScrollAction } from '#/tui/features/transcript/transcript-viewport';

export const TUI_NATIVE_EDITOR_INPUT_TARGET_ID = 'editor';
const TUI_NATIVE_POINTER_CLEANUP_HANDLER_ID = 'pointer-cleanup';
const TUI_NATIVE_STAGE_RESIZE_HANDLER_ID = 'stage-resize';
const TUI_NATIVE_TOOL_OUTPUT_HANDLER_ID = 'tool-output';
const TUI_NATIVE_TRANSCRIPT_DENSITY_HANDLER_ID = 'transcript-density';
const TUI_NATIVE_TRANSCRIPT_SELECTION_HANDLER_ID = 'transcript-selection';
const TUI_NATIVE_TODO_SCROLL_HANDLER_ID = 'todo-scroll';
const TUI_NATIVE_TRANSCRIPT_SCROLL_HANDLER_ID = 'transcript-scroll';

export interface NativeLegacyInputTarget {
  readonly id: string;
  readonly handleInput: (data: string) => void;
  readonly handleNativeInput?: (event: NativeInputEvent) => boolean;
  readonly focusable?: boolean;
  readonly enabled?: boolean | (() => boolean);
}

export interface TUIStateNativeInputRouterOptions {
  readonly handleLegacyInput?: (data: string, event: NativeInputEvent) => void;
  readonly handleNativeEditorInput?: (event: NativeInputEvent) => boolean;
  /**
   * Checked before the editor's own key/text handling. Returning true
   * consumes the event so it never reaches the editor (or its legacy-sequence
   * fallback). Used for workspace-level shortcuts/overlays that must work even
   * while the editor is focused — the router dispatches focused targets before
   * global handlers, so a plain global handler would be shadowed by the editor.
   */
  readonly handlePreEditorInput?: (event: NativeInputEvent) => boolean;
  readonly requestRender?: boolean;
  readonly scrollTranscriptViewport?: (action: TranscriptScrollAction) => boolean;
  /**
   * Offered wheel events before the transcript viewport consumes them.
   * The callback hit-tests the pointer against the todo board and scrolls
   * it; returning true consumes the event. Returning false (pointer
   * elsewhere, board at rest / not windowed) lets the transcript scroll
   * handler run exactly as before. Like the transcript callback, the
   * handler owns its own render request.
   */
  readonly scrollTodoPanel?: (event: NativeInputEvent) => boolean;
}

export class TUIStateNativeInputRouter {
  readonly router = new NativeInputRouter();
  private readonly disposers: Array<() => void> = [];

  constructor(
    private readonly state: TUIState,
    private readonly options: TUIStateNativeInputRouterOptions = {},
  ) {
    this.disposers.push(
      this.registerLegacyTarget({
        id: TUI_NATIVE_EDITOR_INPUT_TARGET_ID,
        handleInput: (data) => {
          state.editor.handleInput(data);
        },
        handleNativeInput: (event) => {
          if (options.handlePreEditorInput?.(event) === true) return true;
          const handler =
            options.handleNativeEditorInput ??
            ((e) => handleTUIStateNativeEditorInput(state, e));
          return handler(event);
        },
      }),
    );
    // Global handlers dispatch in registration order. Release/focus cleanup
    // runs first, then stage resize wins over tool output and transcript
    // selection when multiple pointer regions overlap.
    this.disposers.push(
      this.router.registerGlobalHandler({
        id: TUI_NATIVE_POINTER_CLEANUP_HANDLER_ID,
        onInput: (event) => {
          const shouldCleanup =
            (event.type === 'focus' && !event.focused) ||
            (event.type === 'mouse' && event.action === 'release');
          if (!shouldCleanup) return false;
          const changed = resetNativePointerInteractionState(state);
          if (changed) this.requestRenderAfterInput();
          // Never consume mouse release: stage/tool cleanup is a side effect.
          // Returning true here stole transcript selection finalization (and
          // copy-on-release) whenever a resize hover or tool-mouse arm was set.
          return false;
        },
      }),
    );
    this.disposers.push(
      this.router.registerGlobalHandler({
        id: TUI_NATIVE_STAGE_RESIZE_HANDLER_ID,
        onInput: (event) => {
          const handled = handleStageResizeMouseInput(state, event);
          if (handled) this.requestRenderAfterInput();
          return handled;
        },
      }),
    );
    this.disposers.push(
      this.router.registerGlobalHandler({
        id: TUI_NATIVE_TOOL_OUTPUT_HANDLER_ID,
        onInput: (event) => {
          if (event.type !== 'mouse') return false;
          const handled = handleToolOutputMouse(state, event);
          if (handled) this.requestRenderAfterInput();
          return handled;
        },
      }),
    );
    this.disposers.push(
      // Registered before transcript selection: a click on a collapsed
      // one-line tool card expands it instead of starting a text selection.
      this.router.registerGlobalHandler({
        id: TUI_NATIVE_TRANSCRIPT_DENSITY_HANDLER_ID,
        onInput: (event) => {
          if (event.type !== 'mouse') return false;
          const handled = handleTranscriptDensityMouse(state, event);
          if (handled) this.requestRenderAfterInput();
          return handled;
        },
      }),
    );
    this.disposers.push(
      this.router.registerGlobalHandler({
        id: TUI_NATIVE_TRANSCRIPT_SELECTION_HANDLER_ID,
        onInput: (event) => {
          const handled = handleTranscriptSelectionMouseInput(state, event);
          if (handled) this.requestRenderAfterInput();
          return handled;
        },
      }),
    );
    if (options.scrollTodoPanel !== undefined) {
      // Registered before transcript scroll: global handlers dispatch in
      // registration order and the first one that handles wins, so wheel
      // ticks over the board move the board while every other wheel event
      // still falls through to the transcript viewport.
      this.disposers.push(
        this.router.registerGlobalHandler({
          id: TUI_NATIVE_TODO_SCROLL_HANDLER_ID,
          onInput: (event) => {
            if (event.type !== 'mouse' || event.action !== 'wheel') return false;
            return options.scrollTodoPanel?.(event) === true;
          },
        }),
      );
    }
    if (options.scrollTranscriptViewport !== undefined) {
      this.disposers.push(
        this.router.registerGlobalHandler({
          id: TUI_NATIVE_TRANSCRIPT_SCROLL_HANDLER_ID,
          onInput: (event) => {
            const action = transcriptScrollActionForNativeInput(event);
            if (action === undefined) return false;
            // Nothing to scroll: when the transcript fits the viewport there is
            // no scrollable range, so wheel ticks must not reach the viewport.
            // Scrolling here would clamp the offset and flip `followOutput`,
            // which reports a change on every direction switch and schedules
            // scroll + settle/progressive repaints — visible flicker for
            // content that cannot move. Consume the tick instead.
            if (
              event.type === 'mouse' &&
              !state.transcriptViewport.snapshot().hasOverflow
            ) {
              return true;
            }
            // Always consume wheel / viewport scroll keys. Returning false when
            // already at top/bottom used to leave the event unhandled and risk
            // fallthrough into other handlers (and, historically, false Esc paths).
            const changed = options.scrollTranscriptViewport?.(action) === true;
            if (changed) state.transcriptSelection.clear();
            return true;
          },
        }),
      );
    }
    this.focusEditor();
  }

  dispatch(event: NativeInputEvent): NativeInputRouteResult {
    return this.router.dispatch(event);
  }

  focusEditor(): boolean {
    return this.router.focus(TUI_NATIVE_EDITOR_INPUT_TARGET_ID);
  }

  registerLegacyTarget(target: NativeLegacyInputTarget): () => void {
    return this.router.registerTarget({
      id: target.id,
      focusable: target.focusable,
      enabled: target.enabled,
      onInput: (event) => {
        if (
          target.id === TUI_NATIVE_EDITOR_INPUT_TARGET_ID &&
          event.type === 'mouse' &&
          (event.button === 'wheel-up' || event.button === 'wheel-down')
        ) {
          return false;
        }
        if (target.handleNativeInput?.(event) === true) {
          this.requestRenderAfterInput();
          return true;
        }
        const legacy = encodeNativeInputAsLegacySequence(event);
        if (legacy === undefined) return false;
        this.routeLegacyInput(target, legacy, event);
        return true;
      },
    });
  }

  pushLegacyModalTarget(
    target: NativeLegacyInputTarget,
    options: { readonly restoreFocus?: boolean } = {},
  ): () => void {
    const unregister = this.registerLegacyTarget(target);
    const popModal = this.router.pushModal(target.id);
    const restoreFocus = options.restoreFocus !== false;
    return () => {
      popModal();
      unregister();
      if (restoreFocus) this.focusEditor();
    };
  }

  dispose(): void {
    resetNativePointerInteractionState(this.state);
    for (const dispose of this.disposers.splice(0).toReversed()) dispose();
  }

  private routeLegacyInput(
    target: NativeLegacyInputTarget,
    data: string,
    event: NativeInputEvent,
  ): void {
    if (this.options.handleLegacyInput !== undefined) {
      this.options.handleLegacyInput(data, event);
    } else {
      target.handleInput(data);
    }
    this.requestRenderAfterInput();
  }

  private requestRenderAfterInput(): void {
    // Record the interaction timestamp (kept for diagnostics / future use).
    noteTUIInputInteraction();
    if (this.options.requestRender !== false) this.state.renderer.requestRender('input');
  }
}

function resetNativePointerInteractionState(state: TUIState): boolean {
  const stageChanged = resetStageResizePointerShape(state.terminal);
  const toolChanged = resetToolOutputMouseState();
  return stageChanged || toolChanged;
}

export function createTUIStateNativeInputRouter(
  state: TUIState,
  options: TUIStateNativeInputRouterOptions = {},
): TUIStateNativeInputRouter {
  return new TUIStateNativeInputRouter(state, options);
}

function transcriptScrollActionForNativeInput(
  event: NativeInputEvent,
): TranscriptScrollAction | undefined {
  const action = rendererViewportActionForInput(event);
  return action === 'line-up' || action === 'line-down' ? action : undefined;
}

function handleTUIStateNativeEditorInput(
  state: TUIState,
  event: NativeInputEvent,
): boolean {
  // The editor rect forces a full chrome measurement pass (every container's
  // render()), so compute it at most once per input event instead of once per
  // handler branch. This is the dominant per-keystroke cost for IME input.
  const rect = getTUIStateNativeEditorRect(state);
  if (event.type === 'key') {
    // When the autocomplete menu is open, navigation keys (up/down/enter/tab/
    // escape) must reach the menu before the cursor-key handler, which would
    // otherwise swallow up/down as vertical cursor movement and starve the menu.
    if (state.editor.handleAutocompleteNavigation?.(event) === true) return true;
    if (handleNativeEditorKeyInput(
      state.nativeEditorTextInput,
      state.editor,
      event,
      rect,
    )) return true;
    return handleNativeEditorTextInput(
      state.nativeEditorTextInput,
      state.editor,
      event,
      rect,
    );
  }
  if (event.type === 'paste') {
    return handleNativeEditorTextInput(
      state.nativeEditorTextInput,
      state.editor,
      event,
      rect,
    );
  }
  if (event.type !== 'mouse') return false;
  // Transcript drag selection is a global gesture. While it is active, do not
  // let the focused editor swallow drag/release when the pointer crosses the
  // prompt — otherwise isDragging sticks and copy never runs.
  if (
    state.transcriptSelection.isDragging &&
    (event.action === 'drag' || event.action === 'release')
  ) {
    return false;
  }
  return handleNativeEditorMouseInput(
    state.nativeEditorTextInput,
    state.editor,
    event,
    rect,
  );
}
