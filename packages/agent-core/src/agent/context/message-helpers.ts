import type { ContentPart } from '@superliora/kosong';

import { extractImageCompressionCaptions } from '../../tools/support/image-compress';
import { isRealUserPromptOrigin, type ContextMessage } from './types';

// Split inline image-compression captions (see buildImageCompressionCaption)
// out of user prompt content. A caption may be a standalone text part (server
// route, ACP) or merged into an adjacent text segment (TUI paste), so each
// text part is scanned rather than matched whole. Text left empty once its
// captions are removed is dropped entirely.
export function splitImageCompressionCaptions(content: readonly ContentPart[]): {
  captions: readonly string[];
  parts: ContentPart[];
} {
  const captions: string[] = [];
  const parts: ContentPart[] = [];
  for (const part of content) {
    if (part.type !== 'text') {
      parts.push(part);
      continue;
    }
    const extracted = extractImageCompressionCaptions(part.text);
    if (extracted.captions.length === 0) {
      parts.push(part);
      continue;
    }
    captions.push(...extracted.captions);
    if (extracted.text.trim().length > 0) {
      parts.push({ type: 'text', text: extracted.text });
    }
  }
  return { captions, parts };
}

export function isReclaimableEphemeralUserMessage(message: ContextMessage): boolean {
  if (message.role !== 'user') return false;
  const kind = message.origin?.kind;
  return kind === 'injection' || kind === 'background_task';
}

export function isRealUserPrompt(message: ContextMessage): boolean {
  return message.role === 'user' && isRealUserPromptOrigin(message.origin);
}

export function formatUndoUnavailableMessage(
  requestedCount: number,
  undoableCount: number,
  stoppedAtCompaction: boolean,
): string {
  const reason = stoppedAtCompaction ? ' after the last compaction' : '';
  return `Cannot undo ${formatPromptCount(requestedCount)}; only ${formatPromptCount(undoableCount)} can be undone in the active context${reason}.`;

  function formatPromptCount(count: number): string {
    return `${String(count)} ${count === 1 ? 'prompt' : 'prompts'}`;
  }
}
