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

const MCP_NAME_RE = new RegExp(
  String.raw`mcp_(?:${CURSOR_PROVIDER_ID}|_${CURSOR_PROVIDER_ID}_)_([A-Za-z][\w]*)`,
  'g',
);

interface McpTextCallSpan {
  readonly name: string;
  readonly argsText: string;
  readonly start: number;
  readonly end: number;
}

/** Remove leaked wire/prompt tags from assistant-visible text. */
export function sanitizeCursorAssistantText(text: string): string {
  if (text.length === 0) return text;
  let out = text.replace(TOOL_CALL_BLOCK_RE, '');
  out = out.replace(TOOL_RESULT_BLOCK_RE, '');
  out = out.replace(TOOL_USE_BLOCK_RE, '');
  out = out.replace(THINKING_BLOCK_RE, '');
  out = out.replace(ROLE_TAG_RE, '');
  const leftover = findMcpTextCalls(out);
  for (let i = leftover.length - 1; i >= 0; i--) {
    const call = leftover[i];
    if (call === undefined) continue;
    out = `${out.slice(0, call.start)}${out.slice(call.end)}`;
  }
  return out.replaceAll(/\n{3,}/g, '\n\n').trim();
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
  for (const call of findMcpTextCalls(text)) {
    const inputJson = parseLooseToolArgs(call.argsText);
    const key = `${call.name}:${inputJson}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({
      name: call.name,
      inputJson,
      toolCallId: randomUUID(),
    });
  }
  return found;
}

function findMcpTextCalls(text: string): McpTextCallSpan[] {
  const found: McpTextCallSpan[] = [];
  let lastEnd = 0;
  for (const match of text.matchAll(MCP_NAME_RE)) {
    const name = match[1];
    const start = match.index;
    if (name === undefined || name.length === 0 || start === undefined) continue;
    if (start < lastEnd) continue;
    let cursor = start + match[0].length;
    while (cursor < text.length && (text.codePointAt(cursor) ?? 33) <= 32) cursor += 1;
    let argsText = '';
    let end = cursor;
    if (text[cursor] === '(') {
      const close = indexOfMatchingClose(text, cursor);
      if (close === -1) {
        argsText = text.slice(cursor + 1);
        end = text.length;
      } else {
        argsText = text.slice(cursor + 1, close);
        end = close + 1;
      }
    }
    lastEnd = end;
    found.push({ name, argsText: argsText.trim(), start, end });
  }
  return found;
}

function indexOfMatchingClose(text: string, openIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === undefined) break;
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseLooseToolArgs(argsText: string): string {
  if (argsText.length === 0) return '{}';
  const trimmed = argsText.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // kwargs, not a JSON payload
    }
  }
  const out: Record<string, unknown> = {};
  for (const part of splitTopLevelCommas(trimmed)) {
    const slice = part.trim();
    if (slice.length === 0) continue;
    const eq = slice.indexOf('=');
    if (eq <= 0) continue;
    const key = slice.slice(0, eq).trim();
    if (key.length === 0) continue;
    out[key] = parseLooseValue(slice.slice(eq + 1));
  }
  return JSON.stringify(out);
}

function parseLooseValue(raw: string): unknown {
  const value = raw.trim();
  if (value.length === 0) return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);

  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      const inner = value.slice(1, -1).trim();
      if (inner.length === 0) return [];
      return splitTopLevelCommas(inner).map((item) => parseLooseValue(item));
    }
  }

  if (value.startsWith('{') && value.endsWith('}')) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      // keep as string
    }
  }

  if (value.length >= 2) {
    const start = value[0];
    const end = value.at(-1);
    if (start === '"' && end === '"') {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value.slice(1, -1);
      }
    }
    if (start === "'" && end === "'") {
      return value.slice(1, -1);
    }
  }
  return value;
}

function splitTopLevelCommas(text: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: '"' | "'" | null = null;
  let paren = 0;
  let bracket = 0;
  let brace = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === undefined) break;
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    switch (ch) {
      case '"':
      case "'":
        quote = ch;
        break;
      case '(':
        paren += 1;
        break;
      case ')':
        if (paren > 0) paren -= 1;
        break;
      case '[':
        bracket += 1;
        break;
      case ']':
        if (bracket > 0) bracket -= 1;
        break;
      case '{':
        brace += 1;
        break;
      case '}':
        if (brace > 0) brace -= 1;
        break;
      case ',':
        if (paren === 0 && bracket === 0 && brace === 0) {
          parts.push(text.slice(start, i));
          start = i + 1;
        }
        break;
      default:
        break;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
