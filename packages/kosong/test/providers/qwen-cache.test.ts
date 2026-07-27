import { describe, expect, it } from 'vitest';

import {
  isQwenCacheEndpoint,
  markCacheBoundary,
  markQwenCacheBoundaries,
} from '#/providers/qwen-cache';

type LooseMessage = { role: string; content?: unknown };

describe('isQwenCacheEndpoint', () => {
  it('matches qwen models and qwen/dashscope/aliyuncs urls', () => {
    expect(isQwenCacheEndpoint('https://api.moonshot.ai/v1', 'qwen3-coder-plus')).toBe(true);
    expect(
      isQwenCacheEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1', 'kimi-k2'),
    ).toBe(true);
    // Qwen Token Plan endpoint: URL-only match, non-qwen model name.
    expect(
      isQwenCacheEndpoint(
        'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
        'gpt-4o',
      ),
    ).toBe(true);
    expect(isQwenCacheEndpoint('https://api.moonshot.ai/v1', 'kimi-k2-0905-preview')).toBe(false);
    expect(isQwenCacheEndpoint(undefined, 'gpt-4o')).toBe(false);
  });
});

describe('markCacheBoundary', () => {
  it('wraps string content into a marked block', () => {
    const message: LooseMessage = { role: 'system', content: 'hello' };
    markCacheBoundary(message as never);
    expect(message.content).toEqual([
      { type: 'text', text: 'hello', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('marks only the last block of array content', () => {
    const message: LooseMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    };
    markCacheBoundary(message as never);
    const parts = message.content as Array<Record<string, unknown>>;
    expect(parts[0]?.['cache_control']).toBeUndefined();
    expect(parts[1]?.['cache_control']).toEqual({ type: 'ephemeral' });
  });

  it('is a no-op for empty content', () => {
    const message: LooseMessage = { role: 'assistant' };
    markCacheBoundary(message as never);
    expect(message.content).toBeUndefined();
  });
});

describe('markQwenCacheBoundaries', () => {
  it('marks the system prompt and the penultimate message', () => {
    const messages: LooseMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'latest' },
    ];
    markQwenCacheBoundaries(messages as never);
    expect(messages[0]?.content).toEqual([
      { type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } },
    ]);
    expect(messages[2]?.content).toEqual([
      { type: 'text', text: 'second', cache_control: { type: 'ephemeral' } },
    ]);
    // The tail message stays unmarked so it can grow without invalidation.
    expect(messages[3]?.content).toBe('latest');
  });

  it('skips the sliding marker for short histories', () => {
    const messages: LooseMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'only' },
    ];
    markQwenCacheBoundaries(messages as never);
    expect(messages[1]?.content).toBe('only');
  });
});
