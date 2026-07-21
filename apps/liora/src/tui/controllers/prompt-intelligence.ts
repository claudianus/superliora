import type { Session } from '@superliora/sdk';

import { isExperimentalFlagEnabled } from '#/tui/commands/experimental-flags';

import type { TUIState } from '../tui-state';

/** Debounce before requesting an inline completion after the last keystroke. */
const INLINE_DEBOUNCE_MS = 700;
/** Debounce before requesting next-task suggestions when the editor is empty. */
const SUGGEST_DEBOUNCE_MS = 800;
/** Minimum characters before inline completion fires (avoids LLM calls on "a", "ab"). */
const INLINE_MIN_CHARS = 3;
/** Maximum entries in the inline-completion LRU cache. */
const CACHE_MAX_SIZE = 32;

export interface PromptIntelligenceHost {
  state: TUIState;
  session: Session | undefined;
  track(event: string, props?: Record<string, unknown>): void;
}

/**
 * Orchestrates prompt-intelligence ghost text in the TUI editor:
 *
 * 1. **Inline completion** — while the user types prose, a debounced LLM call
 *    predicts the next words and renders them as dimmed ghost text after the
 *    cursor. Tab accepts.
 * 2. **Next-task suggestion** — when the editor is empty and the session is
 *    idle, a debounced LLM call recommends follow-up tasks. ↑/↓ cycles
 *    candidates; Tab fills the editor (does not submit).
 *
 * Both features are gated by the `prompt_intelligence` experimental flag and
 * are mutually exclusive with the slash/mention autocomplete menu.
 */
export class PromptIntelligenceController {
  private inlineTimer: ReturnType<typeof setTimeout> | undefined;
  private suggestTimer: ReturnType<typeof setTimeout> | undefined;
  private abortController: AbortController | undefined;
  private suggestionCache: readonly string[] = [];
  private suggestionIndex = 0;
  /** Simple LRU: Map iteration order is insertion order; evict oldest. */
  private readonly lru = new Map<string, string>();

  constructor(private readonly host: PromptIntelligenceHost) {}

  install(): void {
    const editor = this.host.state.editor;

    editor.onAcceptGhost = () => {
      this.suggestionCache = [];
      this.suggestionIndex = 0;
      this.host.track('prompt_intelligence_accept');
    };

    editor.onCycleGhost = (direction: -1 | 1) => {
      this.cycleSuggestion(direction);
    };

    // Wrap the existing onChange (set by EditorKeyboardController) so both
    // handlers fire. Installation order: after EditorKeyboardController.
    const existingOnChange = editor.onChange;
    editor.onChange = (text: string) => {
      existingOnChange?.(text);
      this.handleEditorChange(text);
    };
  }

  /**
   * Called by the host when `streamingPhase` transitions to `'idle'` (turn
   * complete, shell finished, etc.). Triggers a suggestion request if the
   * editor is empty.
   */
  notifyIdle(): void {
    this.scheduleSuggestion();
  }

  dispose(): void {
    this.clearTimers();
    this.abortInFlight();
  }

  // ---------------------------------------------------------------------------
  // Editor change → inline completion / suggestion routing
  // ---------------------------------------------------------------------------

  private handleEditorChange(text: string): void {
    if (text.length === 0) {
      this.clearInlineTimer();
      this.scheduleSuggestion();
    } else {
      this.clearSuggestTimer();
      this.scheduleInlineCompletion();
    }
  }

  // ---------------------------------------------------------------------------
  // Inline completion
  // ---------------------------------------------------------------------------

  private scheduleInlineCompletion(): void {
    this.clearInlineTimer();
    this.inlineTimer = setTimeout(() => {
      this.inlineTimer = undefined;
      void this.requestInlineCompletion();
    }, INLINE_DEBOUNCE_MS);
    this.inlineTimer.unref?.();
  }

  private async requestInlineCompletion(): Promise<void> {
    if (!this.canRequestIntelligence()) {
      process.stderr.write(`[pi-debug] canRequest=false session=${this.host.session !== undefined} phase=${this.host.state.appState.streamingPhase} mode=${this.host.state.appState.inputMode}\n`);
      return;
    }

    const editor = this.host.state.editor;
    const text = editor.getText();
    if (text.length < INLINE_MIN_CHARS) return;
    if (this.isAutocompleteTrigger(text)) return;
    process.stderr.write(`[pi-debug] requesting inline completion for ${text.length} chars\n`);

    const cursor = editor.getCursor();
    const cacheKey = `${cursor.line}:${cursor.col}:${text}`;
    const cached = this.lruGet(cacheKey);
    if (cached !== undefined) {
      if (cached.length > 0) editor.setGhostText(cached, 'inline');
      return;
    }

    this.abortInFlight();
    const ac = new AbortController();
    this.abortController = ac;

    try {
      const session = this.host.session;
      if (session === undefined) return;
      process.stderr.write(`[pi-debug] calling session.inlineComplete...\n`);
      const result = await session.inlineComplete({
        text,
        cursorLine: cursor.line,
        cursorCol: cursor.col,
        signal: ac.signal,
      });
      process.stderr.write(`[pi-debug] rpc returned, aborted=${ac.signal.aborted} textChanged=${editor.getText() !== text}\n`);
      if (ac.signal.aborted) return;
      // Guard: editor state may have changed while the request was in flight.
      if (editor.getText() !== text) return;
      if (editor.isShowingAutocomplete()) return;

      this.lruSet(cacheKey, result.completion);
      process.stderr.write(`[pi-debug] got completion: ${result.completion.length} chars: "${result.completion.slice(0, 50)}"\n`);
      if (result.completion.length > 0) {
        editor.setGhostText(result.completion, 'inline');
      }
    } catch (error) {
      // AbortError is expected when a newer keystroke cancels the in-flight
      // request — do not surface it.  Genuine failures go to stderr so they
      // stay out of the TUI render surface.
      if (error instanceof DOMException && error.name === 'AbortError') {
        process.stderr.write(`[pi-debug] inline aborted (user typed more)\n`);
      } else {
        process.stderr.write(`[pi-debug] inline error: ${error}\n`);
      }
    } finally {
      if (this.abortController === ac) this.abortController = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Next-task suggestion
  // ---------------------------------------------------------------------------

  private scheduleSuggestion(): void {
    this.clearSuggestTimer();
    this.suggestTimer = setTimeout(() => {
      this.suggestTimer = undefined;
      void this.requestSuggestions();
    }, SUGGEST_DEBOUNCE_MS);
    this.suggestTimer.unref?.();
  }

  private async requestSuggestions(): Promise<void> {
    if (!this.canRequestIntelligence()) return;

    const editor = this.host.state.editor;
    if (editor.getText().length > 0) return;
    if (editor.isShowingAutocomplete()) return;

    this.abortInFlight();
    const ac = new AbortController();
    this.abortController = ac;

    try {
      const session = this.host.session;
      if (session === undefined) return;
      const result = await session.suggestPrompts({ signal: ac.signal });
      if (ac.signal.aborted) return;
      if (editor.getText().length > 0) return;
      if (editor.isShowingAutocomplete()) return;

      if (result.suggestions.length > 0) {
        this.suggestionCache = result.suggestions;
        this.suggestionIndex = 0;
        editor.setGhostText(this.suggestionCache[0], 'suggestion');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        process.stderr.write(`[prompt-intelligence] suggestion request failed: ${error}\n`);
      }
    } finally {
      if (this.abortController === ac) this.abortController = undefined;
    }
  }

  private cycleSuggestion(direction: -1 | 1): void {
    if (this.suggestionCache.length === 0) return;
    this.suggestionIndex =
      (this.suggestionIndex + direction + this.suggestionCache.length) %
      this.suggestionCache.length;
    const candidate = this.suggestionCache[this.suggestionIndex];
    if (candidate !== undefined) {
      this.host.state.editor.setGhostText(candidate, 'suggestion');
    }
  }

  // ---------------------------------------------------------------------------
  // Guards & helpers
  // ---------------------------------------------------------------------------

  private canRequestIntelligence(): boolean {
    if (!isExperimentalFlagEnabled('prompt_intelligence')) return false;
    const { state } = this.host;
    if (state.appState.streamingPhase !== 'idle') return false;
    if (state.appState.inputMode !== 'prompt') return false;
    if (state.editor.isShowingAutocomplete()) return false;
    if (this.host.session === undefined) return false;
    return true;
  }

  /**
   * Returns true when the current text looks like a slash-command, @mention,
   * or path trigger — cases where the autocomplete menu should own the UX and
   * inline ghost text would be distracting.
   */
  private isAutocompleteTrigger(text: string): boolean {
    const editor = this.host.state.editor;
    const cursor = editor.getCursor();
    const lines = text.split('\n');
    const line = lines[cursor.line] ?? '';
    const before = line.slice(0, cursor.col);
    if (before.length === 0) return false;
    if (before.startsWith('/')) return true;
    if (before.includes('@')) return true;
    const tokenStart = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\t')) + 1;
    const token = before.slice(tokenStart);
    if (token.startsWith('./') || token.startsWith('../') || token.startsWith('~/')) return true;
    if (token.startsWith('/') && token.length > 1) return true;
    if (token.includes('/') && !token.startsWith('http://') && !token.startsWith('https://')) {
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // LRU cache
  // ---------------------------------------------------------------------------

  private lruGet(key: string): string | undefined {
    const value = this.lru.get(key);
    if (value === undefined) return undefined;
    // Refresh recency: delete + re-insert moves to end of iteration order.
    this.lru.delete(key);
    this.lru.set(key, value);
    return value;
  }

  private lruSet(key: string, value: string): void {
    if (this.lru.has(key)) this.lru.delete(key);
    this.lru.set(key, value);
    while (this.lru.size > CACHE_MAX_SIZE) {
      const oldest = this.lru.keys().next();
      if (oldest.done === true) break;
      this.lru.delete(oldest.value);
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  private clearTimers(): void {
    this.clearInlineTimer();
    this.clearSuggestTimer();
  }

  private clearInlineTimer(): void {
    if (this.inlineTimer !== undefined) {
      clearTimeout(this.inlineTimer);
      this.inlineTimer = undefined;
    }
  }

  private clearSuggestTimer(): void {
    if (this.suggestTimer !== undefined) {
      clearTimeout(this.suggestTimer);
      this.suggestTimer = undefined;
    }
  }

  private abortInFlight(): void {
    this.abortController?.abort();
    this.abortController = undefined;
  }
}
