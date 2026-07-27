/**
 * Streaming text catch-up reveal — pure state machine.
 *
 * Keeps a visible prefix of the server draft and advances it over time so
 * large network chunks do not appear as a single dump. Speed scales with
 * backlog so the display never falls more than ~MAX_LAG_MS behind.
 *
 * Not a fixed typewriter: when the model is silent the caret just sits;
 * when a burst arrives, catch-up accelerates.
 */

import {
  STREAM_REVEAL_BACKLOG_GAIN,
  STREAM_REVEAL_BASE_CPS,
  STREAM_REVEAL_MAX_CPS,
  STREAM_REVEAL_MAX_LAG_MS,
  STREAM_REVEAL_MIN_CHARS_PER_TICK,
} from '#/tui/constant/streaming';
import { Easing } from '#/tui/utils/animation-scheduler';

export type StreamingTextRevealConfig = {
  readonly baseCps?: number;
  readonly maxCps?: number;
  readonly backlogGain?: number;
  readonly maxLagMs?: number;
  readonly minCharsPerTick?: number;
};

export type StreamingTextRevealState = {
  target: string;
  /**
   * UTF-16 code-unit index into `target`. Always kept on a Unicode code-point
   * boundary (never mid-surrogate-pair).
   */
  visibleEnd: number;
  lastTickMs: number;
};

export function createStreamingTextRevealState(
  nowMs: number = 0,
): StreamingTextRevealState {
  return {
    target: '',
    visibleEnd: 0,
    lastTickMs: nowMs,
  };
}

/** Count Unicode code points in `text` (surrogate pairs count as one). */
export function countCodePoints(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

/**
 * Advance a UTF-16 index by `codePoints` code points, never past `text.length`
 * and never stopping mid-surrogate-pair.
 */
export function advanceCodePointIndex(
  text: string,
  startIndex: number,
  codePoints: number,
): number {
  if (codePoints <= 0) return startIndex;
  let index = Math.max(0, Math.min(startIndex, text.length));
  let remaining = codePoints;
  while (remaining > 0 && index < text.length) {
    const cp = text.codePointAt(index);
    if (cp === undefined) break;
    index += cp > 0xffff ? 2 : 1;
    remaining--;
  }
  return index;
}

export function visibleText(state: StreamingTextRevealState): string {
  return state.target.slice(0, state.visibleEnd);
}

export function isRevealCaughtUp(state: StreamingTextRevealState): boolean {
  return state.visibleEnd >= state.target.length;
}

/**
 * Replace / extend the server draft. When the new target still starts with the
 * already-visible prefix, keep `visibleEnd`. Otherwise snap (non-prefix updates
 * should be rare for assistant drafts, which only grow).
 */
export function setRevealTarget(
  state: StreamingTextRevealState,
  target: string,
  nowMs: number,
): StreamingTextRevealState {
  const previousVisible = visibleText(state);
  if (target.startsWith(previousVisible)) {
    return {
      target,
      visibleEnd: previousVisible.length,
      lastTickMs: state.lastTickMs === 0 ? nowMs : state.lastTickMs,
    };
  }
  // Non-prefix change — snap to full so we never show a stale prefix.
  return {
    target,
    visibleEnd: target.length,
    lastTickMs: nowMs,
  };
}

/** Instantly show the full target (finalize / motion off / discard). */
export function snapRevealToTarget(
  state: StreamingTextRevealState,
  nowMs?: number,
): StreamingTextRevealState {
  return {
    target: state.target,
    visibleEnd: state.target.length,
    lastTickMs: nowMs ?? state.lastTickMs,
  };
}

export function resetRevealState(
  nowMs: number = 0,
): StreamingTextRevealState {
  return createStreamingTextRevealState(nowMs);
}

/**
 * Compute how many code points to reveal this tick given backlog and dt.
 * Pure function — easy to unit-test without a full state object.
 */
export function computeRevealAdvance(options: {
  readonly backlogCodePoints: number;
  readonly dtMs: number;
  readonly config?: StreamingTextRevealConfig;
}): number {
  const backlog = Math.max(0, options.backlogCodePoints);
  if (backlog === 0) return 0;

  const baseCps = options.config?.baseCps ?? STREAM_REVEAL_BASE_CPS;
  const maxCps = options.config?.maxCps ?? STREAM_REVEAL_MAX_CPS;
  const gain = options.config?.backlogGain ?? STREAM_REVEAL_BACKLOG_GAIN;
  const maxLagMs = options.config?.maxLagMs ?? STREAM_REVEAL_MAX_LAG_MS;
  const minChars =
    options.config?.minCharsPerTick ?? STREAM_REVEAL_MIN_CHARS_PER_TICK;

  const dtMs = Math.max(0, options.dtMs);
  if (dtMs <= 0) return 0;

  const rawSpeed = baseCps + backlog * gain;
  // Ease the blend toward max so mid-size bursts feel smooth, not linear dump.
  const t = Math.min(1, Math.max(0, (rawSpeed - baseCps) / Math.max(1, maxCps - baseCps)));
  const eased = Easing.easeOutCubic(t);
  const speed = baseCps + (maxCps - baseCps) * eased;

  let advance = Math.floor((speed * dtMs) / 1000);

  // Cap perceived lag: if time-to-drain at `speed` exceeds maxLagMs, jump enough
  // that one more tick at this rate would finish within the lag budget.
  if (speed > 0) {
    const lagMs = (backlog / speed) * 1000;
    if (lagMs > maxLagMs) {
      const allowedBacklog = Math.max(1, Math.ceil((speed * maxLagMs) / 1000));
      advance = Math.max(advance, backlog - allowedBacklog);
    }
  }

  advance = Math.max(minChars, advance);
  return Math.min(backlog, advance);
}

/**
 * Staged line reveal — time-bounded entrance for a settled block of lines.
 *
 * Grows the visible line count from 1 to `totalLines` over `durationMs` on
 * the same ease-out curve as catch-up reveal, so a finished Write/Edit
 * preview stages in instead of appearing all at once. Pure and total-bounded:
 * `durationMs <= 0` (ambient motion off) or elapsed time past the cap returns
 * every line, keeping the no-animation path byte-identical.
 */
export function computeStagedLineReveal(options: {
  readonly totalLines: number;
  readonly elapsedMs: number;
  readonly durationMs: number;
}): number {
  const total = Math.max(0, Math.floor(options.totalLines));
  if (total <= 0) return 0;
  if (options.durationMs <= 0) return total;
  const elapsed = Math.max(0, options.elapsedMs);
  if (elapsed >= options.durationMs) return total;
  const eased = Easing.easeOutCubic(elapsed / options.durationMs);
  // Always lead with the first line so the block never mounts empty.
  return Math.max(1, Math.min(total, Math.ceil(total * eased)));
}

/**
 * Advance the visible cursor by one animation tick.
 * Returns a new state; does not mutate the input.
 */
export function tickReveal(
  state: StreamingTextRevealState,
  nowMs: number,
  config?: StreamingTextRevealConfig,
): StreamingTextRevealState {
  if (state.visibleEnd >= state.target.length) {
    return { ...state, lastTickMs: nowMs };
  }

  const dtMs =
    state.lastTickMs > 0 ? Math.max(0, nowMs - state.lastTickMs) : 0;
  // First tick after setTarget with no prior clock: treat as one nominal frame
  // so the first paint is not stuck at zero until the second timer fire.
  const effectiveDt = dtMs > 0 ? dtMs : 16;

  const backlogText = state.target.slice(state.visibleEnd);
  const backlog = countCodePoints(backlogText);
  const advance = computeRevealAdvance({
    backlogCodePoints: backlog,
    dtMs: effectiveDt,
    config,
  });

  if (advance <= 0) {
    return { ...state, lastTickMs: nowMs };
  }

  const nextEnd = advanceCodePointIndex(state.target, state.visibleEnd, advance);
  return {
    target: state.target,
    visibleEnd: nextEnd,
    lastTickMs: nowMs,
  };
}
