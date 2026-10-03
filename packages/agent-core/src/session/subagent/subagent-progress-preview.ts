/**
 * Subagent live progress stats and tool-call preview / chip detail helpers.
 */

import type { Agent } from '../../agent';
import type { SubagentToolDetail } from '@superliora/protocol';

const SUBAGENT_TOOL_ARGS_PREVIEW_LENGTH = 400;
const SUBAGENT_TOOL_RESULT_PREVIEW_LENGTH = 500;
const SUBAGENT_TOOL_COMMAND_PREVIEW_LENGTH = 120;

export interface SubagentProgressStats {
  readonly toolCount: number;
  readonly lastTool: string | undefined;
  readonly lastTarget: string | undefined;
  readonly tokens: number;
}

/** Aggregate live progress stats for a running subagent (T3-7 telemetry). */
export function collectSubagentProgressStats(child: Agent): SubagentProgressStats {
  let toolCount = 0;
  let lastTool: string | undefined;
  let lastTarget: string | undefined;
  for (const message of child.context.history) {
    if (message.role !== 'assistant') continue;
    for (const toolCall of message.toolCalls) {
      toolCount += 1;
      lastTool = toolCall.name;
      lastTarget = summarizeToolTarget(toolCall.arguments ?? undefined);
    }
  }
  const total = child.usage.data().total;
  const tokens =
    total === undefined
      ? 0
      : total.inputOther + total.output + total.inputCacheRead + total.inputCacheCreation;
  return { toolCount, lastTool, lastTarget, tokens };
}

export function summarizeToolTarget(argsJson: string | undefined): string | undefined {
  if (argsJson === undefined || argsJson.length === 0) return undefined;
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    for (const key of ['path', 'command', 'pattern', 'query', 'url', 'description']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.length > 0) {
        return value.length > 80 ? `${value.slice(0, 80)}…` : value;
      }
    }
  } catch {
    // Fall through to the raw snippet below.
  }
  const raw = argsJson.trim();
  return raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
}

/**
 * Flatten a tool payload into a single-line preview, so `subagent.tool_call` /
 * `subagent.tool_result` events stay small on the wire (Phase 1-A). The TUI
 * never receives the full args / result.
 *
 * The scan is bounded by `maxLength` *before* flattening and truncation. Only
 * the leading `maxLength` characters can survive `truncateToolPayloadPreview`,
 * so stringifying and regex-flattening the whole payload was pure waste — a
 * 8 KB tool arg cost ~660 µs per event to produce 400 characters. The extra
 * lookback covers a whitespace run straddling the cut, which must still
 * collapse to a single space at the boundary.
 */
function flattenToolPayloadPreview(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  // Above this size the payload is certainly truncated, so build the JSON
  // lazily and stop as soon as the prefix is known. Below it, plain
  // `JSON.stringify` is faster than the incremental walk and keeps the common
  // small-args case on the well-tested path.
  if (typeof value !== 'string' && isLikelyLargeValue(value, maxLength)) {
    const lazy = lazyJsonPrefix(value, maxLength + WHITESPACE_RUN_LOOKAHEAD);
    return collapseWhitespace(lazy, maxLength);
  }
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      const json = JSON.stringify(value);
      if (json === undefined) return undefined;
      text = json;
    } catch {
      text = '[unserializable]';
    }
  }
  return collapseWhitespace(text, maxLength);
}

/** Below this many characters, `JSON.stringify` wins over the lazy walk. */
const LAZY_JSON_MIN_LENGTH = 2_048;

function isLikelyLargeValue(value: unknown, maxLength: number): boolean {
  if (maxLength >= LAZY_JSON_MIN_LENGTH) return false;
  if (typeof value === 'string') return value.length > LAZY_JSON_MIN_LENGTH;
  if (Array.isArray(value)) {
    // First elements are enough to decide: tool args are homogeneous.
    let budget = LAZY_JSON_MIN_LENGTH;
    for (const entry of value) {
      budget -= estimateJsonLength(entry);
      if (budget <= 0) return true;
      if (budget > LAZY_JSON_MIN_LENGTH) break;
    }
    return false;
  }
  if (typeof value === 'object') {
    let budget = LAZY_JSON_MIN_LENGTH;
    for (const entry of Object.values(value as Record<string, unknown>)) {
      budget -= estimateJsonLength(entry);
      if (budget <= 0) return true;
      if (budget > LAZY_JSON_MIN_LENGTH) break;
    }
    return false;
  }
  return false;
}

function estimateJsonLength(value: unknown): number {
  if (typeof value === 'string') return value.length + 2;
  if (value === null) return 4;
  if (typeof value === 'number' || typeof value === 'boolean') return 5;
  if (Array.isArray(value)) {
    let total = 2;
    for (const entry of value) total += estimateJsonLength(entry) + 1;
    return total;
  }
  if (typeof value === 'object') {
    let total = 2;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      total += key.length + 3 + estimateJsonLength(entry) + 1;
    }
    return total;
  }
  return 9;
}

/**
 * Build just enough of `JSON.stringify(value)` to cover `maxLength`
 * characters, in the same syntax the real serializer emits, then stop. Used
 * only when the result is guaranteed to be truncated, so the tail cannot
 * affect the preview.
 */
function lazyJsonPrefix(value: unknown, maxLength: number): string {
  let out = '';
  const visit = (node: unknown): void => {
    if (out.length >= maxLength) return;
    if (node === null) {
      out += 'null';
      return;
    }
    switch (typeof node) {
      case 'string':
        out += JSON.stringify(node).slice(0, maxLength - out.length);
        return;
      case 'number':
      case 'boolean':
        out += String(node);
        return;
      case 'object':
        break;
      default:
        out += 'null';
        return;
    }
    if (Array.isArray(node)) {
      out += '[';
      for (let i = 0; i < node.length; i++) {
        if (i > 0) out += ',';
        visit(node[i]);
        if (out.length >= maxLength) return;
      }
      out += ']';
      return;
    }
    out += '{';
    let first = true;
    for (const [key, entry] of Object.entries(node as Record<string, unknown>)) {
      if (!first) out += ',';
      first = false;
      out += `${JSON.stringify(key)}:`;
      visit(entry);
      if (out.length >= maxLength) return;
    }
    out += '}';
  };
  visit(value);
  return out;
}

function collapseWhitespace(text: string, maxLength: number): string | undefined {
  // A whitespace run longer than this cannot be distinguished by the collapse,
  // so cap the lookahead: a 100 KB run costs the same as a 1 KB one.
  const scanLimit = Math.min(text.length, maxLength + WHITESPACE_RUN_LOOKAHEAD);
  let flat = '';
  // A collapsed run only becomes a space once a later non-space char exists —
  // this is what `replaceAll(/\s+/g, ' ').trim()` produced, including the
  // trailing trim, so leading runs never emit and a trailing run never sticks.
  let pendingSpace = false;
  for (let i = 0; i < scanLimit; i++) {
    const code = text.codePointAt(i);
    if (code === 32 || code === 9 || code === 10 || code === 13) {
      pendingSpace = flat.length > 0;
      continue;
    }
    if (pendingSpace) {
      flat += ' ';
      pendingSpace = false;
    }
    flat += text[i];
  }
  return flat.length > 0 ? flat : undefined;
}

/**
 * Whitespace-run lookahead kept when bounding the flatten scan. A run longer
 * than this collapses to one space regardless, so the boundary cannot depend
 * on characters beyond it.
 */
const WHITESPACE_RUN_LOOKAHEAD = 64;

function truncateToolPayloadPreview(text: string | undefined, maxLength: number): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function previewSubagentToolArgs(args: unknown): string | undefined {
  return truncateToolPayloadPreview(
    flattenToolPayloadPreview(args, SUBAGENT_TOOL_ARGS_PREVIEW_LENGTH),
    SUBAGENT_TOOL_ARGS_PREVIEW_LENGTH,
  );
}

export function previewSubagentToolResult(output: unknown): string | undefined {
  return truncateToolPayloadPreview(
    flattenToolPayloadPreview(output, SUBAGENT_TOOL_RESULT_PREVIEW_LENGTH),
    SUBAGENT_TOOL_RESULT_PREVIEW_LENGTH,
  );
}

const SUBAGENT_TOOL_PROGRESS_KINDS = ['stdout', 'stderr', 'progress', 'status'] as const;
type SubagentToolProgressKind = (typeof SUBAGENT_TOOL_PROGRESS_KINDS)[number];

function isSubagentToolProgressKind(kind: string): kind is SubagentToolProgressKind {
  return (SUBAGENT_TOOL_PROGRESS_KINDS as readonly string[]).includes(kind);
}

/**
 * Bound a child `tool.progress` chunk for the parent-side
 * `subagent.tool_progress` event. `custom` updates are dropped so opaque
 * payloads never hit the wire. Empty text yields `undefined` (no event).
 * stdout/stderr/progress keep internal newlines so clients can paint
 * logs incrementally; status titles are flattened like args previews.
 */
export function previewSubagentToolProgress(update: {
  readonly kind: string;
  readonly text?: string | undefined;
}): { readonly kind: SubagentToolProgressKind; readonly textPreview: string } | undefined {
  if (!isSubagentToolProgressKind(update.kind)) return undefined;
  if (update.kind === 'status') {
    const textPreview = truncateToolPayloadPreview(
      flattenToolPayloadPreview(update.text, SUBAGENT_TOOL_RESULT_PREVIEW_LENGTH),
      SUBAGENT_TOOL_RESULT_PREVIEW_LENGTH,
    );
    if (textPreview === undefined) return undefined;
    return { kind: update.kind, textPreview };
  }
  if (typeof update.text !== 'string') return undefined;
  if (update.text.trim().length === 0) return undefined;
  const textPreview = truncateToolPayloadPreview(update.text, SUBAGENT_TOOL_RESULT_PREVIEW_LENGTH);
  if (textPreview === undefined) return undefined;
  return { kind: update.kind, textPreview };
}

/** Bounded, factual chip details for the two model tools. */
export function describeSubagentToolDetail(
  name: string,
  args: unknown,
): SubagentToolDetail | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const record = args as Record<string, unknown>;
  switch (name) {
    case 'Bash': {
      const command = toolDetailStringArg(record, 'command');
      if (command === undefined) return undefined;
      const flat = command.replaceAll(/\s+/g, ' ').trim();
      if (flat.length === 0) return undefined;
      return {
        kind: 'bash',
        command: truncateToolPayloadPreview(flat, SUBAGENT_TOOL_COMMAND_PREVIEW_LENGTH) ?? flat,
      };
    }
    case 'SessionControl': {
      const operation = toolDetailStringArg(record, 'operation');
      if (operation === undefined) return undefined;
      const description = toolDetailStringArg(record, 'description');
      return {
        kind: 'session',
        operation,
        ...(description === undefined ? {} : {
          description: truncateToolPayloadPreview(description, SUBAGENT_TOOL_COMMAND_PREVIEW_LENGTH),
        }),
      };
    }
    default:
      return undefined;
  }
}

function toolDetailStringArg(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

