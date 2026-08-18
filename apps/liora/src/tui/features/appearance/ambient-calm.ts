import type { RendererTransportStability } from '#/tui/renderer';

/**
 * Calm-idle policy for unstable transports.
 *
 * On classic Windows ConPTY the 2026 synchronized-output markers are stripped
 * and every write becomes its own console repaint with a cursor strobe, so a
 * smooth ambient clock guarantees visible flicker while nothing is happening.
 * The stable posture is to make idle frames byte-identical: freeze the shared
 * animation clock so gradient/pulse/twinkle output repeats exactly, the cell
 * diff stays empty, and nothing reaches the terminal. Activity (streaming/
 * thinking/composing phase, compacting, live goal, splash/takeover, armed
 * stream reveal) restores the full-rate clock.
 *
 * Note: `appState.thinking` is deliberately NOT a signal — it mirrors the
 * model's thinking-level preference (`thinkingLevel !== 'off'`), not live
 * agent activity, so it would block calm forever. Active thinking is already
 * covered by `streamingPhase === 'thinking'`.
 */

/**
 * Idle tick cadence cap on unstable transports. The ticker must keep waking
 * (it re-resolves its interval per tick, and busy phases need it back at full
 * rate within one wake), so this stays small even though the clock freezes.
 */
export const UNSTABLE_IDLE_TICK_CAP_MS = 250;

/**
 * Idle clock grid on unstable transports. One hour: flooring the frame
 * timestamp onto this grid yields a constant for the whole session, so idle
 * ambient output is frozen (not merely slowed) and ConPTY repaints stop.
 */
export const UNSTABLE_IDLE_CLOCK_GRID_MS = 3_600_000;

export interface AmbientCalmSignals {
  readonly streamingPhase: string | undefined;
  readonly compacting: boolean;
  readonly liveGoal: boolean;
  readonly fullscreenTakeover: boolean;
  readonly streamRevealArmed: boolean;
}

export function isAmbientCalmIdle(signals: AmbientCalmSignals): boolean {
  return (
    (signals.streamingPhase ?? 'idle') === 'idle' &&
    !signals.compacting &&
    !signals.liveGoal &&
    !signals.fullscreenTakeover &&
    !signals.streamRevealArmed
  );
}

/** Floor `nowMs` to the grid so consecutive idle frames match bytes. */
export function calmAmbientClockMs(nowMs: number, gridMs: number): number {
  if (!Number.isFinite(nowMs) || gridMs <= 0) return nowMs;
  return Math.floor(nowMs / gridMs) * gridMs;
}

/**
 * Shape the per-frame animation clock for the transport. Synchronized
 * transports (or any activity) keep the raw timestamp; unstable + idle snaps
 * onto the freeze grid so decorative motion halts instead of repainting.
 */
export function shapeAmbientFrameClockMs(
  nowMs: number,
  stability: RendererTransportStability | undefined,
  signals: AmbientCalmSignals,
): number {
  if (stability !== 'unstable') return nowMs;
  if (!isAmbientCalmIdle(signals)) return nowMs;
  return calmAmbientClockMs(nowMs, resolveUnstableIdleClockGridMs());
}

/**
 * Cap the ambient tick cadence on unstable transports while idle: ticking
 * faster than the cap only rebuilds byte-identical frames (CPU, no output).
 */
export function capAmbientIntervalForCalmTransport(
  intervalMs: number,
  stability: RendererTransportStability | undefined,
  idle: boolean,
): number {
  if (stability !== 'unstable' || !idle) return intervalMs;
  if (!Number.isFinite(intervalMs)) return intervalMs;
  return Math.max(intervalMs, UNSTABLE_IDLE_TICK_CAP_MS);
}

/**
 * Test/debug override for the freeze grid (`SUPERLIORA_TUI_UNSTABLE_IDLE_QUANTUM_MS`),
 * e.g. 250 to watch the sky twinkle in slow motion instead of freezing.
 */
export function resolveUnstableIdleClockGridMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env['SUPERLIORA_TUI_UNSTABLE_IDLE_QUANTUM_MS'];
  if (raw === undefined || raw.trim() === '') return UNSTABLE_IDLE_CLOCK_GRID_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return UNSTABLE_IDLE_CLOCK_GRID_MS;
  return parsed;
}
