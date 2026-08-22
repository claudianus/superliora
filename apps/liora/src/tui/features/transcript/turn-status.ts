/**
 * Grok-style turn-status row: spinner + live activity + elapsed + tokens/queue.
 * Hidden when idle unless background watchers are still running.
 * Parked TaskOutput waits reuse the calm watcher chrome.
 * Pure layout — no UI imports.
 */

import { formatElapsedTime } from '#/tui/utils/elapsed-time';

import { formatParkedWaitLabel } from './parked-wait';
import { formatVerbGroupLabel, type VerbGroupItem } from './verb-group';
import { stillRunningLabel, type Watchers } from './watchers';

export type TurnStatusPhase =
  | 'waiting'
  | 'thinking'
  | 'composing'
  | 'tool'
  | 'shell'
  | 'watching';

export interface TurnStatusInput {
  readonly phase: TurnStatusPhase;
  readonly tools: readonly VerbGroupItem[];
  readonly startedAt: number;
  readonly now: number;
  readonly contextTokens?: number;
  readonly queued?: number;
  readonly tip?: string;
  readonly watchers?: Watchers;
  /** Blocking TaskOutput wait — calm chrome, not the busy spinner. */
  readonly parked?: boolean;
}

export function formatTurnStatusLabel(input: {
  readonly phase: TurnStatusPhase;
  readonly tools: readonly VerbGroupItem[];
  readonly tip?: string;
  readonly watchers?: Watchers;
  readonly parked?: boolean;
}): string {
  if (input.parked === true) {
    return formatParkedWaitLabel(stillRunningLabel(input.watchers) ?? 'waiting');
  }
  if (input.phase === 'watching') {
    return stillRunningLabel(input.watchers) ?? 'still running';
  }
  const toolLabel = formatVerbGroupLabel(input.tools, {
    running: input.tools.some((item) => item.running === true),
  });
  if (toolLabel.length > 0) return toolLabel;
  let label: string;
  switch (input.phase) {
    case 'waiting':
      label = 'Waiting for model';
      break;
    case 'thinking':
      label = 'Thinking';
      break;
    case 'composing':
      label = 'Writing';
      break;
    case 'shell':
      label = 'Running shell';
      break;
    case 'tool':
      label = 'Running tools';
      break;
  }
  if (input.tip !== undefined && input.tip.length > 0) return `${label} · ${input.tip}`;
  return label;
}

export function formatTokenChip(tokens: number | undefined): string | undefined {
  if (tokens === undefined || tokens <= 0) return undefined;
  if (tokens < 1000) return `\u21E3${String(tokens)}`;
  const thousands = tokens / 1000;
  if (tokens < 10_000) {
    const tenths = Math.round(thousands * 10) / 10;
    return `\u21E3${tenths % 1 === 0 ? String(tenths | 0) : String(tenths)}k`;
  }
  return `\u21E3${String(Math.round(thousands))}k`;
}

export function formatTurnStatusRight(input: {
  readonly elapsed?: string;
  readonly tokens?: string;
  readonly queued?: number;
}): string {
  const parts: string[] = [];
  if (input.elapsed !== undefined && input.elapsed.length > 0) parts.push(input.elapsed);
  if (input.tokens !== undefined && input.tokens.length > 0) parts.push(input.tokens);
  if (input.queued !== undefined && input.queued > 0) {
    parts.push(input.queued === 1 ? '1 queued' : `${String(input.queued)} queued`);
  }
  return parts.join('  ');
}

/** Visible-width pad helper; glyph/label/right are already styled or plain. */
export function composeTurnStatusLine(input: {
  readonly width: number;
  readonly glyph: string;
  readonly label: string;
  readonly right: string;
  readonly visibleWidth: (text: string) => number;
  readonly pad: (text: string, width: number) => string;
}): string {
  const prefix = input.glyph.length > 0 ? `${input.glyph} ` : '';
  const prefixWidth = input.visibleWidth(prefix);
  const rightWidth = input.visibleWidth(input.right);
  const gap = 2;
  const labelBudget = Math.max(8, input.width - prefixWidth - rightWidth - gap);
  const label = input.pad(input.label, labelBudget);
  const fill = Math.max(1, input.width - prefixWidth - input.visibleWidth(label) - rightWidth);
  return `${prefix}${label}${' '.repeat(fill)}${input.right}`;
}

export function buildTurnStatusParts(input: TurnStatusInput): {
  readonly label: string;
  readonly right: string;
} {
  if (input.parked === true || input.phase === 'watching') {
    return {
      label: formatTurnStatusLabel({
        phase: input.phase,
        tools: input.tools,
        watchers: input.watchers,
        parked: input.parked,
      }),
      right: formatTurnStatusRight({ queued: input.queued }),
    };
  }
  return {
    label: formatTurnStatusLabel({
      phase: input.phase,
      tools: input.tools,
      tip: input.tip,
      watchers: input.watchers,
    }),
    right: formatTurnStatusRight({
      elapsed: formatElapsedTime(input.startedAt, input.now),
      tokens: formatTokenChip(input.contextTokens),
      queued: input.queued,
    }),
  };
}
