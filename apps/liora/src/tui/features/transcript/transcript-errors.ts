/**
 * Collects error items from the current session transcript for the `/errors`
 * navigator. Two signals are recognized:
 *
 * - tool calls whose result is flagged `is_error` (source `'tool'`), and
 * - entries rendered with the `error` color token (source `'status'`).
 *
 * An entry matching both signals is emitted once as a `'tool'` error. Items
 * preserve transcript order and carry the original entry index so the host
 * can scroll the matching transcript entry into view.
 */

import { stripAnsiControls } from '#/tui/renderer';
import type { TranscriptEntry } from '#/tui/types';

export interface TranscriptErrorItem {
  /** Index of the entry in `state.transcriptEntries`. */
  readonly index: number;
  readonly entryId: string;
  readonly source: 'tool' | 'status';
  /** Tool name for `source: 'tool'` items. */
  readonly toolName?: string;
  /** First meaningful line of the error payload, ANSI-stripped, capped. */
  readonly summary: string;
}

const SUMMARY_MAX_LENGTH = 120;
const ELLIPSIS = '…';

/** Reduce a raw payload to a single-line, ANSI-free summary capped at 120 chars. */
function toSummary(raw: string): string {
  const lines = stripAnsiControls(raw).split(/\r?\n/);
  const line = lines.map((candidate) => candidate.trim()).find((candidate) => candidate.length > 0) ?? '';
  if (line.length <= SUMMARY_MAX_LENGTH) return line;
  return `${line.slice(0, SUMMARY_MAX_LENGTH - 1)}${ELLIPSIS}`;
}

export function collectTranscriptErrors(
  entries: readonly TranscriptEntry[],
): TranscriptErrorItem[] {
  const items: TranscriptErrorItem[] = [];
  entries.forEach((entry, index) => {
    const result = entry.toolCallData?.result;
    if (entry.kind === 'tool_call' && result?.is_error === true) {
      items.push({
        index,
        entryId: entry.id,
        source: 'tool',
        toolName: entry.toolCallData?.name,
        summary: toSummary(result.output),
      });
      return;
    }
    if (entry.color === 'error') {
      items.push({
        index,
        entryId: entry.id,
        source: 'status',
        summary: toSummary(entry.content),
      });
    }
  });
  return items;
}
