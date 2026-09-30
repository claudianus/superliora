/**
 * The Shiki module graph costs ~200ms of startup CPU (TextMate grammar
 * parsing). A CLI run that never renders a code block — `--version`, `--help`,
 * a config command — must not pay it, so the warm-up is triggered by the first
 * highlight request instead of by importing the highlight module.
 *
 * The dynamic `import()` below is the point of the test: it re-enters the
 * module graph on purpose to observe which side effects run at import time, so
 * a static import cannot express it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const shikiState = vi.hoisted(() => ({ createHighlighterCalls: 0 }));

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('shiki');
  vi.doUnmock('shiki/engine/javascript');
  vi.resetModules();
});

describe('lazy Shiki warm-up', () => {
  it('loads the highlighter on the first highlight, never on import', async () => {
    vi.doMock('shiki', () => ({
      createHighlighter: () => {
        shikiState.createHighlighterCalls += 1;
        return Promise.resolve({
          loadTheme: () => Promise.resolve(),
          getLoadedLanguages: () => [],
          getLoadedThemes: () => [],
          codeToTokens: () => ({ tokens: [] }),
        });
      },
    }));
    vi.doMock('shiki/engine/javascript', () => ({
      createJavaScriptRegexEngine: () => ({}),
    }));
    vi.resetModules();
    shikiState.createHighlighterCalls = 0;

    const mod = await import('#/tui/components/media/code-highlight');

    // The warm-up is deferred a tick: draining the timer queue proves that
    // importing the module never scheduled it.
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(0);
    expect(shikiState.createHighlighterCalls).toBe(0);

    mod.highlightLines('const answer = 42;', 'typescript');
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => {
      expect(shikiState.createHighlighterCalls).toBe(1);
    });
  });
});