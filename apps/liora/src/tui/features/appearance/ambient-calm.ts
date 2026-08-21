import {
  UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS,
  type RendererTransportStability,
} from '#/tui/renderer';

/**
 * Calm-idle policy for unstable transports.
 *
 * Classic Windows ConPTY strips DEC 2026 and turns every write into its own
 * console repaint, so a 60fps decorative field strobes. Chrome (editor chase,
 * hub frame, thought-orb, band sweep, footer pulses) is a small incremental
 * cell update and must keep moving at the transport floor (~12fps). The
 * shared animation clock therefore always advances — PREMIUM.md §7.1. Large-
 * area starfields freeze on a decorative-only clock via
 * appearanceDecorativeFrozenByTransport, not by pinning appearanceAnimationNow().
 *
 * Note: `appState.thinking` is deliberately NOT a signal — it mirrors the
 * model's thinking-level preference (`thinkingLevel !== 'off'`), not live
 * agent activity. Active thinking is `streamingPhase === 'thinking'`.
 */

/**
 * Idle tick cadence cap on unstable transports. Matches the write-atomicity
 * floor so chrome still animates at ~12fps instead of waking at 60fps (or
 * freezing). Busy phases restore the requested cadence; the render loop still
 * applies the same floor to non-interactive presents.
 */
export const UNSTABLE_IDLE_TICK_CAP_MS = UNSTABLE_TRANSPORT_FRAME_INTERVAL_MS;

/**
 * Decorative-only idle clock grid on unstable transports. One hour: flooring
 * a starfield timestamp onto this grid yields a constant for a typical
 * session. Never apply this to appearanceAnimationNow() — that clock is the
 * one time base for every chrome timestamp (PREMIUM.md §7.1).
 */
export const UNSTABLE_IDLE_CLOCK_GRID_MS = 3_600_000;

export interface AmbientCalmSignals {
  readonly streamingPhase: string | undefined;
  readonly compacting: boolean;
  readonly liveGoal: boolean;
  readonly fullscreenTakeover: boolean;
  readonly streamRevealArmed: boolean;
  /**
   * Background agent work (a running Conductor job, or live/lingering Mission
   * Control workers) keeps the shared clock advancing even while the main turn
   * idles — their elapsed labels, spinners, and linger expiry all read it.
   */
  readonly backgroundWork: boolean;
}

export function isAmbientCalmIdle(signals: AmbientCalmSignals): boolean {
  return (
    (signals.streamingPhase ?? 'idle') === 'idle' &&
    !signals.compacting &&
    !signals.liveGoal &&
    !signals.fullscreenTakeover &&
    !signals.streamRevealArmed &&
    !signals.backgroundWork
  );
}

/**
 * Conductor Job Deck cards actively running a worker. Structural so the calm
 * policy stays decoupled from the job-store module.
 */
export function hasRunningConductorWorkers(
  snapshot: {
    readonly jobs: readonly {
      readonly status: string;
      readonly workerAgentId?: string | undefined;
    }[];
  } | null | undefined,
): boolean {
  return (
    snapshot?.jobs.some((card) => card.status === 'running' && card.workerAgentId !== undefined) ===
    true
  );
}

/** Floor `nowMs` to the grid so consecutive idle frames match bytes. */
export function calmAmbientClockMs(nowMs: number, gridMs: number): number {
  if (!Number.isFinite(nowMs) || gridMs <= 0) return nowMs;
  return Math.floor(nowMs / gridMs) * gridMs;
}

/**
 * Shape the per-frame animation clock for the transport. The shared clock
 * always advances — even idle classic ConPTY — so chrome that indexes
 * appearanceAnimationNow() stays alive. Decorative freeze lives on
 * appearanceDecorativeFrozenByTransport / calmAmbientClockMs, not here.
 */
export function shapeAmbientFrameClockMs(
  nowMs: number,
  _stability: RendererTransportStability | undefined,
  _signals: AmbientCalmSignals,
): number {
  return nowMs;
}

/**
 * Cap the ambient tick cadence on unstable transports while idle to the
 * write-atomicity floor. Faster ticks only rebuild frames the present path
 * will drop; slower would freeze chrome.
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
