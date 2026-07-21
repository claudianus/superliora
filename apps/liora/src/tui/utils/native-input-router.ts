import {
  encodeNativeInputAsLegacySequence,
  NativeInputRouter,
  rendererViewportActionForInput,
  type NativeInputEvent,
  type NativeInputRouteResult,
} from '#/tui/renderer';

import type { TUIState } from '../tui-state';
import {
  handleNativeEditorKeyInput,
  handleNativeEditorMouseInput,
  handleNativeEditorTextInput,
} from './native-editor-text-input';
import { noteTUIInputInteraction } from './input-interaction';
import { getTUIStateNativeEditorRect } from './native-layout-frame';
import { handleTranscriptSelectionMouseInput } from './transcript-selection-mouse';
import type { TranscriptScrollAction } from './transcript-viewport';

export const TUI_NATIVE_EDITOR_INPUT_TARGET_ID = 'editor';
const TUI_NATIVE_TRANSCRIPT_SELECTION_HANDLER_ID = 'transcript-selection';
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
    if (options.scrollTranscriptViewport !== undefined) {
      this.disposers.push(
        this.router.registerGlobalHandler({
          id: TUI_NATIVE_TRANSCRIPT_SCROLL_HANDLER_ID,
          onInput: (event) => {
            const action = transcriptScrollActionForNativeInput(event);
            if (action === undefined) return false;
            const changed = options.scrollTranscriptViewport?.(action) === true;
            if (changed) state.transcriptSelection.clear();
            return changed;
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

  pushLegacyModalTarget(target: NativeLegacyInputTarget): () => void {
    const unregister = this.registerLegacyTarget(target);
    const popModal = this.router.pushModal(target.id);
    return () => {
      popModal();
      unregister();
      this.focusEditor();
    };
  }

  dispose(): void {
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
  return handleNativeEditorMouseInput(
    state.nativeEditorTextInput,
    state.editor,
    event,
    rect,
  );
}
