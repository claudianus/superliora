import { describe, expect, it } from 'vitest';

import {
  AutocompleteEngine,
  DEFAULT_SNIPPETS,
  createSnippetProvider,
  expandSnippetBody,
  type Snippet,
} from '#/tui/utils/autocomplete-engine';

// ---------------------------------------------------------------------------
// expandSnippetBody
// ---------------------------------------------------------------------------

describe('expandSnippetBody', () => {
  it('returns text unchanged and cursor at end when there are no tabstops', () => {
    const result = expandSnippetBody('hello world');
    expect(result.text).toBe('hello world');
    expect(result.cursorOffset).toBe('hello world'.length);
  });

  it('expands ${1:default} and places cursor at the default start', () => {
    const result = expandSnippetBody('Fix: ${1:issue description}');
    expect(result.text).toBe('Fix: issue description');
    expect(result.cursorOffset).toBe('Fix: '.length);
  });

  it('expands bare $1 to empty string and places cursor there', () => {
    const result = expandSnippetBody('Explain $1 now');
    expect(result.text).toBe('Explain  now');
    expect(result.cursorOffset).toBe('Explain '.length);
  });

  it('places cursor at the lowest-numbered tabstop among several', () => {
    const result = expandSnippetBody('${2:second} and ${1:first}');
    expect(result.text).toBe('second and first');
    // cursor at start of "first" (lowest number = 1)
    expect(result.cursorOffset).toBe('second and '.length);
  });

  it('handles mixed ${n:default} and bare $n forms', () => {
    const result = expandSnippetBody('a ${1:alpha} b $2 c');
    expect(result.text).toBe('a alpha b  c');
    expect(result.cursorOffset).toBe('a '.length);
  });

  it('handles empty default in ${1:}', () => {
    const result = expandSnippetBody('start ${1:} end');
    expect(result.text).toBe('start  end');
    expect(result.cursorOffset).toBe('start '.length);
  });

  it('handles multiline body', () => {
    const body = 'Line1: ${1:one}\nLine2: ${2:two}';
    const result = expandSnippetBody(body);
    expect(result.text).toBe('Line1: one\nLine2: two');
    expect(result.cursorOffset).toBe('Line1: '.length);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SNIPPETS
// ---------------------------------------------------------------------------

describe('DEFAULT_SNIPPETS', () => {
  it('contains the four built-in prefixes', () => {
    const prefixes = DEFAULT_SNIPPETS.map((s) => s.prefix);
    expect(prefixes).toContain('fix');
    expect(prefixes).toContain('test');
    expect(prefixes).toContain('review');
    expect(prefixes).toContain('explain');
  });

  it('every body expands without throwing and produces non-empty text', () => {
    for (const snippet of DEFAULT_SNIPPETS) {
      const result = expandSnippetBody(snippet.body);
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.cursorOffset).toBeGreaterThanOrEqual(0);
      expect(result.cursorOffset).toBeLessThanOrEqual(result.text.length);
    }
  });
});

// ---------------------------------------------------------------------------
// createSnippetProvider
// ---------------------------------------------------------------------------

const TEST_SNIPPETS: readonly Snippet[] = [
  { prefix: 'fix', body: 'Fix: ${1:what}', description: 'Bug template' },
  { prefix: 'fixture', body: 'Create fixture for ${1:name}' },
  { prefix: 'hotfix', body: 'Hotfix: ${1:issue}' },
  { prefix: 'review', body: 'Review ${1:file}' },
];

function makeContext(word: string, contextType: 'general' | 'command' | 'slash' | 'path' = 'general') {
  return {
    input: word,
    cursor: word.length,
    word,
    wordStart: 0,
    contextType,
    isFirstWord: true,
  };
}

describe('createSnippetProvider', () => {
  const provider = createSnippetProvider(() => TEST_SNIPPETS);

  it('returns items whose prefix includes the query', () => {
    const items = provider.getCompletions(makeContext('fix'));
    const prefixes = items.map((i) => i.text);
    expect(prefixes).toContain('fix');
    expect(prefixes).toContain('fixture');
  });

  it('returns empty array for empty query', () => {
    expect(provider.getCompletions(makeContext(''))).toEqual([]);
  });

  it('returns empty array for slash context', () => {
    expect(provider.getCompletions(makeContext('fix', 'slash'))).toEqual([]);
  });

  it('returns empty array for path context', () => {
    expect(provider.getCompletions(makeContext('fix', 'path'))).toEqual([]);
  });

  it('scores prefix-start matches higher than substring matches', () => {
    const items = provider.getCompletions(makeContext('fix'));
    const fix = items.find((i) => i.text === 'fix');
    const hotfix = items.find((i) => i.text === 'hotfix');
    expect(fix?.score).toBeGreaterThan(hotfix?.score ?? 0);
  });

  it('carries the snippet body in the expansion field', () => {
    const items = provider.getCompletions(makeContext('review'));
    const review = items.find((i) => i.text === 'review');
    expect(review?.expansion).toBe('Review ${1:file}');
  });

  it('sets source to snippet', () => {
    const items = provider.getCompletions(makeContext('fix'));
    for (const item of items) {
      expect(item.source).toBe('snippet');
    }
  });
});

// ---------------------------------------------------------------------------
// AutocompleteEngine.acceptWithExpansion
// ---------------------------------------------------------------------------

describe('AutocompleteEngine.acceptWithExpansion', () => {
  function engineWithSnippets(snippets: readonly Snippet[]) {
    const engine = new AutocompleteEngine();
    engine.registerProvider(createSnippetProvider(() => snippets));
    return engine;
  }

  it('returns null when engine is inactive', () => {
    const engine = new AutocompleteEngine();
    expect(engine.acceptWithExpansion()).toBeNull();
  });

  it('expands a snippet and places cursor at first tabstop', () => {
    const engine = engineWithSnippets(TEST_SNIPPETS);
    engine.complete('fix', 3);
    const result = engine.acceptWithExpansion();
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Fix: what');
    expect(result!.cursor).toBe('Fix: '.length);
  });

  it('places cursor after inserted text for non-snippet items', () => {
    const engine = new AutocompleteEngine();
    engine.registerProvider({
      source: 'command',
      priority: 80,
      getCompletions: (ctx) =>
        ctx.word === 'hel'
          ? [{ text: 'help', display: 'help', source: 'command' as const, score: 90, replaceStart: 0, replaceEnd: 3 }]
          : [],
    });
    engine.complete('hel', 3);
    const result = engine.acceptWithExpansion();
    expect(result).not.toBeNull();
    expect(result!.text).toBe('help');
    expect(result!.cursor).toBe(4);
  });

  it('preserves text after the cursor', () => {
    const engine = engineWithSnippets(TEST_SNIPPETS);
    // input: "fix please" with cursor after "fix"
    engine.complete('fix please', 3);
    const result = engine.acceptWithExpansion();
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Fix: what please');
    expect(result!.cursor).toBe('Fix: '.length);
  });

  it('dismisses the engine after accepting', () => {
    const engine = engineWithSnippets(TEST_SNIPPETS);
    engine.complete('fix', 3);
    engine.acceptWithExpansion();
    expect(engine.isActive).toBe(false);
  });

  it('records usage for recency bonus', () => {
    const engine = engineWithSnippets(TEST_SNIPPETS);
    engine.complete('fix', 3);
    engine.acceptWithExpansion();
    // Second completion should still work (recency recorded internally)
    const state = engine.complete('fix', 3);
    expect(state.active).toBe(true);
  });
});
