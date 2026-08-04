/**
 * Strip Cursor/prompt protocol markup that Grok sometimes echoes into textDelta,
 * and recover `mcp_superliora_Tool(args)` calls when the model dumps tools as text.
 */

import { randomUUID } from 'node:crypto';

import { CURSOR_PROVIDER_ID } from './constants';

export interface RecoveredTextToolCall {
  readonly name: string;
  readonly inputJson: string;
  readonly toolCallId: string;
}

const TOOL_CALL_BLOCK_RE =
  /<tool_call\b[^>]*>[\s\S]*?(?:<\/tool_call>|(?=<\/assistant\b)|(?=<tool_result\b)|$)/gi;

const TOOL_RESULT_BLOCK_RE = /<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi;

const TOOL_USE_BLOCK_RE = /<tool_use\b[^>]*>[\s\S]*?<\/tool_use>/gi;

const ROLE_TAG_RE = /<\/?(?:system|user|assistant|tool)\b[^>]*>/gi;

const THINKING_BLOCK_RE = /<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi;

const MCP_CALL_RE = new RegExp(
  String.raw`mcp_(?:${CURSOR_PROVIDER_ID}|_${CURSOR_PROVIDER_ID}_)_([A-Za-z][\w]*)\s*(?:\(([^)]*)\))?`,
  'g',
);

const BARE_MCP_LINE_RE = new RegExp(
  String.raw`^\s*mcp_(?:${CURSOR_PROVIDER_ID}|_${CURSOR_PROVIDER_ID}_)_[A-Za-z][\w]*\s*(?:\([^)]*\))?\s*$`,
  'gm',
);

/** Remove leaked wire/prompt tags from assistant-visible text. */
export function sanitizeCursorAssistantText(text: string): string {
  if (text.length === 0) return text;
  let out = text.replace(TOOL_CALL_BLOCK_RE, '');
  out = out.replace(TOOL_RESULT_BLOCK_RE, '');
  out = out.replace(TOOL_USE_BLOCK_RE, '');
  out = out.replace(THINKING_BLOCK_RE, '');
  out = out.replace(ROLE_TAG_RE, '');
  out = out.replace(BARE_MCP_LINE_RE, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Recover structured tool calls from model text that used Cursor's display names
 * instead of (or in addition to) protobuf MCP exec frames.
 */
export function recoverToolCallsFromCursorText(text: string): RecoveredTextToolCall[] {
  if (!text.includes(`mcp_${CURSOR_PROVIDER_ID}`) && !text.includes(`mcp__${CURSOR_PROVIDER_ID}__`)) {
    return [];
  }
  const found: RecoveredTextToolCall[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MCP_CALL_RE)) {
    const toolName = match[1];
    if (toolName === undefined || toolName.length === 0) continue;
    const argsText = (match[2] ?? '').trim();
    const inputJson = parseLooseToolArgs(argsText);
    const key = `${toolName}:${inputJson}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      name: toolName,
      inputJson,
      toolCallId: randomUUID(),
    });
  }
  return found;
}

function parseLooseToolArgs(argsText: string): string {
  if (argsText.length === 0) return '{}';
  // Already JSON object/array.
  if (
    (argsText.startsWith('{') && argsText.endsWith('}')) ||
    (argsText.startsWith('[') && argsText.endsWith(']'))
  ) {
    try {
      JSON.parse(argsText);
      return argsText;
    } catch {
      // fall through
    }
  }
  // Python/KW style: skill=game-art, limit=20, flag=true
  const out: Record<string, unknown> = {};
  const parts = argsText
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === 'true' || value === 'false') {
      out[key] = value === 'true';
    } else if (/^-?\d+(?:\.\d+)?$/.test(value)) {
      out[key] = Number(value);
    } else {
      out[key] = value;
    }
  }
  return JSON.stringify(out);
}
