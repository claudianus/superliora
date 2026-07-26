import { describe, expect, it } from 'vitest';

import {
  extractJsonFromText,
  extractTextFromLLMResponse,
  parseJsonFromLLMResponse,
} from '../../../src/agent/plan/ultra-plan-llm-json';

describe('plan/ultra-plan-llm-json.ts — extractTextFromLLMResponse', () => {
  it('returns the first text part of an LLM response', () => {
    const r = {
      message: {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: 'world' },
        ],
      },
    };
    expect(extractTextFromLLMResponse(r)).toBe('hello');
  });

  it('returns an empty string for a malformed response', () => {
    expect(extractTextFromLLMResponse({})).toBe('');
    expect(extractTextFromLLMResponse({ message: { content: [] } })).toBe('');
    // `null` / `undefined` responses are not a documented input — the
    // caller is expected to provide a valid LLM response shape.
  });
});

describe('plan/ultra-plan-llm-json.ts — extractJsonFromText', () => {
  it('strips a leading and trailing ```json``` fence', () => {
    const text = '```json\n{"a": 1}\n```';
    expect(extractJsonFromText(text)).toBe('{"a": 1}');
  });

  it('strips a bare ``` fence too', () => {
    const text = '```\n{"a": 1}\n```';
    expect(extractJsonFromText(text)).toBe('{"a": 1}');
  });

  it('falls back to the first { ... } substring when no fence is present', () => {
    const text = 'preface {"a": 1, "b": 2} trailing';
    expect(extractJsonFromText(text)).toBe('{"a": 1, "b": 2}');
  });

  it('returns null when no { ... } substring is found', () => {
    expect(extractJsonFromText('plain text without braces')).toBeNull();
  });

  it('returns null when the brace order is wrong (end < start)', () => {
    expect(extractJsonFromText('}{')).toBeNull();
  });
});

describe('plan/ultra-plan-llm-json.ts — parseJsonFromLLMResponse', () => {
  it('returns the parsed object for a clean response', () => {
    const r = { message: { content: [{ type: 'text', text: '{"k": 42}' }] } };
    expect(parseJsonFromLLMResponse(r)).toEqual({ k: 42 });
  });

  it('returns null when the embedded JSON is malformed', () => {
    const r = { message: { content: [{ type: 'text', text: '{"k": }' }] } };
    expect(parseJsonFromLLMResponse(r)).toBeNull();
  });

  it('returns null when no JSON can be found at all', () => {
    const r = { message: { content: [{ type: 'text', text: 'no json' }] } };
    expect(parseJsonFromLLMResponse(r)).toBeNull();
  });
});
