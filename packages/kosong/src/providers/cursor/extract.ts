/**
 * Extract assistant text, reasoning, and MCP tool calls from Cursor
 * AgentServerMessage payloads (hand-rolled field walks).
 */

import { CURSOR_PROVIDER_ID } from './constants';
import { decodeProtobufValue, iterFields } from './proto';

export interface CursorExtractedToolCall {
  readonly name: string;
  readonly inputJson: string;
  readonly toolCallId?: string;
}

/** Fold Cursor's `mcp_<provider>_<tool>` display name back to the advertised tool name. */
export function normalizeCursorToolName(name: string): string {
  const prefix = `mcp_${CURSOR_PROVIDER_ID}_`;
  if (name.startsWith(prefix)) return name.slice(prefix.length);
  // Also accept double-underscore MCP style: mcp__superliora__Skill
  const alt = `mcp__${CURSOR_PROVIDER_ID}__`;
  if (name.startsWith(alt)) return name.slice(alt.length);
  return name;
}

/** Assistant answer text delta: nested `f1.f1.f1` string (interactionUpdate.textDelta). */
export function extractAnswerText(payload: Uint8Array): string | undefined {
  return extractNestedText(payload, 1);
}

/** Reasoning text delta: nested `f1.f4.f1` string (interactionUpdate.thinkingDelta). */
export function extractReasoningText(payload: Uint8Array): string | undefined {
  return extractNestedText(payload, 4);
}

/**
 * Decode a client MCP tool call from either:
 * - `exec_server_message(2) → mcp_args(11) → McpArgs` (provider=superliora)
 * - `interaction_update(1) → tool_call_completed(3) → ToolCall.mcp_tool_call(15)`
 */
export function extractToolCall(payload: Uint8Array): CursorExtractedToolCall | undefined {
  const fromExec = extractExecMcpToolCall(payload);
  if (fromExec !== undefined) return fromExec;
  return extractInteractionMcpToolCall(payload);
}

export interface CursorExecMessage {
  readonly id: number;
  readonly execId?: string;
  /** Oneof field number inside ExecServerMessage.message. */
  readonly caseField: number;
  readonly caseData: Uint8Array;
}

/** Parse `exec_server_message` (AgentServerMessage field 2). */
export function extractExecMessage(payload: Uint8Array): CursorExecMessage | undefined {
  for (const top of iterFields(payload)) {
    if (top.field !== 2 || top.wire !== 2) continue;
    let id = 0;
    let execId: string | undefined;
    let caseField: number | undefined;
    let caseData: Uint8Array | undefined;
    for (const field of iterFields(top.data)) {
      if (field.field === 1 && field.wire === 0 && field.varint !== undefined) {
        id = Number(field.varint);
      } else if (field.field === 15 && field.wire === 2) {
        execId = Buffer.from(field.data).toString('utf8');
      } else if (field.wire === 2 && field.field !== 19) {
        // Prefer the first oneof payload field (exec args).
        if (caseField === undefined) {
          caseField = field.field;
          caseData = field.data;
        }
      }
    }
    if (caseField === undefined || caseData === undefined) return undefined;
    return {
      id,
      ...(execId === undefined || execId.length === 0 ? {} : { execId }),
      caseField,
      caseData,
    };
  }
  return undefined;
}

export interface CursorInteractionQuery {
  readonly id: number;
  /** Oneof field number inside InteractionQuery.query, when present. */
  readonly queryField?: number;
}

/** Parse `interaction_query` (AgentServerMessage field 7). */
export function extractInteractionQuery(payload: Uint8Array): CursorInteractionQuery | undefined {
  for (const top of iterFields(payload)) {
    if (top.field !== 7 || top.wire !== 2) continue;
    let id = 0;
    let queryField: number | undefined;
    for (const field of iterFields(top.data)) {
      if (field.field === 1 && field.wire === 0 && field.varint !== undefined) {
        id = Number(field.varint);
      } else if (field.wire === 2 && field.field !== 1) {
        queryField ??= field.field;
      }
    }
    return { id, ...(queryField === undefined ? {} : { queryField }) };
  }
  return undefined;
}

export interface CursorKvMessage {
  readonly id: number;
  /** Oneof field number inside KvServerMessage.message (2=getBlob, 3=setBlob). */
  readonly caseField?: number;
}

/** Parse `kv_server_message` (AgentServerMessage field 4). */
export function extractKvMessage(payload: Uint8Array): CursorKvMessage | undefined {
  for (const top of iterFields(payload)) {
    if (top.field !== 4 || top.wire !== 2) continue;
    let id = 0;
    let caseField: number | undefined;
    for (const field of iterFields(top.data)) {
      if (field.field === 1 && field.wire === 0 && field.varint !== undefined) {
        id = Number(field.varint);
      } else if (field.wire === 2 && (field.field === 2 || field.field === 3)) {
        caseField ??= field.field;
      }
    }
    return { id, ...(caseField === undefined ? {} : { caseField }) };
  }
  return undefined;
}

/** True when this frame is a progress/heartbeat-style update with no user-visible payload. */
export function isCursorProgressPayload(payload: Uint8Array): boolean {
  for (const top of iterFields(payload)) {
    if (top.field === 1 && top.wire === 2) {
      for (const mid of iterFields(top.data)) {
        // tokenDelta(8), heartbeat(13), thinkingCompleted(5), summary*(9-11), partialToolCall(7)
        if (
          mid.field === 5 ||
          mid.field === 7 ||
          mid.field === 8 ||
          mid.field === 9 ||
          mid.field === 10 ||
          mid.field === 11 ||
          mid.field === 13
        ) {
          return true;
        }
        // toolCallStarted(2) without completion is progress
        if (mid.field === 2) return true;
      }
    }
    if (top.field === 3 || top.field === 4 || top.field === 5) return true;
  }
  return false;
}

function extractExecMcpToolCall(payload: Uint8Array): CursorExtractedToolCall | undefined {
  const exec = extractExecMessage(payload);
  if (exec === undefined || exec.caseField !== 11) return undefined;
  const call = decodeMcpArgs(exec.caseData);
  if (call === undefined) return undefined;
  // Only bridge SuperLiora-advertised client tools; other MCP providers stay on native exec.
  if (call.providerId !== undefined && call.providerId !== CURSOR_PROVIDER_ID) {
    return undefined;
  }
  return {
    name: normalizeCursorToolName(call.name),
    inputJson: call.inputJson,
    ...(call.toolCallId === undefined ? {} : { toolCallId: call.toolCallId }),
  };
}

function extractInteractionMcpToolCall(payload: Uint8Array): CursorExtractedToolCall | undefined {
  for (const top of iterFields(payload)) {
    if (top.field !== 1 || top.wire !== 2) continue;
    for (const update of iterFields(top.data)) {
      // tool_call_completed = 3 (also accept partial=7 only when args look complete — skip)
      if (update.field !== 3 || update.wire !== 2) continue;
      let callId: string | undefined;
      let toolCallBuf: Uint8Array | undefined;
      for (const part of iterFields(update.data)) {
        if (part.field === 1 && part.wire === 2) {
          callId = Buffer.from(part.data).toString('utf8');
        } else if (part.field === 2 && part.wire === 2) {
          toolCallBuf = part.data;
        }
      }
      if (toolCallBuf === undefined) continue;
      const mcp = extractMcpToolCallFromToolCall(toolCallBuf);
      if (mcp === undefined) continue;
      return {
        name: normalizeCursorToolName(mcp.name),
        inputJson: mcp.inputJson,
        toolCallId: mcp.toolCallId ?? callId,
      };
    }
  }
  return undefined;
}

function extractMcpToolCallFromToolCall(
  toolCallBuf: Uint8Array,
): CursorExtractedToolCall | undefined {
  for (const field of iterFields(toolCallBuf)) {
    // ToolCall.mcp_tool_call = 15
    if (field.field !== 15 || field.wire !== 2) continue;
    for (const inner of iterFields(field.data)) {
      // McpToolCall.args = 1
      if (inner.field === 1 && inner.wire === 2) {
        const call = decodeMcpArgs(inner.data);
        if (call === undefined) return undefined;
        if (call.providerId !== undefined && call.providerId !== CURSOR_PROVIDER_ID) {
          return undefined;
        }
        return {
          name: normalizeCursorToolName(call.name),
          inputJson: call.inputJson,
          ...(call.toolCallId === undefined ? {} : { toolCallId: call.toolCallId }),
        };
      }
    }
  }
  return undefined;
}

function extractNestedText(payload: Uint8Array, inner: number): string | undefined {
  for (const f1 of iterFields(payload)) {
    if (f1.field !== 1 || f1.wire !== 2) continue;
    for (const mid of iterFields(f1.data)) {
      if (mid.field !== inner || mid.wire !== 2) continue;
      for (const leaf of iterFields(mid.data)) {
        if (leaf.field === 1 && leaf.wire === 2) {
          const text = Buffer.from(leaf.data).toString('utf8');
          if (text.length > 0) return text;
        }
      }
    }
  }
  return undefined;
}

function decodeMcpArgs(buf: Uint8Array):
  | {
      readonly name: string;
      readonly inputJson: string;
      readonly toolCallId?: string;
      readonly providerId?: string;
    }
  | undefined {
  let name: string | undefined;
  let toolName: string | undefined;
  let toolCallId: string | undefined;
  let providerId: string | undefined;
  const args: Record<string, unknown> = {};
  for (const field of iterFields(buf)) {
    if (field.wire !== 2) continue;
    switch (field.field) {
      case 1:
        name = Buffer.from(field.data).toString('utf8');
        break;
      case 5:
        toolName = Buffer.from(field.data).toString('utf8');
        break;
      case 3:
        toolCallId = Buffer.from(field.data).toString('utf8');
        break;
      case 4:
        providerId = Buffer.from(field.data).toString('utf8');
        break;
      case 2: {
        let key: string | undefined;
        let valueBuf: Uint8Array | undefined;
        for (const entry of iterFields(field.data)) {
          if (entry.field === 1 && entry.wire === 2) {
            key = Buffer.from(entry.data).toString('utf8');
          } else if (entry.field === 2 && entry.wire === 2) {
            valueBuf = entry.data;
          }
        }
        if (key !== undefined && valueBuf !== undefined) {
          args[key] = decodeProtobufValue(valueBuf);
        }
        break;
      }
      default:
        break;
    }
  }
  const resolved = toolName ?? name;
  if (resolved === undefined || resolved.length === 0) return undefined;
  return {
    name: resolved,
    inputJson: JSON.stringify(args),
    ...(toolCallId === undefined || toolCallId.length === 0 ? {} : { toolCallId }),
    ...(providerId === undefined || providerId.length === 0 ? {} : { providerId }),
  };
}
