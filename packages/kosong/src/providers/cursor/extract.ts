/**
 * Extract assistant text, reasoning, and MCP tool calls from Cursor
 * AgentServerMessage payloads (hand-rolled field walks).
 */

import { decodeProtobufValue, iterFields } from './proto';

/** Assistant answer text delta: nested `f1.f1.f1` string. */
export function extractAnswerText(payload: Uint8Array): string | undefined {
  return extractNestedText(payload, 1);
}

/** Reasoning text delta: nested `f1.f4.f1` string. */
export function extractReasoningText(payload: Uint8Array): string | undefined {
  return extractNestedText(payload, 4);
}

/**
 * Decode a native MCP tool call:
 * `exec_server_message(2) → mcp_args(11) → McpArgs`.
 */
export function extractToolCall(
  payload: Uint8Array,
): { readonly name: string; readonly inputJson: string; readonly toolCallId?: string } | undefined {
  for (const esm of iterFields(payload)) {
    if (esm.field !== 2 || esm.wire !== 2) continue;
    for (const args of iterFields(esm.data)) {
      if (args.field === 11 && args.wire === 2) {
        const call = decodeMcpArgs(args.data);
        if (call !== undefined) return call;
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

function decodeMcpArgs(
  buf: Uint8Array,
): { readonly name: string; readonly inputJson: string; readonly toolCallId?: string } | undefined {
  let name: string | undefined;
  let toolName: string | undefined;
  let toolCallId: string | undefined;
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
  };
}
