import { describe, expect, it, vi } from 'vitest';

import {
  cleanInlineCompletion,
  extractDraft,
  MAX_SUGGESTIONS,
  parseSuggestionLines,
  PromptIntelligenceService,
  summarizeHistory,
} from '../../../src/agent/intelligence/prompt-intelligence';
import type { Agent } from '../../../src/agent';
import type { Message } from '@superliora/kosong';

// ---------------------------------------------------------------------------
// extractDraft
// ---------------------------------------------------------------------------

describe('extractDraft', () => {
  it('returns text up to the cursor on a single line', () => {
    // extractDraft includes trailing text after cursor for bridging
    const draft = extractDraft({ text: 'hello world', cursorLine: 0, cursorCol: 5 });
    expect(draft).toContain('hello');
  });

  it('includes trailing text after cursor for bridging', () => {
    const draft = extractDraft({ text: 'hello world', cursorLine: 0, cursorCol: 5 });
    expect(draft).toContain('hello');
  });

  it('handles multiline text with cursor on second line', () => {
    const draft = extractDraft({ text: 'first\nsecond line', cursorLine: 1, cursorCol: 6 });
    expect(draft).toContain('second');
  });

  it('clamps out-of-range cursor positions', () => {
    expect(extractDraft({ text: 'abc', cursorLine: 5, cursorCol: 99 })).toBe('abc');
    // cursorCol -1 clamps to 0 → before is empty, after is 'abc'
    expect(extractDraft({ text: 'abc', cursorLine: -1, cursorCol: -1 })).toBe('abc');
  });

  it('returns empty for empty text', () => {
    expect(extractDraft({ text: '', cursorLine: 0, cursorCol: 0 })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// summarizeHistory
// ---------------------------------------------------------------------------

function msg(role: 'user' | 'assistant', text: string): Message {
  return { role, content: [{ type: 'text', text }], toolCalls: [] };
}

describe('summarizeHistory', () => {
  it('returns empty for no messages', () => {
    expect(summarizeHistory([], 1000)).toBe('');
  });

  it('skips system messages', () => {
    const messages: Message[] = [
      { role: 'system', content: [{ type: 'text', text: 'system prompt' }], toolCalls: [] },
      msg('user', 'hello'),
    ];
    const result = summarizeHistory(messages, 1000);
    expect(result).not.toContain('system prompt');
    expect(result).toContain('user: hello');
  });

  it('keeps most recent messages within budget', () => {
    const messages = [msg('user', 'old message'), msg('assistant', 'new message')];
    const result = summarizeHistory(messages, 1000);
    expect(result).toContain('new message');
  });

  it('truncates long messages', () => {
    const longText = 'x'.repeat(1000);
    const result = summarizeHistory([msg('user', longText)], 500);
    expect(result.length).toBeLessThanOrEqual(500);
  });

  it('respects maxChars budget', () => {
    const messages = Array.from({ length: 20 }, (_, i) => msg('user', `message ${i} with some content`));
    const result = summarizeHistory(messages, 200);
    expect(result.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// cleanInlineCompletion
// ---------------------------------------------------------------------------

describe('cleanInlineCompletion', () => {
  it('returns empty for empty input', () => {
    expect(cleanInlineCompletion('', 'draft')).toBe('');
    expect(cleanInlineCompletion('   ', 'draft')).toBe('');
  });

  it('cuts at first newline (single-line ghost)', () => {
    expect(cleanInlineCompletion('first line\nsecond line', 'draft')).toBe('first line');
  });

  it('strips wrapping double quotes', () => {
    expect(cleanInlineCompletion('"hello world"', 'draft')).toBe('hello world');
  });

  it('strips wrapping single quotes', () => {
    expect(cleanInlineCompletion("'hello world'", 'draft')).toBe('hello world');
  });

  it('strips wrapping backticks', () => {
    expect(cleanInlineCompletion('`hello world`', 'draft')).toBe('hello world');
  });

  it('strips markdown code fences', () => {
    expect(cleanInlineCompletion('```\nhello\n```', 'draft')).toBe('hello');
  });

  it('drops draft overlap prefix', () => {
    // Model re-emitted the tail of what the user typed
    expect(cleanInlineCompletion('hello world', 'hello')).toBe(' world');
  });

  it('trims trailing whitespace', () => {
    expect(cleanInlineCompletion('hello   ', 'draft')).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// parseSuggestionLines
// ---------------------------------------------------------------------------

describe('parseSuggestionLines', () => {
  it('parses plain lines', () => {
    expect(parseSuggestionLines('fix the bug\nadd tests')).toEqual(['fix the bug', 'add tests']);
  });

  it('strips numbering prefixes', () => {
    expect(parseSuggestionLines('1. fix bug\n2) add tests')).toEqual(['fix bug', 'add tests']);
  });

  it('strips bullet prefixes', () => {
    expect(parseSuggestionLines('- fix bug\n* add tests\n• refactor')).toEqual([
      'fix bug',
      'add tests',
      'refactor',
    ]);
  });

  it('strips wrapping quotes', () => {
    expect(parseSuggestionLines('"fix the bug"')).toEqual(['fix the bug']);
  });

  it('deduplicates case-insensitively', () => {
    expect(parseSuggestionLines('Fix Bug\nfix bug\nFIX BUG')).toEqual(['Fix Bug']);
  });

  it('caps at MAX_SUGGESTIONS', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `task ${i}`).join('\n');
    expect(parseSuggestionLines(lines)).toHaveLength(MAX_SUGGESTIONS);
  });

  it('skips empty lines', () => {
    expect(parseSuggestionLines('a\n\n\nb')).toEqual(['a', 'b']);
  });

  it('returns empty for empty input', () => {
    expect(parseSuggestionLines('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PromptIntelligenceService (flag gate + provider resolution)
// ---------------------------------------------------------------------------

function fakeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    experimentalFlags: { enabled: () => true, enabledIds: () => [] },
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    kimiConfig: {},
    config: { provider: { withThinking: () => ({ withMaxCompletionTokens: () => ({}) }) } },
    modelProvider: undefined,
    context: { messages: [] },
    generate: vi.fn(),
    ...overrides,
  } as unknown as Agent;
}

describe('PromptIntelligenceService', () => {
  it('returns empty when flag is disabled', async () => {
    const agent = fakeAgent({
      experimentalFlags: { enabled: () => false, enabledIds: () => [] },
    } as unknown as Partial<Agent>);
    const svc = new PromptIntelligenceService(agent);
    expect(await svc.inlineComplete({ text: 'hello', cursorLine: 0, cursorCol: 5 })).toEqual({
      completion: '',
    });
    expect(await svc.suggestPrompts()).toEqual({ suggestions: [] });
  });

  it('returns empty when draft is empty', async () => {
    const svc = new PromptIntelligenceService(fakeAgent());
    expect(await svc.inlineComplete({ text: '', cursorLine: 0, cursorCol: 0 })).toEqual({
      completion: '',
    });
  });

  it('returns completion from generate', async () => {
    const generate = vi.fn().mockResolvedValue({
      message: { content: [{ type: 'text', text: ' world' }] },
      finishReason: 'stop',
      usage: null,
    });
    const agent = fakeAgent({ generate });
    const svc = new PromptIntelligenceService(agent);
    const result = await svc.inlineComplete({ text: 'hello', cursorLine: 0, cursorCol: 5 });
    expect(result.completion).toBe('world');
    expect(generate).toHaveBeenCalledOnce();
  });

  it('returns suggestions from generate', async () => {
    const generate = vi.fn().mockResolvedValue({
      message: { content: [{ type: 'text', text: 'fix the bug\nadd tests' }] },
      finishReason: 'stop',
      usage: null,
    });
    const agent = fakeAgent({ generate });
    const svc = new PromptIntelligenceService(agent);
    const result = await svc.suggestPrompts();
    expect(result.suggestions).toEqual(['fix the bug', 'add tests']);
  });

  it('swallows generate errors and returns empty', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('LLM down'));
    const agent = fakeAgent({ generate });
    const svc = new PromptIntelligenceService(agent);
    expect(await svc.inlineComplete({ text: 'hello', cursorLine: 0, cursorCol: 5 })).toEqual({
      completion: '',
    });
    expect(await svc.suggestPrompts()).toEqual({ suggestions: [] });
  });

  it('uses completionModel alias when configured', async () => {
    const resolveProviderConfig = vi.fn().mockReturnValue({
      provider: { withThinking: () => ({ withMaxCompletionTokens: () => ({}) }) },
    });
    const generate = vi.fn().mockResolvedValue({
      message: { content: [{ type: 'text', text: 'done' }] },
      finishReason: 'stop',
      usage: null,
    });
    const agent = fakeAgent({
      kimiConfig: { loopControl: { completionModel: 'fast-model' } },
      modelProvider: { resolveProviderConfig },
      generate,
    } as unknown as Partial<Agent>);
    const svc = new PromptIntelligenceService(agent);
    await svc.inlineComplete({ text: 'hello', cursorLine: 0, cursorCol: 5 });
    expect(resolveProviderConfig).toHaveBeenCalledWith('fast-model');
  });
});
