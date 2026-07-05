import type { ContentPart, Message, TextPart } from '@superliora/kosong';

import { ErrorCodes, LioraError } from '../../errors';
import type { ContextMessage } from './types';

export interface ProjectOptions {
  /**
   * Close even the trailing open tool exchange with a synthetic result. Normal
   * turn sends leave the tail open because it may still be in flight; compaction
   * and strict resend can enable this to force a complete wire request.
   */
  readonly synthesizeMissing?: boolean;
  /**
   * Drop tool results with no matching assistant tool call. Normal sends keep
   * recorded output; strict resend uses this as a last-resort repair.
   */
  readonly dropOrphanResults?: boolean;
  /** Drop leading assistant/tool messages until the first projected turn is user. */
  readonly dropLeadingNonUser?: boolean;
  /** Merge adjacent assistant turns for strict providers that require alternation. */
  readonly mergeConsecutiveAssistants?: boolean;
  /**
   * When `true`, drop assistant tool calls whose id already appeared earlier
   * (first occurrence wins; a message left with no content and no calls is
   * dropped), and drop every tool result after the first for a given id so the
   * kept call keeps exactly one answer. Strict-resend only.
   */
  readonly dedupeDuplicateToolCalls?: boolean;
  /** Observe projection repairs for diagnostics without mutating source history. */
  readonly onAnomaly?: (anomaly: ProjectionAnomaly) => void;
}

export type ProjectionAnomaly =
  | { readonly kind: 'tool_result_reordered'; readonly toolCallId: string }
  | { readonly kind: 'tool_result_synthesized'; readonly toolCallId: string; readonly trailing: boolean }
  | { readonly kind: 'orphan_tool_result_dropped'; readonly toolCallId: string }
  | { readonly kind: 'duplicate_tool_call_dropped'; readonly toolCallId: string }
  | { readonly kind: 'duplicate_tool_result_dropped'; readonly toolCallId: string }
  | { readonly kind: 'leading_non_user_dropped'; readonly role: string }
  | { readonly kind: 'consecutive_assistants_merged' }
  | { readonly kind: 'whitespace_text_dropped'; readonly role: string };

export function project(history: readonly ContextMessage[], options?: ProjectOptions): Message[] {
  let result = mergeAdjacentUserMessages(history, options?.onAnomaly);
  if (options?.dedupeDuplicateToolCalls === true) {
    result = dedupeDuplicateToolCalls(result, options.onAnomaly);
  }
  result = repairToolExchangeAdjacency(result, options);
  if (options?.mergeConsecutiveAssistants === true) {
    result = mergeConsecutiveAssistantMessages(result, options.onAnomaly);
  }
  if (options?.dropOrphanResults === true) {
    result = dropOrphanToolResults(result, options.onAnomaly);
  }
  if (options?.dropLeadingNonUser === true) {
    result = dropLeadingNonUserMessages(result, options.onAnomaly);
  }
  return result;
}

const SYNTHETIC_TOOL_RESULT_TEXT =
  'Tool result is not available in the current context. Do not assume the tool completed successfully.';

function repairToolExchangeAdjacency(
  messages: readonly Message[],
  options?: ProjectOptions,
): Message[] {
  let lastNonToolIndex = messages.length - 1;
  while (lastNonToolIndex >= 0 && messages[lastNonToolIndex]?.role === 'tool') {
    lastNonToolIndex -= 1;
  }

  const out: Message[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < messages.length; i++) {
    if (consumed.has(i)) continue;
    const message = messages[i]!;
    if (message.role !== 'assistant' || message.toolCalls.length === 0) {
      out.push(message);
      continue;
    }

    out.push(message);
    const pending = new Set(message.toolCalls.map((toolCall) => toolCall.id));
    let foreignBetween = false;
    for (let j = i + 1; j < messages.length && pending.size > 0; j++) {
      if (consumed.has(j)) continue;
      const next = messages[j]!;
      const toolCallId = next.toolCallId;
      if (next.role === 'tool' && toolCallId !== undefined && pending.has(toolCallId)) {
        out.push(next);
        consumed.add(j);
        pending.delete(toolCallId);
        if (foreignBetween) {
          options?.onAnomaly?.({ kind: 'tool_result_reordered', toolCallId });
        }
      } else {
        foreignBetween = true;
      }
    }

    const isMidHistory = i < lastNonToolIndex;
    if (options?.synthesizeMissing === true || isMidHistory) {
      for (const missingId of pending) {
        out.push(makeSyntheticToolResult(missingId));
        options?.onAnomaly?.({
          kind: 'tool_result_synthesized',
          toolCallId: missingId,
          trailing: !isMidHistory,
        });
      }
    }
  }
  return out;
}

function makeSyntheticToolResult(toolCallId: string): Message {
  return {
    role: 'tool',
    content: [{ type: 'text', text: SYNTHETIC_TOOL_RESULT_TEXT }],
    toolCalls: [],
    toolCallId,
  };
}

function dedupeDuplicateToolCalls(
  messages: readonly Message[],
  onAnomaly?: (anomaly: ProjectionAnomaly) => void,
): Message[] {
  const seenToolCallIds = new Set<string>();
  const seenToolResultIds = new Set<string>();
  const out: Message[] = [];
  for (const message of messages) {
    if (message.role === 'assistant' && message.toolCalls.length > 0) {
      const kept = message.toolCalls.filter((toolCall) => {
        if (seenToolCallIds.has(toolCall.id)) {
          onAnomaly?.({ kind: 'duplicate_tool_call_dropped', toolCallId: toolCall.id });
          return false;
        }
        seenToolCallIds.add(toolCall.id);
        return true;
      });
      if (kept.length === message.toolCalls.length) {
        out.push(message);
      } else if (kept.length > 0 || message.content.length > 0) {
        out.push({ ...message, toolCalls: kept });
      }
      continue;
    }
    if (message.role === 'tool' && message.toolCallId !== undefined) {
      if (seenToolResultIds.has(message.toolCallId)) {
        onAnomaly?.({ kind: 'duplicate_tool_result_dropped', toolCallId: message.toolCallId });
        continue;
      }
      seenToolResultIds.add(message.toolCallId);
    }
    out.push(message);
  }
  return out;
}

function dropOrphanToolResults(
  messages: readonly Message[],
  onAnomaly?: (anomaly: ProjectionAnomaly) => void,
): Message[] {
  const toolUseIds = new Set<string>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const toolCall of message.toolCalls) toolUseIds.add(toolCall.id);
    }
  }
  return messages.filter((message) => {
    if (message.role !== 'tool' || message.toolCallId === undefined) return true;
    if (toolUseIds.has(message.toolCallId)) return true;
    onAnomaly?.({ kind: 'orphan_tool_result_dropped', toolCallId: message.toolCallId });
    return false;
  });
}

function dropLeadingNonUserMessages(
  messages: readonly Message[],
  onAnomaly?: (anomaly: ProjectionAnomaly) => void,
): Message[] {
  let start = 0;
  while (start < messages.length && messages[start]!.role !== 'user') {
    onAnomaly?.({ kind: 'leading_non_user_dropped', role: messages[start]!.role });
    start += 1;
  }
  return start === 0 ? [...messages] : messages.slice(start);
}

function mergeConsecutiveAssistantMessages(
  messages: readonly Message[],
  onAnomaly?: (anomaly: ProjectionAnomaly) => void,
): Message[] {
  const out: Message[] = [];
  for (const message of messages) {
    const previous = out.at(-1);
    if (previous !== undefined && previous.role === 'assistant' && message.role === 'assistant') {
      out[out.length - 1] = {
        ...previous,
        content: [...previous.content, ...message.content],
        toolCalls: [...previous.toolCalls, ...message.toolCalls],
      };
      onAnomaly?.({ kind: 'consecutive_assistants_merged' });
      continue;
    }
    out.push(message);
  }
  return out;
}

function mergeAdjacentUserMessages(
  history: readonly ContextMessage[],
  onAnomaly?: (anomaly: ProjectionAnomaly) => void,
): Message[] {
  const out: ContextMessage[] = [];
  for (const source of history) {
    const message = prepareMessageForProjection(source, onAnomaly);
    if (message === null) continue;

    const previous = out.at(-1);
    if (
      canMergeUserMessage(message) &&
      previous !== undefined &&
      canMergeUserMessage(previous)
    ) {
      out[out.length - 1] = mergeTwoUserMessages(previous, message);
      continue;
    }
    out.push(message);
  }
  return out.map(stripContextMetadata);
}

function prepareMessageForProjection(
  message: ContextMessage,
  onAnomaly?: (anomaly: ProjectionAnomaly) => void,
): ContextMessage | null {
  if (message.partial === true) return null;

  let content: ContentPart[] | undefined;
  for (const [index, part] of message.content.entries()) {
    if (part.type === 'text' && part.text.trim().length === 0) {
      content ??= message.content.slice(0, index);
      if (part.text.length > 0) {
        onAnomaly?.({ kind: 'whitespace_text_dropped', role: message.role });
      }
      continue;
    }
    content?.push(part);
  }

  const next = content === undefined ? message : { ...message, content };
  if (next.role === 'tool' && next.content.length === 0) {
    throw new LioraError(
      ErrorCodes.REQUEST_INVALID,
      'Tool result message content cannot be empty after removing empty text blocks.',
      {
        details: {
          toolCallId: next.toolCallId,
        },
      },
    );
  }
  return next.content.length === 0 && next.toolCalls.length === 0 ? null : next;
}

function canMergeUserMessage(message: ContextMessage): boolean {
  return message.role === 'user' && message.origin?.kind === 'user';
}

function mergeTwoUserMessages(a: ContextMessage, b: ContextMessage): ContextMessage {
  const aText = extractTextOnly(a);
  const bText = extractTextOnly(b);
  const nonTextParts = [
    ...a.content.filter((p) => p.type !== 'text'),
    ...b.content.filter((p) => p.type !== 'text'),
  ];
  const mergedText: TextPart = { type: 'text', text: `${aText}\n\n${bText}` };
  const content: ContentPart[] = [mergedText, ...nonTextParts];
  return {
    role: 'user',
    content,
    toolCalls: [],
    origin: a.origin,
  };
}

function extractTextOnly(message: Message): string {
  return message.content
    .filter((p): p is TextPart => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function stripContextMetadata(message: ContextMessage): Message {
  return {
    role: message.role,
    name: message.name,
    content: message.content.map((p) => ({ ...p })) as ContentPart[],
    toolCalls: message.toolCalls.map((tc) => ({ ...tc })),
    toolCallId: message.toolCallId,
    partial: message.partial,
  };
}

export function trimTrailingOpenToolExchange(history: readonly Message[]): Message[] {
  let lastNonToolIndex = history.length - 1;
  while (lastNonToolIndex >= 0 && history[lastNonToolIndex]?.role === 'tool') {
    lastNonToolIndex -= 1;
  }

  const assistant = history[lastNonToolIndex];
  if (assistant === undefined) return [];
  if (assistant.role !== 'assistant' || assistant.toolCalls.length === 0) return [...history];

  const trailingToolCallIds = new Set(
    history
      .slice(lastNonToolIndex + 1)
      .map((message) => message.toolCallId)
      .filter((toolCallId): toolCallId is string => typeof toolCallId === 'string'),
  );
  const closed = assistant.toolCalls.every((toolCall) => trailingToolCallIds.has(toolCall.id));
  return closed ? [...history] : history.slice(0, lastNonToolIndex);
}
