import { APIEmptyResponseError, type GenerateResult, type Message, type TokenUsage } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import {
  compactionSummaryMessage,
  emergencyBackstopWarnings,
  extractCompactionSummary,
  formatContextManagementCapability,
  mergeTokenUsage,
  mergeTokenUsageOrNull,
  usageTelemetryProperties,
} from '../../../src/agent/compaction/full-helpers';

function makeUsage(over: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputOther: 0,
    output: 0,
    inputCacheRead: 0,
    inputCacheCreation: 0,
    ...over,
  };
}

function makeGenerateResult(content: GenerateResult['message']['content']): GenerateResult {
  return {
    message: { role: 'assistant', content, toolCalls: [] },
  } as GenerateResult;
}

describe('full-helpers.ts — pure helpers', () => {
  describe('extractCompactionSummary', () => {
    it('passes through a string content as-is (after trim check)', () => {
      const r = makeGenerateResult('  hello world  ');
      expect(extractCompactionSummary(r)).toBe('  hello world  ');
    });

    it('joins all text parts in a content array', () => {
      const r = makeGenerateResult([
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
        // Non-text parts contribute an empty string; they must not throw.
        { type: 'image', image: 'fake' } as unknown as { type: 'text'; text: string },
      ]);
      expect(extractCompactionSummary(r)).toBe('hello world');
    });

    it('throws APIEmptyResponseError when the summary is empty or whitespace', () => {
      expect(() => extractCompactionSummary(makeGenerateResult(''))).toThrow(APIEmptyResponseError);
      expect(() => extractCompactionSummary(makeGenerateResult('   '))).toThrow(
        APIEmptyResponseError,
      );
      expect(() => extractCompactionSummary(makeGenerateResult([]))).toThrow(APIEmptyResponseError);
    });
  });

  describe('mergeTokenUsage / mergeTokenUsageOrNull', () => {
    it('returns next unchanged when current is null', () => {
      const next = makeUsage({ inputOther: 10, output: 5 });
      expect(mergeTokenUsage(null, next)).toEqual(next);
    });

    it('sums every bucket when current is non-null', () => {
      const current = makeUsage({
        inputOther: 10,
        output: 5,
        inputCacheRead: 7,
        inputCacheCreation: 3,
      });
      const next = makeUsage({
        inputOther: 1,
        output: 2,
        inputCacheRead: 3,
        inputCacheCreation: 4,
      });
      expect(mergeTokenUsage(current, next)).toEqual({
        inputOther: 11,
        output: 7,
        inputCacheRead: 10,
        inputCacheCreation: 7,
      });
    });

    it('mergeTokenUsageOrNull returns current when next is null', () => {
      const current = makeUsage({ output: 7 });
      expect(mergeTokenUsageOrNull(current, null)).toEqual(current);
      expect(mergeTokenUsageOrNull(null, null)).toBeNull();
    });

    it('mergeTokenUsageOrNull falls through to mergeTokenUsage when next is non-null', () => {
      const current = makeUsage({ output: 7 });
      const next = makeUsage({ output: 3 });
      expect(mergeTokenUsageOrNull(current, next)).toEqual({ ...current, output: 10 });
    });
  });

  describe('compactionSummaryMessage', () => {
    it('returns an assistant message with the summary wrapped as a text part', () => {
      const m: Message = compactionSummaryMessage('hi');
      expect(m.role).toBe('assistant');
      expect(m.toolCalls).toEqual([]);
      expect(Array.isArray(m.content)).toBe(true);
      if (Array.isArray(m.content)) {
        expect(m.content).toEqual([{ type: 'text', text: 'hi' }]);
      }
    });
  });

  describe('usageTelemetryProperties', () => {
    it('returns empty object when usage is null', () => {
      expect(usageTelemetryProperties(null)).toEqual({});
    });

    it('returns inputTotal(input) and output buckets when usage is provided', () => {
      const usage = makeUsage({ inputOther: 12, inputCacheRead: 3, output: 9 });
      expect(usageTelemetryProperties(usage)).toEqual({
        input_tokens: 15,
        output_tokens: 9,
      });
    });
  });

  describe('formatContextManagementCapability', () => {
    it('returns "none" when the provider has no capability declared', () => {
      expect(
        formatContextManagementCapability({
          // @ts-expect-error — minimal provider shape
          contextManagementCapability: undefined,
        }),
      ).toBe('none');
    });

    it('returns "none" when the capability object declares no enabled flags', () => {
      expect(
        formatContextManagementCapability({
          // @ts-expect-error — minimal provider shape
          contextManagementCapability: {},
        }),
      ).toBe('none');
    });

    it('joins enabled flags in stable order', () => {
      expect(
        formatContextManagementCapability({
          // @ts-expect-error — minimal provider shape
          contextManagementCapability: {
            serverSideCompaction: true,
            toolResultClearing: false,
            thinkingBlockClearing: true,
          },
        }),
      ).toBe('server_side_compaction,thinking_block_clearing');
    });
  });

  describe('emergencyBackstopWarnings', () => {
    it('returns an empty list when the backstop was not used', () => {
      expect(emergencyBackstopWarnings(false)).toEqual([]);
    });

    it('returns the documented warning when the backstop fired', () => {
      expect(emergencyBackstopWarnings(true)).toEqual([
        'emergency extractive backstop used after LLM summarizer failure',
      ]);
    });
  });
});
