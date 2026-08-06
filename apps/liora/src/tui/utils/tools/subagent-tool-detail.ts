/**
 * Shared formatting helpers for `subagent.tool_call` structured detail
 * (Phase 1-B chips). Used by the Mission Control ops feed and the swarm ops
 * feed alike so both streams render identical targets/stats.
 */

import type { Event } from '@superliora/sdk';

import { formatEditChip, formatWriteChip } from '#/tui/components/messages/tool-renderers/chip';

type SubagentToolCallEventPayload = Extract<Event, { type: 'subagent.tool_call' }>;

/** Structured chip detail attached to `subagent.tool_call` (Phase 1-B). */
export type SubagentToolDetail = NonNullable<SubagentToolCallEventPayload['detail']>;

/**
 * Plain rendering parts for a structured tool detail (Phase 1-B). `target` is
 * the compact object of the call (path / command / pattern); `chip` reuses
 * the main agent's header formatters so both streams show identical stats.
 */
export function subagentToolDetailParts(detail: SubagentToolDetail | undefined): {
  target: string | undefined;
  chip: string | undefined;
} {
  if (detail === undefined) return { target: undefined, chip: undefined };
  switch (detail.kind) {
    case 'edit': {
      const chip = formatEditChip({ added: detail.addedLines, removed: detail.removedLines });
      return { target: detail.path, chip: chip.length > 0 ? chip : undefined };
    }
    case 'write':
      return { target: detail.path, chip: formatWriteChip({ lines: detail.lines }) };
    case 'read':
      return { target: detail.path, chip: undefined };
    case 'bash':
      return { target: detail.command, chip: undefined };
    case 'search':
      return { target: detail.pattern, chip: undefined };
  }
}

/**
 * Compact single-line feed body for surfaces that render plain text (e.g.
 * the UltraSwarm ops feed): `Edit src/a.ts +3 -1`, `Bash pnpm test`. Falls
 * back to the raw args preview when no structured detail is present.
 */
export function describeSubagentToolFeedBody(
  name: string,
  detail: SubagentToolDetail | undefined,
  argsPreview: string | undefined,
): string {
  const { target, chip } = subagentToolDetailParts(detail);
  const suffix = target ?? argsPreview;
  const parts = [name];
  if (suffix !== undefined && suffix.length > 0) parts.push(suffix);
  if (chip !== undefined && chip.length > 0) parts.push(chip);
  return parts.join(' ');
}
