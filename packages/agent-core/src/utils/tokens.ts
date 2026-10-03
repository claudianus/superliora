import type { ContentPart, Message, Tool } from '@superliora/kosong';

const messageTokenEstimateCache = new WeakMap<Message, number>();

let lastTextEstimate: { readonly text: string; readonly tokens: number } | undefined;

/**
 * Estimate token count from text using a character-based heuristic.
 *   - ASCII (~4 chars per token)
 *   - CJK and other non-ASCII (~1 char per token)
 * The estimate is transient — the next LLM call returns the real count
 * and supersedes this value. Used to keep `tokenCountWithPending`
 * monotonic between LLM round-trips without paying for a tokenizer.
 *
 * Repeat reads of one string (the system prompt, read several times per step by
 * the compaction policy) are answered from `lastTextEstimate`: a code-point walk
 * over the same string is pure repeat work, and identity comparison is O(1).
 */
export function estimateTokens(text: string): number {
  const memo = lastTextEstimate;
  if (memo !== undefined && memo.text === text) return memo.tokens;
  let asciiCount = 0;
  let nonAsciiCount = 0;
  for (const char of text) {
    if (char.codePointAt(0)! <= 127) {
      asciiCount++;
    } else {
      nonAsciiCount++;
    }
  }
  const tokens = Math.ceil(asciiCount / 4) + nonAsciiCount;
  lastTextEstimate = { text, tokens };
  return tokens;
}

export function estimateTokensForMessages(messages: readonly Message[]): number {
  let total = 0;
  for (const message of messages) {
    total += estimateTokensForMessage(message);
  }
  return total;
}

export function estimateTokensForTools(tools: readonly Tool[]): number {
  let total = 0;
  for (const tool of tools) {
    total += estimateTokensForTool(tool);
  }
  return total;
}

/**
 * Per-tool estimate memo. The compaction policy re-reads the fixed prompt cost
 * several times per step, and stringifying every tool schema plus scanning its
 * description character-by-character is the expensive half of that read. Tool
 * objects are fixed once registered, so identity keying is safe.
 */
const toolTokenEstimateCache = new WeakMap<Tool, number>();

function estimateTokensForTool(tool: Tool): number {
  const cached = toolTokenEstimateCache.get(tool);
  if (cached !== undefined) return cached;
  const total =
    estimateTokens(tool.name) +
    estimateTokens(tool.description) +
    estimateTokens(JSON.stringify(tool.parameters));
  toolTokenEstimateCache.set(tool, total);
  return total;
}

export function estimateTokensForMessage(message: Message): number {
  const cached = messageTokenEstimateCache.get(message);
  if (cached !== undefined) {
    return cached;
  }

  let total = estimateTokens(message.role);
  total += estimateTokensForContentParts(message.content);
  if (message.toolCalls !== undefined) {
    for (const call of message.toolCalls) {
      total += estimateTokens(call.name);
      total += estimateTokens(JSON.stringify(call.arguments));
    }
  }
  messageTokenEstimateCache.set(message, total);
  return total;
}

function estimateTokensForContentParts(parts: readonly ContentPart[]): number {
  let total = 0;
  for (const part of parts) {
    total += estimateTokensForContentPart(part);
  }
  return total;
}

/**
 * Transient per-part token floor for media (image/audio/video). The real usage
 * from the next model response supersedes this estimate; this only prevents
 * media-heavy pending context from looking free to compaction and usage UI.
 */
export const MEDIA_TOKEN_ESTIMATE = 2000;

export function estimateTokensForContentPart(part: ContentPart): number {
  switch (part.type) {
    case 'text':
      return estimateTokens(part.text);
    case 'think':
      return estimateTokens(part.think);
    case 'image_url':
    case 'audio_url':
    case 'video_url':
    case 'file_url':
      return MEDIA_TOKEN_ESTIMATE;
    default: {
      const _exhaustive: never = part;
      void _exhaustive;
      return 0;
    }
  }
}
