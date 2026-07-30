import type { ContextMessage } from '../../agent/context';
import type { JsonObject } from '../../rpc';
import type { Message, PageResponse } from '@superliora/protocol';

import { toProtocolMessage } from '../message/message';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_UNDO_MESSAGE_PAGE_SIZE = 50;
export const MAX_UNDO_MESSAGE_PAGE_SIZE = 100;
export const CHILD_SESSION_KIND = 'child';

export function asJsonObject(value: Record<string, unknown>): JsonObject {
  return value as unknown as JsonObject;
}

export function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function canUndoHistory(history: readonly ContextMessage[], count: number): boolean {
  let found = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message === undefined) continue;
    if (message.origin?.kind === 'injection') continue;
    if (message.origin?.kind === 'compaction_summary') return false;
    if (isRealUserPrompt(message)) {
      found++;
      if (found >= count) return true;
    }
  }
  return false;
}

function isRealUserPrompt(message: ContextMessage): boolean {
  if (message.role !== 'user') return false;
  const origin = message.origin;
  if (origin === undefined || origin.kind === 'user') return true;
  if (origin.kind === 'plugin_command') return origin.trigger === 'user-slash';
  return origin.kind === 'skill_activation' && origin.trigger === 'user-slash';
}

export function pageContextMessages(
  sessionId: string,
  sessionCreatedAtMs: number,
  context: import('../../agent/context').AgentContextData,
  requestedPageSize: number | undefined,
): PageResponse<Message> {
  const pageSize = Math.min(
    Math.max(requestedPageSize ?? DEFAULT_UNDO_MESSAGE_PAGE_SIZE, 1),
    MAX_UNDO_MESSAGE_PAGE_SIZE,
  );
  const all = context.history.map((message, index) =>
    toProtocolMessage(sessionId, index, message, sessionCreatedAtMs),
  );
  const desc = all.toReversed();
  return {
    items: desc.slice(0, pageSize),
    has_more: desc.length > pageSize,
  };
}

