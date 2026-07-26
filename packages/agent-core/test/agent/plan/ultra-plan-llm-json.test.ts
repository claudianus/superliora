import { describe, expect, it } from 'vitest';

import {
  extractJsonFromText,
  extractTextFromLLMResponse,
  parseJsonFromLLMResponse,
} from '#/agent/plan/ultra-plan-llm-json';

describe('agent/plan/ultra-plan-llm-json — JSON extraction helpers', () => {
  describe('extractTextFromLLMResponse', () => {
    it('returns the first text part from a response', () => {
      const response = {
        message: {
          content: [
            { type: 'text', text: 'hello world' },
            { type: 'text', text: 'ignored' },
          ],
        },
      };
      expect(extractTextFromLLMResponse(response)).toBe('hello world');
    });

    it('returns empty string when no message is present', () => {
      expect(extractTextFromLLMResponse({})).toBe('');
      expect(extractTextFromLLMResponse({ message: {} })).toBe('');
    });

    it('returns empty string when no text parts exist', () => {
      const response = {
        message: {
          content: [{ type: 'image' }, { type: 'tool_use' }],
        },
      };
      expect(extractTextFromLLMResponse(response)).toBe('');
    });
  });

  describe('extractJsonFromText', () => {
    it('unwraps a ```json fenced block', () => {
      const text = '```json\n{"a": 1, "b": [2, 3]}\n```';
      expect(extractJsonFromText(text)).toBe('{"a": 1, "b": [2, 3]}');
    });

    it('unwraps a plain ``` fenced block (no language tag)', () => {
      const text = '```\n{"k":"v"}\n```';
      expect(extractJsonFromText(text)).toBe('{"k":"v"}');
    });

    it('extracts a JSON object embedded in surrounding text', () => {
      const text = 'noise before {"x": 1, "y": "z"} noise after';
      expect(extractJsonFromText(text)).toBe('{"x": 1, "y": "z"}');
    });

    it('returns null when no JSON object braces are present', () => {
      expect(extractJsonFromText('just plain text, no braces')).toBeNull();
    });

    it('returns null when opening brace has no matching close', () => {
      expect(extractJsonFromText('oops {')).toBeNull();
    });
  });

  describe('parseJsonFromLLMResponse', () => {
    it('parses a valid JSON object out of a fenced response', () => {
      const response = {
        message: { content: [{ type: 'text', text: '```json\n{"answer": 42}\n```' }] },
      };
      expect(parseJsonFromLLMResponse(response)).toEqual({ answer: 42 });
    });

    it('parses a JSON object embedded in surrounding prose', () => {
      const response = {
        message: { content: [{ type: 'text', text: 'preface {"k": [1,2]} trailing' }] },
      };
      expect(parseJsonFromLLMResponse(response)).toEqual({ k: [1, 2] });
    });

    it('returns null when no JSON object can be found', () => {
      const response = {
        message: { content: [{ type: 'text', text: 'no braces here' }] },
      };
      expect(parseJsonFromLLMResponse(response)).toBeNull();
    });

    it('returns null when the extracted JSON is malformed', () => {
      const response = {
        message: { content: [{ type: 'text', text: '{"a": ,}' }] },
      };
      expect(parseJsonFromLLMResponse(response)).toBeNull();
    });

    it('returns null when the response has no text content', () => {
      expect(parseJsonFromLLMResponse({ message: {} })).toBeNull();
    });
  });
});
