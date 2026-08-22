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
  /** Paint `[stop]` (Esc). Hidden on parked / leftover-watcher rows. */
  readonly showStop?: boolean;
  /** Paint `[↓]` (Ctrl+B). Requires `showStop` and a detachable foreground task. */
  readonly showBg?: boolean;
}

export const TURN_STATUS_STOP_CHIP = '[stop]';
export const TURN_STATUS_BG_CHIP = '[\u2193]';

export interface TurnStatusActions {
  readonly showStop: boolean;
  readonly showBg: boolean;
}

export function resolveTurnStatusActions(input: {
  readonly phase: TurnStatusPhase;
  readonly parked?: boolean;
  readonly showStop?: boolean;
  readonly showBg?: boolean;
}): TurnStatusActions {
  const calm = input.parked === true || input.phase === 'watching';
  const showStop = !calm && input.showStop === true;
  return { showStop, showBg: showStop && input.showBg === true };
}

export function formatTurnStatusActions(input: TurnStatusActions): string {
  const chips: string[] = [];
  if (input.showBg) chips.push(TURN_STATUS_BG_CHIP);
  if (input.showStop) chips.push(TURN_STATUS_STOP_CHIP);
  return chips.length === 0 ? '' : ` ${chips.join(' ')}`;
}

export interface TurnStatusActionHit {
  readonly start: number;
  readonly end: number;
}

export function layoutTurnStatusActionHits(input: {
  readonly rowWidth: number;
  readonly showStop?: boolean;
  readonly showBg?: boolean;
}): {
  readonly stop?: TurnStatusActionHit;
  readonly bg?: TurnStatusActionHit;
} {
  const showStop = input.showStop === true;
  const showBg = input.showBg === true;
  if ((!showStop && !showBg) || input.rowWidth <= 0) return {};
  let cursor = input.rowWidth;
  let stop: TurnStatusActionHit | undefined;
  if (showStop) {
    const width = TURN_STATUS_STOP_CHIP.length;
    stop = { start: cursor - width, end: cursor };
    cursor -= width;
  }
  let bg: TurnStatusActionHit | undefined;
  if (showBg) {
    if (showStop) cursor -= 1;
    const width = TURN_STATUS_BG_CHIP.length;
    bg = { start: cursor - width, end: cursor };
  }
  return { stop, bg };
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
  readonly actions?: string;
  readonly visibleWidth: (text: string) => number;
  readonly pad: (text: string, width: number) => string;
}): string {
  const prefix = input.glyph.length > 0 ? `${input.glyph} ` : '';
  const prefixWidth = input.visibleWidth(prefix);
  const rightWidth = input.visibleWidth(input.right);
  const actions = input.actions ?? '';
  const actionsWidth = input.visibleWidth(actions);
  const gap = 2;
  const labelBudget = Math.max(8, input.width - prefixWidth - rightWidth - actionsWidth - gap);
  const label = input.pad(input.label, labelBudget);
  const fill = Math.max(
    1,
    input.width - prefixWidth - input.visibleWidth(label) - rightWidth - actionsWidth,
  );
  return `${prefix}${label}${' '.repeat(fill)}${input.right}${actions}`;
}

export function buildTurnStatusParts(input: TurnStatusInput): {
  readonly label: string;
  readonly right: string;
  readonly actions: TurnStatusActions;
} {
  const actions = resolveTurnStatusActions(input);
  if (input.parked === true || input.phase === 'watching') {
    return {
      label: formatTurnStatusLabel({
        phase: input.phase,
        tools: input.tools,
        watchers: input.watchers,
        parked: input.parked,
      }),
      right: formatTurnStatusRight({ queued: input.queued }),
      actions,
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
    actions,
  };
}
