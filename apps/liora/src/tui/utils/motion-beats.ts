import {
  enterBeatDurationMs,
  exitBeatDurationMs,
} from '#/tui/utils/appearance-effects';

export type MotionBeatName =
  | 'compaction_start'
  | 'compaction_done'
  | 'mode_enter'
  | 'mode_exit'
  | 'session_resume'
  | 'status_open'
  | 'thinking_enter'
  | 'goal_complete'
  | 'tool_settle'
  | 'plan_enter'
  | 'plan_exit';

export interface MotionBeatPlayOptions {
  readonly name: MotionBeatName;
  readonly seed: string;
  readonly title?: string;
  readonly nowMs: number;
  readonly theatreActive?: boolean;
  readonly streamThrottle?: boolean;
}

export interface MotionBeatSnapshot {
  readonly name: MotionBeatName;
  readonly seed: string;
  readonly title: string;
  readonly startedAtMs: number;
  readonly kind: 'enter' | 'exit';
}

/**
 * Only these names have a real `motionBeats.active()` consumer (footer mode /
 * plan shimmer + session_resume enter beat). Other play() names are ghosts —
 * local surfaces animate on their own clocks and must not steal this slot.
 */
const SLOT_CONSUMER_NAMES = new Set<MotionBeatName>([
  'mode_enter',
  'mode_exit',
  'plan_enter',
  'plan_exit',
  'session_resume',
]);

const EXIT_NAMES = new Set<MotionBeatName>(['mode_exit', 'plan_exit']);

const STREAM_THROTTLE_MS = 300;

function durationFor(kind: 'enter' | 'exit'): number {
  return kind === 'exit' ? exitBeatDurationMs() : enterBeatDurationMs();
}

export interface MotionBeatController {
  play(options: MotionBeatPlayOptions): MotionBeatSnapshot | undefined;
  active(nowMs: number): MotionBeatSnapshot | undefined;
  clear(): void;
}

/** Matches footer theatre chrome: ultrawork or swarm-armed (`swarmMode`). */
export function isMotionTheatreActive(state: {
  readonly ultraworkMode?: boolean;
  readonly swarmMode?: boolean;
}): boolean {
  return state.ultraworkMode === true || state.swarmMode === true;
}

export function createMotionBeatController(): MotionBeatController {
  let current: MotionBeatSnapshot | undefined;
  let lastStreamPlayMs = -Infinity;

  return {
    play(options) {
      if (options.theatreActive) return undefined;
      // Ghost beats: keep call sites for telemetry/intent, but never replace the
      // single transition slot consumed by footer mode/plan/resume.
      if (!SLOT_CONSUMER_NAMES.has(options.name)) return undefined;
      if (options.streamThrottle) {
        if (options.nowMs - lastStreamPlayMs < STREAM_THROTTLE_MS) return undefined;
        lastStreamPlayMs = options.nowMs;
      }
      const kind: 'enter' | 'exit' = EXIT_NAMES.has(options.name) ? 'exit' : 'enter';
      current = {
        name: options.name,
        seed: options.seed,
        title: options.title ?? options.name,
        startedAtMs: options.nowMs,
        kind,
      };
      return current;
    },
    active(nowMs) {
      if (!current) return undefined;
      if (nowMs - current.startedAtMs >= durationFor(current.kind)) {
        current = undefined;
        return undefined;
      }
      return current;
    },
    clear() {
      current = undefined;
    },
  };
}
