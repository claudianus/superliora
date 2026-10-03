/**
 * Subagent phase / snapshot / live-output helpers for ToolCallComponent.
 * Pure or lightly-stateful (spawn-entrance registry). Methods that need
 * component instance fields stay on the class.
 */

import {
  projectRendererLineWindow,
  projectRendererNonEmptyLineWindow,
  truncateToWidth,
} from '#/tui/renderer';
import type { Utf8PrefixBuffer, ToolResultDisplay } from '@superliora/sdk';

import { BRAILLE_SPINNER_INTERVAL_MS } from '#/tui/constant/rendering';
import { appearanceAnimationNow } from '#/tui/features/appearance/appearance-effects';
import { TOOL_HEADER_ENTRANCE_MS } from '#/tui/features/transcript/transcript-entrance';

import { formatActivityLine } from './format';

export const MAX_SINGLE_SUBAGENT_TOOL_ROWS = 4;
// Cap the Agent `description` in the single-subagent header so a long prompt
// cannot wrap the header onto a second row and break the card's stable height.
export const MAX_SUBAGENT_DESCRIPTION_LENGTH = 60;
// Hanging indent for a sub-tool's previewed output, nested under its activity row.
export const SUBAGENT_SUBTOOL_OUTPUT_INDENT = 6;
export const SUBAGENT_ELAPSED_INTERVAL_MS = BRAILLE_SPINNER_INTERVAL_MS;
export const MAX_LIVE_OUTPUT_CHARS = 50_000;

/**
 * First-seen spawn timestamps keyed by `${toolCallId}:${agentId}`. Pins the
 * subagent spawn entrance to the first spawn render so streaming remounts
 * and clock-driven rebuilds decay the settle in place instead of replaying
 * it. Replayed subagents never pass through `onSubagentSpawned`, so history
 * never animates. Same bounded-map sweep as the header registry.
 */
const subagentSpawnFirstSeenMs = new Map<string, number>();
const SUBAGENT_SPAWN_FIRST_SEEN_MAX_ENTRIES = 128;

export function subagentSpawnEntranceStartedAt(toolCallId: string, agentId: string): number {
  const now = appearanceAnimationNow();
  if (subagentSpawnFirstSeenMs.size >= SUBAGENT_SPAWN_FIRST_SEEN_MAX_ENTRIES) {
    // Generous expiry: the longest subtle-mode entrance plus margin.
    const ttl = TOOL_HEADER_ENTRANCE_MS * 4;
    for (const [key, seen] of subagentSpawnFirstSeenMs) {
      if (now - seen > ttl) subagentSpawnFirstSeenMs.delete(key);
    }
  }
  const key = `${toolCallId}:${agentId}`;
  let seen = subagentSpawnFirstSeenMs.get(key);
  if (seen === undefined) {
    seen = now;
    subagentSpawnFirstSeenMs.set(key, seen);
  }
  return seen;
}

export type SubagentTextKind = 'thinking' | 'text';
export type SubagentPhase = 'queued' | 'spawning' | 'running' | 'done' | 'failed' | 'backgrounded';

export interface FinishedSubCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly output: string;
  readonly isError: boolean;
}

export interface OngoingSubCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly streamingArguments?: string | undefined;
  readonly streamingArgsBuffer?: Utf8PrefixBuffer;
}

export interface SubToolActivity {
  readonly id: string;
  name: string;
  args: Record<string, unknown>;
  phase: 'ongoing' | 'done' | 'failed';
  output?: string;
  /** Structured result projection, when the worker's harness attached one. */
  display?: ToolResultDisplay;
  readonly orderSeq: number;
}

/**
 * Immutable subagent state snapshot. `AgentGroupComponent` reads one-time
 * views via `ToolCallComponent.getSubagentSnapshot()` and renders its own
 * branch lines; `onSnapshotChange` notifies it when state changes.
 *
 * `latestActivity` priority, used only while running:
 *   1. latest ongoing sub-tool (`Using {name} ({keyArg})`)
 *   2. latest finished sub-tool (`Used {name} ({keyArg})`)
 *   3. last non-empty line from accumulated subagent text
 */
export interface ToolCallSubagentSnapshot {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolCallDescription: string;
  readonly agentName: string | undefined;
  readonly phase: SubagentPhase | undefined;
  readonly toolCount: number;
  readonly elapsedSeconds: number | undefined;
  readonly tokens: number;
  readonly isError: boolean;
  readonly errorText: string | undefined;
  readonly latestActivity: string | undefined;
}

export function backgroundFailureMessage(
  status: 'completed' | 'failed' | 'timed_out' | 'killed' | 'lost' | undefined,
): string | undefined {
  switch (status) {
    case 'lost':
      return 'Background agent lost (session restarted before completion)';
    case 'killed':
      return 'Background agent killed';
    case 'timed_out':
      return 'Background agent timed out';
    case 'failed':
      return 'Background agent failed';
    case 'completed':
    case undefined:
      return undefined;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function tailNonEmptyLines(text: string, maxLines: number): string[] {
  return [...projectRendererNonEmptyLineWindow({
    text,
    maxLines,
    tail: true,
  }).lines];
}

/**
 * Computes the second-level "latest activity" line for group rows:
 *   1. latest ongoing sub-tool (`Using {name} ({keyArg})`)
 *   2. latest finished sub-tool (`Used {name} ({keyArg})`)
 *   3. last non-empty line from accumulated subagent text
 */
export function computeLatestActivity(
  ongoing: ReadonlyMap<string, OngoingSubCall>,
  finished: readonly FinishedSubCall[],
  text: string,
): string | undefined {
  if (ongoing.size > 0) {
    let lastOngoing: OngoingSubCall | undefined;
    for (const call of ongoing.values()) lastOngoing = call;
    if (lastOngoing !== undefined) {
      return formatActivityLine('Using', lastOngoing.name, lastOngoing.args);
    }
  }
  if (finished.length > 0) {
    const last = finished.at(-1);
    if (last !== undefined) {
      return formatActivityLine('Used', last.name, last.args);
    }
  }
  if (text.length > 0) {
    const tail = text
      .split('\n')
      .toReversed()
      .find((l) => l.trim().length > 0);
    if (tail !== undefined) return tail.trim();
  }
  return undefined;
}

/**
 * Child lifecycle events are authoritative. SessionControl results acknowledge
 * operations; successful spawn ACKs never imply that the child finished.
 */
export function deriveSubagentPhase(input: {
  readonly backgroundTaskTerminalPhase: 'done' | 'failed' | undefined;
  readonly subagentPhase: SubagentPhase | undefined;
  readonly result: { readonly is_error?: boolean } | undefined;
}): SubagentPhase | undefined {
  if (input.backgroundTaskTerminalPhase !== undefined) {
    return input.backgroundTaskTerminalPhase;
  }
  if (input.subagentPhase === 'done' || input.subagentPhase === 'failed') return input.subagentPhase;
  if (input.result?.is_error) return 'failed';
  if (input.result !== undefined) return input.subagentPhase ?? 'backgrounded';
  return input.subagentPhase;
}

/**
 * Appends a live-output chunk for a sub-tool activity row, preserving the
 * existing truncation marker behaviour (once truncated, further chunks are
 * not concatenated — only the stored tail may be re-sliced).
 */
export function appendSubToolLiveOutputText(
  existingOutput: string,
  text: string,
  maxChars: number = MAX_LIVE_OUTPUT_CHARS,
): string {
  const alreadyTruncated = existingOutput.startsWith('[...truncated]\n');
  let output = alreadyTruncated ? existingOutput : existingOutput + text;
  if (output.length > maxChars) {
    if (alreadyTruncated) {
      // Already truncated — keep only the tail, avoiding re-concatenating the
      // prefix marker and re-slicing on every chunk.
      output = output.slice(output.length - maxChars);
    } else {
      output = `[...truncated]\n${output.slice(output.length - maxChars)}`;
    }
  }
  return output;
}

/** Truncate main-tool live output (always concatenates, then caps the tail). */
export function appendMainLiveOutputText(
  existing: string,
  text: string,
  wasTruncated: boolean,
  maxChars: number = MAX_LIVE_OUTPUT_CHARS,
): { text: string; truncated: boolean } {
  let liveOutput = existing + text;
  let truncated = wasTruncated;
  if (liveOutput.length > maxChars) {
    if (truncated) {
      liveOutput = liveOutput.slice(liveOutput.length - maxChars);
    } else {
      liveOutput = `[...truncated]\n${liveOutput.slice(liveOutput.length - maxChars)}`;
      truncated = true;
    }
  }
  return { text: liveOutput, truncated };
}

export function formatSubagentAgentId(agentId: string | undefined): string {
  const id = agentId ?? '';
  return id.length > 10 ? id.slice(0, 10) + '…' : id;
}

export function truncateSubagentDescription(
  raw: string,
  maxLength: number = MAX_SUBAGENT_DESCRIPTION_LENGTH,
): string {
  // Width-aware so CJK / wide descriptions truncate at the correct column.
  return truncateToWidth(raw, maxLength, '…');
}

/** Parse the child identifier from a SessionControl JSON acknowledgement. */
export function parseAgentIdFromToolResultOutput(output: string): string | undefined {
  try {
    const value: unknown = JSON.parse(output);
    if (value !== null && typeof value === 'object' && 'agentId' in value &&
        typeof value.agentId === 'string') return value.agentId;
  } catch {
    // An error or non-spawn operation need not return an agent identifier.
  }
  return undefined;
}

export function recentSubToolActivities(
  activities: Iterable<SubToolActivity>,
  maxRows: number = MAX_SINGLE_SUBAGENT_TOOL_ROWS,
): SubToolActivity[] {
  const sorted = [...activities].toSorted((a, b) => a.orderSeq - b.orderSeq);
  return [...projectRendererLineWindow({
    lines: sorted,
    maxLines: maxRows,
    tail: true,
  }).lines];
}
