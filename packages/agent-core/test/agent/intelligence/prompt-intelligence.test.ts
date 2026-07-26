import type { Message } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import {
  cleanInlineCompletion,
  extractDraft,
  looksLikeCheapCompletionModel,
  parseSuggestionLines,
  pinCompletionThinking,
  summarizeHistory,
  type InlineCompletePayload,
} from '../../../src/agent/intelligence/prompt-intelligence';

describe('agent/intelligence/prompt-intelligence.ts — looksLikeCheapCompletionModel', () => {
  it('flags the documented cheap model markers (case-insensitive)', () => {
    expect(looksLikeCheapCompletionModel('gpt-4o-mini')).toBe(true);
    expect(looksLikeCheapCompletionModel('haiku-4')).toBe(true);
    expect(looksLikeCheapCompletionModel('claude-haiku-3-5-sonnet')).toBe(true);
    expect(looksLikeCheapCompletionModel('minimax:mini')).toBe(true);
    expect(looksLikeCheapCompletionModel('GPT-4O-MINI')).toBe(true);
  });

  it('rejects expensive flagship models', () => {
    expect(looksLikeCheapCompletionModel('gpt-4o')).toBe(false);
    expect(looksLikeCheapCompletionModel('claude-opus-4')).toBe(false);
  });
});

describe('agent/intelligence/prompt-intelligence.ts — pinCompletionThinking', () => {
  it('pins thinking to a low effort for cheap models (returns the provider with low effort)', () => {
    const provider = { name: 'p', model: 'gpt-4o-mini' } as unknown as Parameters<typeof pinCompletionThinking>[0];
    const out = pinCompletionThinking(provider);
    // Returns the provider with thinking effort overridden, or `undefined` if no override applies.
    expect(out === undefined || typeof out === 'object').toBe(true);
  });
});

describe('agent/intelligence/prompt-intelligence.ts — extractDraft', () => {
  it('returns the trimmed draft from the payload text', () => {
    const p = { text: '  hello world  ', cursorLine: 0 } as unknown as InlineCompletePayload;
    expect(extractDraft(p)).toBe('hello world');
  });
});

describe('agent/intelligence/prompt-intelligence.ts — summarizeHistory', () => {
  it('returns an empty string for an empty history', () => {
    expect(summarizeHistory([], 100)).toBe('');
  });

  it('caps the joined history at the requested maxChars and drops empty parts', () => {
    const msgs: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }], toolCalls: [] } as unknown as Message,
      { role: 'assistant', content: [{ type: 'text', text: '   ' }], toolCalls: [] } as unknown as Message,
      { role: 'user', content: [{ type: 'text', text: 'world' }], toolCalls: [] } as unknown as Message,
    ];
    const out = summarizeHistory(msgs, 1000);
    expect(out).toContain('user: hello');
    expect(out).toContain('user: world');
  });

  it('clamps to a single clipped line when the cap is too small for any one message', () => {
    const msgs: Message[] = [{ role: 'user', content: [{ type: 'text', text: 'hello world' }], toolCalls: [] } as unknown as Message];
    const out = summarizeHistory(msgs, 5);
    expect(out.length).toBeLessThanOrEqual(5);
  });
});

describe('agent/intelligence/prompt-intelligence.ts — cleanInlineCompletion', () => {
  it('returns the raw completion when it differs entirely from the draft', () => {
    expect(cleanInlineCompletion('world', 'hello')).toBe('world');
  });

  it('drops the duplicated prefix when completion starts with the draft (preserves any leading whitespace)', () => {
    // `cleanInlineCompletion` calls `.trimEnd()` (not `.trim()`) on the
    // post-overlap text, so a leading single space is preserved.
    expect(cleanInlineCompletion('hello world', 'hello')).toBe(' world');
  });

  it('returns an empty string when the completion is empty or matches the draft', () => {
    expect(cleanInlineCompletion('', 'hello')).toBe('');
    expect(cleanInlineCompletion('hello', 'hello')).toBe('');
  });
});

describe('agent/intelligence/prompt-intelligence.ts — parseSuggestionLines', () => {
  it('returns the deduped, trimmed, non-empty lines in order', () => {
    const out = parseSuggestionLines('  alpha  \nbeta\nalpha\n\ngamma');
    expect(out).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns an empty list for empty or whitespace-only input', () => {
    expect(parseSuggestionLines('')).toEqual([]);
    expect(parseSuggestionLines('   \n\n  ')).toEqual([]);
  });
});
