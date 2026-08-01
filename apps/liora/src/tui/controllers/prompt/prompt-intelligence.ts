import type { Session } from '@superliora/sdk';

import { isExperimentalFlagEnabled } from '#/tui/commands/experimental-flags';

import type { AppState } from '../../types';
import type { TUIState } from '../../tui-state';
import {
  isSameEffectiveModel,
  resolveModelRouteIdentity,
} from '../../utils/model/model-route-notice';

/** Debounce before requesting an inline completion after the last keystroke. */
const INLINE_DEBOUNCE_MS = 450;
/** Debounce before requesting next-task suggestions when the editor is empty. */
const SUGGEST_DEBOUNCE_MS = 1200;
/**
 * Minimum characters of typed prose before we ask the model for a continuation.
 * Higher than a few keystrokes so we do not fire on every short phrase.
 */
const INLINE_REQUEST_MIN_CHARS = 12;
/**
 * Minimum length of a model completion we will paint as ghost text.
 * Keep low so short useful continuations still show after a successful call.
 */
const INLINE_SHOW_MIN_CHARS = 2;
/** Dim placeholder shown after the cursor while an inline request is in flight. */
const INLINE_PENDING_GHOST = '…';
/** Maximum entries in the inline-completion LRU cache. */
const CACHE_MAX_SIZE = 32;
/**
 * Minimum characters the user must *add* since the last successful or attempted
 * inline request before we spend another LLM call (reduces thrash while editing).
 */
const INLINE_MIN_CHARS_SINCE_LAST = 4;
/** Cooldown after an empty/failed completion before retrying the same prefix family. */
const INLINE_EMPTY_COOLDOWN_MS = 8_000;
/** Max in-flight inline requests per rolling minute (hard cost cap). */
const INLINE_MAX_REQUESTS_PER_MINUTE = 12;

export interface PromptIntelligenceHost {
  state: TUIState;
  session: Session | undefined;
  track(event: string, props?: Record<string, unknown>): void;
  setAppState(patch: Partial<AppState>): void;
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
  /** Last completion-role model we already announced (avoid notice spam). */
  private lastSurfacedCompletionModel: string | undefined;
  /** Simple LRU: Map iteration order is insertion order; evict oldest. */
  private readonly lru = new Map<string, string>();
  /** Generation counter so stale async results cannot clear a newer phase. */
  private requestGeneration = 0;
  private activePhase: 'idle' | 'inline' | 'suggest' = 'idle';
  /** Prefix length at last inline request (for delta gating). */
  private lastInlinePrefixLen = 0;
  /** Wall time of last empty completion (ms). */
  private lastEmptyInlineAt = 0;
  /** Timestamps of recent inline RPC starts for per-minute budget. */
  private inlineRequestTimes: number[] = [];
  /** True after at least one idle→suggest cycle this idle window. */
  private suggestIssuedForIdle = false;

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
    if (this.suggestIssuedForIdle) return;
    this.scheduleSuggestion();
  }

  dispose(): void {
    this.clearTimers();
    this.abortInFlight();
    this.setPhase('idle');
  }

  // ---------------------------------------------------------------------------
  // Editor change → inline completion / suggestion routing
  // ---------------------------------------------------------------------------

  private handleEditorChange(text: string): void {
    // New keystrokes supersede any in-flight prediction; the editor already
    // clears real ghost text, but abort the RPC so we do not paint a stale hit.
    this.abortInFlight();
    if (text.length === 0) {
      this.clearInlineTimer();
      // Empty editor after a turn: allow one suggest cycle (notifyIdle may also fire).
      this.scheduleSuggestion();
    } else {
      this.suggestIssuedForIdle = false;
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
    if (!this.canRequestIntelligence()) return;

    const editor = this.host.state.editor;
    const text = editor.getText();
    if (text.trim().length < INLINE_REQUEST_MIN_CHARS) return;
    if (this.isAutocompleteTrigger(text)) return;
    if (!this.looksLikeProseDraft(text)) return;
    if (!this.shouldSpendInlineBudget(text)) return;

    // Cache key: text before the cursor (the prefix the completion extends).
    // This gives cache hits when the user backspaces to a previous prefix.
    const cursor = editor.getCursor();
    const lines = text.split('\n');
    const prefix = (
      lines.slice(0, cursor.line).join('\n') +
      (cursor.line > 0 ? '\n' : '') +
      (lines[cursor.line] ?? '').slice(0, cursor.col)
    ).trimEnd();
    const cacheKey = prefix;
    const cached = this.lruGet(cacheKey);
    if (cached !== undefined) {
      if (cached.length >= INLINE_SHOW_MIN_CHARS) editor.setGhostText(cached, 'inline');
      return;
    }

    this.abortInFlight();
    const ac = new AbortController();
    this.abortController = ac;
    const generation = ++this.requestGeneration;
    this.setPhase('inline');
    this.noteInlineRequestStart(text);
    // Immediate visual feedback so the user knows a prediction is in flight.
    if (editor.getGhostText?.() === undefined) {
      editor.setGhostText(INLINE_PENDING_GHOST, 'inline');
    }

    try {
      const session = this.host.session;
      if (session === undefined) return;
      const result = await session.inlineComplete({
        text,
        cursorLine: cursor.line,
        cursorCol: cursor.col,
        signal: ac.signal,
      });
      if (ac.signal.aborted || generation !== this.requestGeneration) return;
      // Guard: editor state may have changed while the request was in flight.
      if (editor.getText() !== text) return;
      if (editor.isShowingAutocomplete()) return;

      const completion = result.completion.trimEnd();
      this.lruSet(cacheKey, completion);
      if (completion.length < INLINE_SHOW_MIN_CHARS) {
        this.lastEmptyInlineAt = Date.now();
      }
      if (completion.length >= INLINE_SHOW_MIN_CHARS) {
        // Prefer a leading space when the model returns a bare word continuation
        // so Tab acceptance does not glue tokens together.
        const ghost =
          completion.startsWith(' ') || completion.startsWith('\n') || prefix.endsWith(' ')
            ? completion
            : prefix.length > 0 && !/\s$/.test(prefix)
              ? ` ${completion}`
              : completion;
        editor.setGhostText(ghost, 'inline');
      } else if (editor.getGhostText?.() === INLINE_PENDING_GHOST) {
        editor.setGhostText(undefined, 'inline');
      }
      this.maybeSurfaceCompletionModel(result.modelAlias, 'inline');
    } catch (error) {
      // AbortError is expected when a newer keystroke cancels the in-flight
      // request — do not surface it.  Genuine failures go to stderr so they
      // stay out of the TUI render surface.
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        process.stderr.write(`[prompt-intelligence] inline completion failed: ${String(error)}\n`);
        if (editor.getGhostText?.() === INLINE_PENDING_GHOST) {
          editor.setGhostText(undefined, 'inline');
        }
      }
    } finally {
      if (this.abortController === ac) this.abortController = undefined;
      if (generation === this.requestGeneration) this.setPhase('idle');
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
    const generation = ++this.requestGeneration;
    this.setPhase('suggest');
    this.suggestIssuedForIdle = true;

    try {
      const session = this.host.session;
      if (session === undefined) return;
      const result = await session.suggestPrompts({ signal: ac.signal });
      if (ac.signal.aborted || generation !== this.requestGeneration) return;
      if (editor.getText().length > 0) return;
      if (editor.isShowingAutocomplete()) return;

      if (result.suggestions.length > 0) {
        this.suggestionCache = result.suggestions;
        this.suggestionIndex = 0;
        editor.setGhostText(this.suggestionCache[0], 'suggestion');
      }
      this.maybeSurfaceCompletionModel(result.modelAlias, 'suggest');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        process.stderr.write(`[prompt-intelligence] suggestion request failed: ${String(error)}\n`);
      }
    } finally {
      if (this.abortController === ac) this.abortController = undefined;
      if (generation === this.requestGeneration) this.setPhase('idle');
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

  /**
   * Ghost completions are for natural-language prompts, not identifiers,
   * shell-ish tokens, or unfinished code fences.
   */
  private looksLikeProseDraft(text: string): boolean {
    const editor = this.host.state.editor;
    const cursor = editor.getCursor();
    const lines = text.split('\n');
    const line = lines[cursor.line] ?? '';
    const before = line.slice(0, cursor.col).trimEnd();
    if (before.length < INLINE_REQUEST_MIN_CHARS) return false;
    // Require at least one whitespace so single tokens / filenames do not fire.
    if (!/\s/.test(before)) return false;
    // Skip path-only fragments.
    if (/^\s*[\w./-]+$/.test(before) && before.includes('/')) return false;
    // Skip open code fence contexts.
    const fenceCount = (text.match(/```/g) ?? []).length;
    if (fenceCount % 2 === 1) return false;
    return true;
  }

  private shouldSpendInlineBudget(text: string): boolean {
    const now = Date.now();
    // Per-minute hard cap.
    this.inlineRequestTimes = this.inlineRequestTimes.filter((t) => now - t < 60_000);
    if (this.inlineRequestTimes.length >= INLINE_MAX_REQUESTS_PER_MINUTE) return false;

    // Cooldown after empty model replies (same session).
    if (this.lastEmptyInlineAt > 0 && now - this.lastEmptyInlineAt < INLINE_EMPTY_COOLDOWN_MS) {
      return false;
    }

    // Require meaningful growth since last request to avoid re-query on thrash.
    const len = text.trim().length;
    if (
      this.lastInlinePrefixLen > 0 &&
      Math.abs(len - this.lastInlinePrefixLen) < INLINE_MIN_CHARS_SINCE_LAST
    ) {
      return false;
    }
    return true;
  }

  private noteInlineRequestStart(text: string): void {
    this.lastInlinePrefixLen = text.trim().length;
    this.inlineRequestTimes.push(Date.now());
  }

  private setPhase(phase: 'idle' | 'inline' | 'suggest'): void {
    if (this.activePhase === phase) return;
    this.activePhase = phase;
    const current = this.host.state.appState.promptIntelligencePhase ?? 'idle';
    if (current === phase) return;
    this.host.setAppState({ promptIntelligencePhase: phase });
  }

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


  /**
   * Track the completion-role model when it differs from the session main model.
   * Ghost autocomplete fires often — keep this quiet in the transcript.
   */
  private maybeSurfaceCompletionModel(
    modelAlias: string | undefined,
    purpose: 'inline' | 'suggest',
  ): void {
    if (modelAlias === undefined || modelAlias.length === 0) return;
    const sessionModel = this.host.state.appState.model;
    if (sessionModel.length === 0) return;
    if (modelAlias === sessionModel) return;
    const models = this.host.state.appState.availableModels;
    // Same underlying model under a different alias/display — do not notify.
    if (
      isSameEffectiveModel(
        resolveModelRouteIdentity(sessionModel, models),
        resolveModelRouteIdentity(modelAlias, models),
      )
    ) {
      return;
    }
    if (this.lastSurfacedCompletionModel === modelAlias) {
      // Still refresh the footer badge clock so the glow stays visible.
      const prev = this.host.state.appState.lastModelRouteNotice;
      if (
        prev !== undefined &&
        prev !== null &&
        prev.toAlias === modelAlias &&
        prev.reason?.startsWith('completion')
      ) {
        this.host.setAppState({
          lastModelRouteNotice: { ...prev, atMs: Date.now() },
        });
      }
      return;
    }
    this.lastSurfacedCompletionModel = modelAlias;

    this.host.setAppState({
      lastModelRouteNotice: {
        kind: 'selection',
        fromAlias: sessionModel,
        toAlias: modelAlias,
        reason: `completion:${purpose}`,
        atMs: Date.now(),
      },
    });
    this.host.track('prompt_intelligence_model', {
      model_alias: modelAlias,
      session_model: sessionModel,
      purpose,
    });
  }

  private abortInFlight(): void {
    if (this.abortController === undefined) return;
    this.abortController.abort();
    this.abortController = undefined;
    // Invalidate in-flight finally blocks so they cannot paint or clear phase
    // after a newer keystroke has already taken ownership.
    this.requestGeneration += 1;
    this.setPhase('idle');
  }
}
