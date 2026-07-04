import type { Message } from '@superliora/kosong';

import {
  estimateTokensForMessage,
  estimateTokensForMessages,
} from '../../utils/tokens';

export const CONTEXT_COMPACTION_V2_VERSION = 'super_kimi_context_compaction_v2' as const;

export type CompactionActionType =
  | 'tool_result_clearing'
  | 'focus_phase_summary'
  | 'semantic_working_memory'
  | 'emergency_backstop';

export interface CompactionAction {
  readonly type: CompactionActionType;
  readonly reason: string;
  readonly messageStart: number;
  readonly messageEnd: number;
  readonly tokensBefore?: number;
  readonly tokensAfter?: number;
  readonly toolCallIds?: readonly string[];
  readonly toolNames?: readonly string[];
}

export type MessageGroupKind =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool_exchange'
  | 'tool_result';

export interface MessageGroup {
  readonly kind: MessageGroupKind;
  readonly start: number;
  readonly end: number;
  readonly messages: readonly Message[];
  readonly tokens: number;
  readonly toolCallIds: readonly string[];
  readonly toolNames: readonly string[];
}

export interface CompactionRawRef {
  readonly kind: MessageGroupKind;
  readonly messageStart: number;
  readonly messageEnd: number;
  readonly tokens: number;
  readonly toolCallIds?: readonly string[];
  readonly toolNames?: readonly string[];
}

export interface CompactionPlan {
  readonly algorithmVersion: typeof CONTEXT_COMPACTION_V2_VERSION;
  readonly compactedCount: number;
  readonly compactedTokens: number;
  readonly retainedTokens: number;
  readonly actions: readonly CompactionAction[];
  readonly rawRefs: readonly CompactionRawRef[];
  readonly qualityWarnings: readonly string[];
}

export class CompactionPlanner {
  plan(messages: readonly Message[], compactedCount: number): CompactionPlan {
    const groups = groupMessages(messages);
    const compactedGroups = groups.filter((group) => group.start < compactedCount);
    const retained = messages.slice(compactedCount);
    const qualityWarnings: string[] = [];

    if (compactedGroups.some((group) => group.end >= compactedCount)) {
      qualityWarnings.push('compaction split crosses an atomic message group');
    }

    const actions: CompactionAction[] = [];
    const toolGroups = compactedGroups.filter((group) => group.kind === 'tool_exchange');
    for (const group of toolGroups) {
      actions.push({
        type: 'tool_result_clearing',
        reason: 'old tool-call group moved out of working context with replay references kept',
        messageStart: group.start,
        messageEnd: group.end,
        tokensBefore: group.tokens,
        tokensAfter: estimateMarkerTokens(group),
        toolCallIds: group.toolCallIds,
        toolNames: group.toolNames,
      });
    }

    if (compactedGroups.length > 0) {
      actions.push({
        type: 'focus_phase_summary',
        reason: 'compacted prefix summarized as a completed focus phase',
        messageStart: compactedGroups[0]!.start,
        messageEnd: compactedGroups.at(-1)!.end,
        tokensBefore: estimateTokensForMessages(
          messages.slice(compactedGroups[0]!.start, compactedGroups.at(-1)!.end + 1),
        ),
      });
      actions.push({
        type: 'semantic_working_memory',
        reason: 'critical files, decisions, failures, open questions, and next actions retained as structured memory',
        messageStart: compactedGroups[0]!.start,
        messageEnd: compactedGroups.at(-1)!.end,
      });
    }

    return {
      algorithmVersion: CONTEXT_COMPACTION_V2_VERSION,
      compactedCount,
      compactedTokens: estimateTokensForMessages(messages.slice(0, compactedCount)),
      retainedTokens: estimateTokensForMessages(retained),
      actions,
      rawRefs: compactedGroups.map(groupToRawRef),
      qualityWarnings,
    };
  }
}

export function groupMessages(messages: readonly Message[]): readonly MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;
  while (i < messages.length) {
    const message = messages[i]!;
    if (message.role === 'system') {
      const start = i;
      while (i + 1 < messages.length && messages[i + 1]?.role === 'system') i++;
      groups.push(createGroup('system', messages, start, i));
      i++;
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls.length > 0) {
      const start = i;
      const toolCallIds = new Set(message.toolCalls.map((toolCall) => toolCall.id));
      while (
        i + 1 < messages.length &&
        messages[i + 1]?.role === 'tool' &&
        toolCallIds.has(messages[i + 1]!.toolCallId ?? '')
      ) {
        i++;
      }
      groups.push(createGroup('tool_exchange', messages, start, i));
      i++;
      continue;
    }

    if (message.role === 'tool') {
      groups.push(createGroup('tool_result', messages, i, i));
      i++;
      continue;
    }

    groups.push(createGroup(message.role === 'user' ? 'user' : 'assistant', messages, i, i));
    i++;
  }
  return groups;
}

export function splitMessagesIntoTokenBlocks(
  messages: readonly Message[],
  targetTokens: number,
): readonly (readonly Message[])[] {
  const blocks: Message[][] = [];
  let current: Message[] = [];
  let currentTokens = 0;

  for (const group of groupMessages(messages)) {
    if (current.length > 0 && currentTokens + group.tokens > targetTokens) {
      blocks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(...group.messages);
    currentTokens += group.tokens;
  }

  if (current.length > 0) {
    blocks.push(current);
  }
  return blocks;
}

function createGroup(
  kind: MessageGroupKind,
  messages: readonly Message[],
  start: number,
  end: number,
): MessageGroup {
  const slice = messages.slice(start, end + 1);
  const assistant = slice.find((message) => message.role === 'assistant' && message.toolCalls.length > 0);
  return {
    kind,
    start,
    end,
    messages: slice,
    tokens: estimateTokensForMessages(slice),
    toolCallIds: assistant?.toolCalls.map((toolCall) => toolCall.id) ?? [],
    toolNames: assistant?.toolCalls.map((toolCall) => toolCall.name) ?? [],
  };
}

function groupToRawRef(group: MessageGroup): CompactionRawRef {
  return {
    kind: group.kind,
    messageStart: group.start,
    messageEnd: group.end,
    tokens: group.tokens,
    toolCallIds: group.toolCallIds.length > 0 ? group.toolCallIds : undefined,
    toolNames: group.toolNames.length > 0 ? group.toolNames : undefined,
  };
}

function estimateMarkerTokens(group: MessageGroup): number {
  return estimateTokensForMessage({
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: `[Tool results cleared: ${group.toolNames.join(', ') || group.toolCallIds.join(', ')}]`,
      },
    ],
    toolCalls: [],
  });
}
