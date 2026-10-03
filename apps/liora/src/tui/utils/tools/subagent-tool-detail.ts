/**
 * Observed Bash command / SessionControl operation targets and stream tails.
 */

import type { Event } from '@superliora/sdk';


type SubagentToolCallEventPayload = Extract<Event, { type: 'subagent.tool_call' }>;

/** Structured chip detail attached to `subagent.tool_call` (Phase 1-B). */
export type SubagentToolDetail = NonNullable<SubagentToolCallEventPayload['detail']>;
const TARGET_KEYS = ['command', 'description', 'operation', 'id'] as const;


/**
 * Structured Bash command first, then supported runtime args from the preview.
 */
export function resolveSubagentToolTarget(
  detail: SubagentToolDetail | undefined,
  argsPreview: string | undefined,
): string | undefined {
  if (detail?.kind === 'bash') return detail.command;
  if (detail?.kind === 'session') return detail.description ?? detail.operation;
  if (argsPreview === undefined) return undefined;
  try {
    const args: unknown = JSON.parse(argsPreview);
    if (args === null || typeof args !== 'object') return undefined;
    for (const key of TARGET_KEYS) {
      const value = (args as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  } catch {
    // Streaming argument fragments are not yet complete JSON.
  }
  return undefined;
}


/**
 * Last non-empty line of a `subagent.tool_progress` `textPreview`.
 * stdout/stderr/progress keep internal newlines at the emitter; paint
 * surfaces show the rolling tail, not the whole 500-char chunk.
 */
export function lastNonEmptyLine(text: string): string {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = normalized.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trim();
    if (line.length > 0) return line;
  }
  return '';
}
