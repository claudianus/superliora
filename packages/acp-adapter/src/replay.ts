import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import { log, type ContextMessage } from '@superliora/sdk';

import {
  acpToolCallId,
  assistantDeltaToSessionUpdate,
  thinkingDeltaToSessionUpdate,
  toolCallStartToSessionUpdate,
} from '#/convert/events-map';

/**
 * Per-replay bookkeeping threaded through {@link replayMessage} by
 * `AcpSession.replayHistory` — keeps the outer loop a thin
 * turnId/tool-correlation shell while the per-message dispatch logic
 * lives here.
 */
export interface ReplayContext {
  readonly getTurnId: () => number;
  readonly beginAssistantTurn: () => void;
  readonly recordToolCall: (toolCallId: string) => void;
  readonly lookupToolCallTurnId: (toolCallId: string) => number | undefined;
}

/**
 * Emit ACP session updates for a single historical {@link ContextMessage}.
 *
 * Extracted from `AcpSession.replayHistory` (see its JSDoc for the full
 * replay contract) so the per-message dispatch is a standalone,
 * unit-testable function. Awaits every `sessionUpdate` so replay
 * completes in strict order.
 */
export async function replayMessage(
  message: ContextMessage,
  sessionId: string,
  conn: AgentSideConnection,
  ctx: ReplayContext,
): Promise<void> {
  switch (message.role) {
    case 'user':
      for (const part of message.content) {
        if (part.type === 'text' && part.text) {
          await conn.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: 'user_message_chunk',
              content: { type: 'text', text: part.text },
            },
          });
        }
      }
      return;
    case 'assistant': {
      ctx.beginAssistantTurn();
      const turnId = ctx.getTurnId();
      for (const part of message.content) {
        await replayAssistantContentPart(part, sessionId, conn, turnId);
      }
      for (const toolCall of message.toolCalls ?? []) {
        ctx.recordToolCall(toolCall.id);
        await replaySyntheticToolCall(toolCall, sessionId, conn, turnId);
      }
      return;
    }
    case 'tool': {
      const rawToolCallId = message.toolCallId;
      if (!rawToolCallId) {
        // Tool result with no correlation id — log and skip rather
        // than crash. The on-disk session is the source of truth;
        // we cannot synthesize a missing id.
        log.warn('acp: replayHistory skipped tool message with no toolCallId', { sessionId });
        return;
      }
      const turnId = ctx.lookupToolCallTurnId(rawToolCallId);
      if (turnId === undefined) {
        log.warn('acp: replayHistory found tool message with no matching call', {
          sessionId,
          toolCallId: rawToolCallId,
        });
        return;
      }
      const isError = message.isError === true;
      await conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: acpToolCallId(turnId, rawToolCallId),
          status: isError ? 'failed' : 'completed',
          content: toolMessageContentToAcpToolCallContent(message.content),
        },
      });
      return;
    }
    default:
      // system / unknown roles — ACP has no analogue; skip.
      return;
  }
}

async function replayAssistantContentPart(
  part: ContextMessage['content'][number],
  sessionId: string,
  conn: AgentSideConnection,
  turnId: number,
): Promise<void> {
  if (part.type === 'text' && part.text) {
    await conn.sessionUpdate(
      assistantDeltaToSessionUpdate(sessionId, {
        type: 'assistant.delta',
        turnId,
        delta: part.text,
      }),
    );
    return;
  }
  if (part.type === 'think' && part.think) {
    await conn.sessionUpdate(
      thinkingDeltaToSessionUpdate(sessionId, {
        type: 'thinking.delta',
        turnId,
        delta: part.think,
      }),
    );
    return;
  }
  // image_url / audio_url / video_url are skipped at this layer —
  // they belong to the user input side and ACP does not have a
  // dedicated assistant-media chunk.
}

async function replaySyntheticToolCall(
  toolCall: NonNullable<ContextMessage['toolCalls']>[number],
  sessionId: string,
  conn: AgentSideConnection,
  turnId: number,
): Promise<void> {
  const name = toolCall.name;
  const argsRaw = toolCall.arguments;
  const parsedArgs = parseToolCallArguments(argsRaw);
  await conn.sessionUpdate(
    toolCallStartToSessionUpdate(sessionId, {
      type: 'tool.call.started',
      turnId,
      toolCallId: toolCall.id,
      name,
      args: parsedArgs,
    }),
  );
}

/**
 * Parse a tool call's `arguments` field (kosong wire format: a JSON
 * string or `null`) into the structured object expected by the live
 * {@link toolCallStartToSessionUpdate} mapper. Falls back to the raw
 * string when the payload is not valid JSON — the mapper itself uses
 * `stringifyArgs`, which gracefully `String(x)`s anything it cannot
 * serialize, so the worst case is a degraded preview rather than a
 * crash.
 */
function parseToolCallArguments(rawArguments: string | null): unknown {
  if (rawArguments === null || rawArguments === '') return {};
  try {
    return JSON.parse(rawArguments);
  } catch {
    return rawArguments;
  }
}

/**
 * Project a `tool` role {@link ContextMessage}'s `content` array into
 * the ACP `tool_call_update.content` shape (an array of
 * `ToolCallContent` entries). The historical message's content is a
 * sequence of kosong content parts — for replay we surface text parts
 * directly and stringify anything else (image refs etc.) as a
 * `[type]` placeholder so the client still sees that something was
 * returned.
 */
function toolMessageContentToAcpToolCallContent(
  parts: ContextMessage['content'],
): Array<{ type: 'content'; content: { type: 'text'; text: string } }> {
  const result: Array<{ type: 'content'; content: { type: 'text'; text: string } }> = [];
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text) {
        result.push({ type: 'content', content: { type: 'text', text: part.text } });
      }
      continue;
    }
    // image_url / audio_url / video_url / think — surface a marker so
    // the result card is not empty. Replay should not lose evidence
    // that a non-text part was present.
    result.push({
      type: 'content',
      content: { type: 'text', text: `[${part.type}]` },
    });
  }
  return result;
}