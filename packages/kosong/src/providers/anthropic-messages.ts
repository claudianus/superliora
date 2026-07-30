import { ChatProviderError } from '#/errors';
import type { ContentPart, Message } from '#/message';
import type {
  ContentBlockParam,
  MessageParam,
  TextBlockParam,
  ThinkingBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages/messages.js';

import { shouldPreserveUnsignedThinking } from './anthropic-model';

export const CACHE_CONTROL = { type: 'ephemeral' as const };

export type CacheableBlock = ContentBlockParam & { cache_control?: { type: 'ephemeral' } };

/**
 * Content block types that support cache_control injection.
 */
const CACHEABLE_TYPES = new Set([
  'text',
  'image',
  'document',
  'search_result',
  'tool_use',
  'tool_result',
  'server_tool_use',
  'web_search_tool_result',
]);

export function injectCacheControlOnLastBlock(messages: MessageParam[]): void {
  const lastMessage = messages.at(-1);
  if (lastMessage === undefined) return;
  const content = lastMessage.content;
  if (!Array.isArray(content) || content.length === 0) return;
  const lastBlock = content.at(-1) as CacheableBlock | undefined;
  if (lastBlock === undefined) return;
  if (CACHEABLE_TYPES.has(lastBlock.type)) {
    lastBlock.cache_control = CACHE_CONTROL;
  }
}

/**
 * Inject a cache breakpoint on the penultimate message's last content block.
 * This keeps the growing conversation prefix cached turn-over-turn: everything
 * up to the penultimate message is a stable prefix that the provider can serve
 * from cache, while only the final (new) message incurs full input cost.
 * Requires >= 3 messages (system is separate; at least 2 conversation turns).
 */
export function injectCacheControlOnPenultimateBlock(messages: MessageParam[]): void {
  if (messages.length < 3) return;
  const penultimate = messages.at(-2);
  if (penultimate === undefined) return;
  const content = penultimate.content;
  if (!Array.isArray(content) || content.length === 0) return;
  const lastBlock = content.at(-1) as CacheableBlock | undefined;
  if (lastBlock === undefined) return;
  if (CACHEABLE_TYPES.has(lastBlock.type)) {
    lastBlock.cache_control = CACHE_CONTROL;
  }
}

/**
 * Check whether a MessageParam is a user message whose content consists
 * entirely of `tool_result` blocks.
 *
 * Used to detect adjacent tool-result-only messages that must be merged
 * before hitting the Anthropic wire. Per the Messages API parallel-tool-use
 * spec, all `tool_result` blocks answering parallel `tool_use` calls must
 * live in a single user message — splitting them across consecutive user
 * messages fails on strict Anthropic-compatible backends (HTTP 400) and
 * silently degrades parallel tool use on api.anthropic.com.
 */
export function isToolResultOnly(message: MessageParam): boolean {
  if (message.role !== 'user') return false;
  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((block) => block.type === 'tool_result');
}

interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; data: string; media_type: string } | { type: 'url'; url: string };
  cache_control?: { type: 'ephemeral' };
}

// The Messages API has no representation for audio or video input. Instead of
// silently dropping such parts (the model would not even know an attachment
// existed), emit a placeholder text block so it can acknowledge the gap.
// Consecutive parts of the same kind collapse into a single placeholder.
const OMITTED_MEDIA_PLACEHOLDER = {
  audio_url: '(audio omitted: not supported by this provider)',
  video_url: '(video omitted: not supported by this provider)',
} as const;

const SUPPORTED_B64_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function imageUrlPartToAnthropic(url: string): AnthropicImageBlock {
  if (url.startsWith('data:')) {
    const withoutScheme = url.slice(5);
    const parts = withoutScheme.split(';base64,', 2);
    if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
      throw new ChatProviderError(`Invalid data URL for image: ${url}`);
    }
    const mediaType = parts[0];
    const data = parts[1];
    if (!SUPPORTED_B64_MEDIA_TYPES.has(mediaType)) {
      throw new ChatProviderError(
        `Unsupported media type for base64 image: ${mediaType}, url: ${url}`,
      );
    }
    return {
      type: 'image',
      source: { type: 'base64', data, media_type: mediaType },
    };
  }
  return {
    type: 'image',
    source: { type: 'url', url },
  };
}

function toolResultToBlock(toolCallId: string, content: ContentPart[]): ToolResultBlockParam {
  const blocks: Array<TextBlockParam | AnthropicImageBlock> = [];
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) {
        blocks.push({ type: 'text', text: part.text });
      }
    } else if (part.type === 'image_url') {
      blocks.push(imageUrlPartToAnthropic(part.imageUrl.url));
    } else if (part.type === 'audio_url' || part.type === 'video_url') {
      const placeholder = OMITTED_MEDIA_PLACEHOLDER[part.type];
      const last = blocks.at(-1);
      if (!(last?.type === 'text' && last.text === placeholder)) {
        blocks.push({ type: 'text', text: placeholder });
      }
    }
  }
  return {
    type: 'tool_result',
    tool_use_id: toolCallId,
    content: blocks,
  } as ToolResultBlockParam;
}

export function convertMessage(message: Message, model: string): MessageParam {
  const role = message.role;

  // system role -> <system>...</system> wrapped user message
  if (role === 'system') {
    const text = message.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n');
    return {
      role: 'user',
      content: [{ type: 'text', text: `<system>${text}</system>` }],
    };
  }

  // tool role -> ToolResultBlockParam in user message
  if (role === 'tool') {
    if (message.toolCallId === undefined) {
      throw new ChatProviderError('Tool message missing `toolCallId`.');
    }
    const block = toolResultToBlock(message.toolCallId, message.content);
    return { role: 'user', content: [block as ContentBlockParam] };
  }

  // user or assistant
  const blocks: ContentBlockParam[] = [];
  for (const part of message.content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text } satisfies TextBlockParam);
    } else if (part.type === 'image_url') {
      blocks.push(imageUrlPartToAnthropic(part.imageUrl.url) as unknown as ContentBlockParam);
    } else if (part.type === 'think') {
      // ThinkPart -> ThinkingBlockParam.
      //
      // Signed: emit the block with its signature. api.anthropic.com requires a
      // valid signature and always supplies one, so Anthropic-sourced history
      // always takes this branch.
      //
      // Unsigned: still PRESERVE the thinking, emitted *without* a `signature`
      // field. Anthropic-compatible backends (e.g. Kimi) stream thinking with
      // no signature_delta, yet reject a tool-call turn whose thinking is gone
      // ("thinking is enabled but reasoning_content is missing"). Dropping it
      // here is what broke multi-step tool use on those backends. Claude
      // models reject unsigned thinking blocks, so those are only preserved
      // for non-Claude Anthropic-compatible models. An unsigned part with no
      // text carries nothing, so it is skipped.
      if (part.encrypted !== undefined) {
        blocks.push({
          type: 'thinking',
          thinking: part.think,
          signature: part.encrypted,
        } satisfies ThinkingBlockParam);
      } else if (part.think !== '' && shouldPreserveUnsignedThinking(model)) {
        blocks.push({ type: 'thinking', thinking: part.think } as unknown as ThinkingBlockParam);
      }
    } else if (part.type === 'audio_url' || part.type === 'video_url') {
      const placeholder = OMITTED_MEDIA_PLACEHOLDER[part.type];
      const last = blocks.at(-1);
      if (!(last?.type === 'text' && last.text === placeholder)) {
        blocks.push({ type: 'text', text: placeholder } satisfies TextBlockParam);
      }
    }
  }

  // Tool calls -> ToolUseBlockParam
  if (message.toolCalls.length > 0) {
    for (const tc of message.toolCalls) {
      let toolInput: Record<string, unknown> = {};
      if (tc.arguments) {
        try {
          const parsed: unknown = JSON.parse(tc.arguments);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            toolInput = parsed as Record<string, unknown>;
          } else {
            throw new ChatProviderError('Tool call arguments must be a JSON object.');
          }
        } catch (error) {
          if (error instanceof ChatProviderError) throw error;
          throw new ChatProviderError('Tool call arguments must be valid JSON.');
        }
      }
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.name,
        input: toolInput,
      } satisfies ToolUseBlockParam);
    }
  }

  return { role: role, content: blocks };
}
