import type { OpenAIContentPart } from './openai-common';

/**
 * Qwen/DashScope explicit context-cache marker (Chat Completions compatible).
 * A marker caches everything from the request head up to the marked block;
 * hits bill at 10% versus the implicit prefix cache's 20%.
 */
export const QWEN_CACHE_CONTROL = { type: 'ephemeral' } as const;

/** True when the endpoint/model is Qwen-compatible and accepts cache markers. */
export function isQwenCacheEndpoint(baseUrl: string | undefined, model: string): boolean {
  const url = (baseUrl ?? '').toLowerCase();
  const name = model.toLowerCase();
  return (
    name.startsWith('qwen') ||
    url.includes('dashscope') ||
    url.includes('qwen') ||
    url.includes('aliyuncs')
  );
}

/** Minimal message shape shared by the Chat Completions-style providers. */
export interface QwenCacheableMessage {
  role: string;
  content?: string | OpenAIContentPart[] | undefined;
}

type QwenCacheableContentPart = OpenAIContentPart & {
  cache_control?: typeof QWEN_CACHE_CONTROL;
};

/** Attach a cache marker to the last content block of a message (no-op when empty). */
export function markCacheBoundary(message: QwenCacheableMessage): void {
  const content = message.content;
  if (typeof content === 'string') {
    const marked: QwenCacheableContentPart = {
      type: 'text',
      text: content,
      cache_control: QWEN_CACHE_CONTROL,
    } as QwenCacheableContentPart;
    message.content = [marked];
    return;
  }
  if (Array.isArray(content) && content.length > 0) {
    const last = content.at(-1);
    if (last !== null && typeof last === 'object') {
      (last as unknown as Record<string, unknown>)['cache_control'] = QWEN_CACHE_CONTROL;
    }
  }
}

/**
 * Place up to two stable cache boundaries: the system prompt (static per
 * session) and a sliding marker on the penultimate message, which keeps the
 * growing conversation prefix cached turn over turn.
 */
export function markQwenCacheBoundaries(messages: QwenCacheableMessage[]): void {
  if (messages.length > 0 && messages[0]?.role === 'system') {
    markCacheBoundary(messages[0]);
  }
  if (messages.length >= 3) {
    const penultimate = messages.at(-2);
    if (penultimate !== undefined) markCacheBoundary(penultimate);
  }
}
