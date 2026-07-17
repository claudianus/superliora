import { describe, expect, it, vi } from 'vitest';

import {
  detectUltraworkAutoActivationWithLlm,
  shouldActOnUltraworkAutoActivation,
} from '../../src/ultrawork/auto-activate-llm';

describe('ultrawork auto-activation classifier', () => {
  it('parses activate intent from the classifier response', async () => {
    const intent = await detectUltraworkAutoActivationWithLlm(
      {
        generate: vi.fn(async () => ({
          id: 'gen_test',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '{"should_activate":true,"confidence":0.91,"reason":"Multi-stage product work"}',
              },
            ],
          },
          usage: null,
          finishReason: 'stop',
          rawFinishReason: 'stop',
        })) as never,
        provider: {} as never,
      },
      {
        text: 'Research, plan, implement, verify, and finish this migration autonomously',
      },
    );

    expect(intent).toEqual({
      shouldActivate: true,
      confidence: 0.91,
      reason: 'Multi-stage product work',
    });
    expect(shouldActOnUltraworkAutoActivation(intent)).toBe(true);
  });

  it('rejects low-confidence or declined intents', async () => {
    const declined = await detectUltraworkAutoActivationWithLlm(
      {
        generate: vi.fn(async () => ({
          id: 'gen_test',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '{"should_activate":false,"confidence":0.95,"reason":"Simple question"}',
              },
            ],
          },
          usage: null,
          finishReason: 'stop',
          rawFinishReason: 'stop',
        })) as never,
        provider: {} as never,
      },
      { text: 'what is ultrawork?' },
    );
    expect(shouldActOnUltraworkAutoActivation(declined)).toBe(false);

    const lowConfidence = await detectUltraworkAutoActivationWithLlm(
      {
        generate: vi.fn(async () => ({
          id: 'gen_test',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '{"should_activate":true,"confidence":0.4,"reason":"Ambiguous"}',
              },
            ],
          },
          usage: null,
          finishReason: 'stop',
          rawFinishReason: 'stop',
        })) as never,
        provider: {} as never,
      },
      { text: 'maybe do something big?' },
    );
    expect(shouldActOnUltraworkAutoActivation(lowConfidence)).toBe(false);
  });

  it('fails closed on empty prompts and invalid JSON', async () => {
    await expect(
      detectUltraworkAutoActivationWithLlm(
        {
          generate: vi.fn(async () => {
            throw new Error('should not call');
          }) as never,
          provider: {} as never,
        },
        { text: '   ' },
      ),
    ).resolves.toBeUndefined();

    const invalid = await detectUltraworkAutoActivationWithLlm(
      {
        generate: vi.fn(async () => ({
          id: 'gen_test',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'not-json' }],
          },
          usage: null,
          finishReason: 'stop',
          rawFinishReason: 'stop',
        })) as never,
        provider: {} as never,
      },
      { text: 'Ship feature X' },
    );
    expect(invalid).toBeUndefined();
    expect(shouldActOnUltraworkAutoActivation(invalid)).toBe(false);
  });
});
