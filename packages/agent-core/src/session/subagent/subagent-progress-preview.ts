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
  try {
    const text = typeof value === 'string'
      ? value
      : lazyJsonPrefix(value, maxLength + WHITESPACE_RUN_LOOKAHEAD);
    return text === undefined ? undefined : collapseWhitespace(text, maxLength);
  } catch {
    return '[unserializable]';
  }
}

/**
 * Serialize only the prefix we can display. Bound both emitted characters and
 * traversal: omitted properties and deeply nested containers must not consume
 * unlimited work without producing text. Unsupported/cyclic payloads use the
 * same fallback as JSON.stringify failures. Unvisited tails are never read.
 */
function lazyJsonPrefix(value: unknown, maxLength: number): string | undefined {
  let out = '';
  let visits = 0;
  const ancestors = new Set<object>();
  const append = (text: string): void => {
    out += text.slice(0, maxLength - out.length);
  };
  const appendString = (text: string): void => {
    // One extra code unit keeps a surrogate pair at the cut intact. Escaping
    // can only expand the source, so this is enough to fill the output budget.
    append(JSON.stringify(text.slice(0, maxLength - out.length + 1)));
  };
  const visit = (input: unknown, key: string, depth: number, arrayEntry = false): boolean => {
    if (++visits > 2_048 || depth > 128) throw new Error('Preview traversal limit');
    let node = input;
    if (node !== null && (typeof node === 'object' || typeof node === 'bigint')) {
      const toJSON = (node as { toJSON?: unknown }).toJSON;
      if (typeof toJSON === 'function') node = toJSON.call(node, key);
    }
    // Preserve JSON unboxing for local boxed primitives.
    // eslint-disable-next-line unicorn/no-instanceof-builtins
    if (node instanceof Number || node instanceof String || node instanceof Boolean) {
      node = node.valueOf();
    }
    switch (typeof node) {
      case 'undefined':
      case 'function':
      case 'symbol':
        if (arrayEntry) append('null');
        return arrayEntry;
      case 'bigint':
        throw new TypeError('Cannot serialize BigInt');
      case 'string':
        appendString(node);
        return true;
      case 'number':
        append(Number.isFinite(node) ? String(node) : 'null');
        return true;
      case 'boolean':
        append(String(node));
        return true;
      case 'object':
        break;
    }
    if (node === null) {
      append('null');
      return true;
    }
    const object = node as Record<string, unknown>;
    if (ancestors.has(object)) throw new TypeError('Circular preview payload');
    ancestors.add(object);
    if (Array.isArray(object)) {
      append('[');
      for (let i = 0; i < object.length && out.length < maxLength; i++) {
        if (i > 0) append(',');
        if (out.length < maxLength) visit(object[i], String(i), depth + 1, true);
      }
      append(']');
    } else {
      append('{');
      let first = true;
      for (const key in object) {
        if (out.length >= maxLength) break;
        if (++visits > 2_048) throw new Error('Preview traversal limit');
        if (!Object.hasOwn(object, key)) continue;
        // Roll back the key/comma if JSON.stringify would omit the value.
        const before = out;
        if (!first) append(',');
        appendString(key);
        append(':');
        if (out.length >= maxLength) break;
        if (visit(object[key], key, depth + 1)) first = false;
        else out = before;
      }
      append('}');
    }
    ancestors.delete(object);
    return true;
  };
  return visit(value, '', 0) ? out : undefined;
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
    if (/\s/.test(text[i] ?? '')) {
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
  const leadingText = update.text.slice(0, SUBAGENT_TOOL_RESULT_PREVIEW_LENGTH + WHITESPACE_RUN_LOOKAHEAD);
  if (leadingText.trim().length === 0) return undefined;
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
      const flat = collapseWhitespace(command, SUBAGENT_TOOL_COMMAND_PREVIEW_LENGTH);
      if (flat === undefined) return undefined;
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

