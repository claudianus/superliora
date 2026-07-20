import { describe, expect, it, vi } from 'vitest';

import {
  detectUltraworkAutoActivationWithLlm,
  isOpenEndedImprovementLoop,
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

describe('open-ended improvement loop guard', () => {
  it('flags infinite/self-improvement loop requests in Korean and English', () => {
    expect(
      isOpenEndedImprovementLoop(
        '우리 TUI를 무한 자가 개선 루프로 계속 개선해줘. 무제한 개발 허용함',
      ),
    ).toBe(true);
    expect(isOpenEndedImprovementLoop('끝없는 개선 반복으로 세계 1위 TUI를 만들어')).toBe(true);
    expect(
      isOpenEndedImprovementLoop('Run an infinite loop of improvements on the TUI'),
    ).toBe(true);
    expect(isOpenEndedImprovementLoop('keep improving the harness forever')).toBe(true);
  });

  it('does not flag bug reports about infinite loops or unrelated feature work', () => {
    expect(isOpenEndedImprovementLoop('fix the infinite loop bug in the parser')).toBe(false);
    expect(isOpenEndedImprovementLoop('무한 스크롤 UI를 개발해줘')).toBe(false);
    expect(isOpenEndedImprovementLoop('Debug the endless retry loop crash')).toBe(false);
    expect(isOpenEndedImprovementLoop('Ship the new diff panel feature')).toBe(false);
  });

  it('declines open-ended loops deterministically without an LLM call', async () => {
    const generate = vi.fn(async () => {
      throw new Error('classifier must not be called for open-ended loops');
    });
    const intent = await detectUltraworkAutoActivationWithLlm(
      { generate: generate as never, provider: {} as never },
      { text: '우리 하네스를 무한 자가 개선 루프로 계속 개선해줘' },
    );
    expect(generate).not.toHaveBeenCalled();
    expect(intent).toEqual({
      shouldActivate: false,
      confidence: 1,
      reason: 'Open-ended improvement loop; runs as ordinary goal-driven iteration',
    });
    expect(shouldActOnUltraworkAutoActivation(intent)).toBe(false);
  });
});
