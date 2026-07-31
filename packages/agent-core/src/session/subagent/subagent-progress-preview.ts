/**
 * Subagent live progress stats and tool-call preview / chip detail helpers.
 */

import type { Agent } from '../../agent';
import type { SubagentToolDetail } from '@superliora/protocol';

const SUBAGENT_TOOL_ARGS_PREVIEW_LENGTH = 400;
const SUBAGENT_TOOL_RESULT_PREVIEW_LENGTH = 500;
const SUBAGENT_TOOL_COMMAND_PREVIEW_LENGTH = 120;
const SUBAGENT_EDIT_DIFF_LINE_CAP = 300;

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
 * Flatten a tool payload into a single-line preview and bound it, so
 * `subagent.tool_call` / `subagent.tool_result` events stay small on the
 * wire (Phase 1-A). The TUI never receives the full args / result.
 */
function stringifyToolPayloadPreview(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
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
  const flat = text.replaceAll(/\s+/g, ' ').trim();
  return flat.length > 0 ? flat : undefined;
}

function truncateToolPayloadPreview(text: string | undefined, maxLength: number): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function previewSubagentToolArgs(args: unknown): string | undefined {
  return truncateToolPayloadPreview(
    stringifyToolPayloadPreview(args),
    SUBAGENT_TOOL_ARGS_PREVIEW_LENGTH,
  );
}

export function previewSubagentToolResult(output: unknown): string | undefined {
  return truncateToolPayloadPreview(
    stringifyToolPayloadPreview(output),
    SUBAGENT_TOOL_RESULT_PREVIEW_LENGTH,
  );
}

/**
 * Structured chip detail for the common child tools (Phase 1-B realtime
 * overhaul). Computed from the FULL child args before preview truncation so
 * clients can render the same numeric chips the main agent's tool stream
 * shows. Unknown tools and missing/invalid args yield `undefined`, keeping
 * the `subagent.tool_call` payload strictly additive.
 */
export function describeSubagentToolDetail(
  name: string,
  args: unknown,
): SubagentToolDetail | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const record = args as Record<string, unknown>;
  switch (name) {
    case 'Edit': {
      const path = toolDetailStringArg(record, 'path');
      if (path === undefined) return undefined;
      const oldString = typeof record['old_string'] === 'string' ? record['old_string'] : '';
      const newString = typeof record['new_string'] === 'string' ? record['new_string'] : '';
      const { added, removed } = countEditLineChanges(oldString, newString);
      return { kind: 'edit', path, addedLines: added, removedLines: removed };
    }
    case 'Write': {
      const path = toolDetailStringArg(record, 'path');
      const content = typeof record['content'] === 'string' ? record['content'] : undefined;
      if (path === undefined || content === undefined) return undefined;
      const normalized = content.endsWith('\n') ? content.slice(0, -1) : content;
      const lines = normalized.length > 0 ? normalized.split('\n').length : 0;
      return { kind: 'write', path, lines, bytes: Buffer.byteLength(content, 'utf8') };
    }
    case 'Read': {
      const path = toolDetailStringArg(record, 'path');
      return path === undefined ? undefined : { kind: 'read', path };
    }
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
    case 'Grep':
    case 'Glob': {
      const pattern = toolDetailStringArg(record, 'pattern');
      return pattern === undefined ? undefined : { kind: 'search', pattern };
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

/**
 * Added / removed line counts between Edit `old_string` and `new_string`.
 * Uses an LCS line diff (same approach as the TUI chip) bounded by
 * {@link SUBAGENT_EDIT_DIFF_LINE_CAP}; larger edits fall back to raw line
 * counts so the emitter never runs an unbounded matrix.
 */
function countEditLineChanges(
  oldString: string,
  newString: string,
): { added: number; removed: number } {
  if (oldString.length === 0 && newString.length === 0) return { added: 0, removed: 0 };
  // Empty side counts as zero lines (matches the TUI diff chip semantics).
  const oldLines = oldString.length > 0 ? oldString.split('\n') : [];
  const newLines = newString.length > 0 ? newString.split('\n') : [];
  if (
    oldLines.length > SUBAGENT_EDIT_DIFF_LINE_CAP ||
    newLines.length > SUBAGENT_EDIT_DIFF_LINE_CAP
  ) {
    return { added: newLines.length, removed: oldLines.length };
  }
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  const dp: number[][] = Array.from({ length: oldCount + 1 }, () =>
    Array.from({ length: newCount + 1 }, () => 0),
  );
  for (let i = 1; i <= oldCount; i++) {
    for (let j = 1; j <= newCount; j++) {
      dp[i]![j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const common = dp[oldCount]![newCount]!;
  return { added: newCount - common, removed: oldCount - common };
}
