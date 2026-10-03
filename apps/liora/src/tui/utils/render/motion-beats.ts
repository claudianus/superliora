import {
  enterBeatDurationMs,
  exitBeatDurationMs,
} from '#/tui/features/appearance/appearance-effects';

export type MotionBeatName =
  | 'compaction_start'
  | 'compaction_done'
  | 'mode_enter'
  | 'mode_exit'
  | 'session_resume'
  | 'status_open'
  | 'thinking_enter'
  | 'tool_settle';

export interface MotionBeatPlayOptions {
  readonly name: MotionBeatName;
  readonly seed: string;
  readonly title?: string;
  readonly nowMs: number;
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
 * Real slot consumers animate footer permission changes and session resume.
 * Other surfaces own their appearance clocks.
 */
const SLOT_CONSUMER_NAMES = new Set<MotionBeatName>([
  'mode_enter',
  'mode_exit',
  'session_resume',
]);

const EXIT_NAMES = new Set<MotionBeatName>(['mode_exit']);

const STREAM_THROTTLE_MS = 300;

function durationFor(kind: 'enter' | 'exit'): number {
  return kind === 'exit' ? exitBeatDurationMs() : enterBeatDurationMs();
}

export interface MotionBeatController {
  play(options: MotionBeatPlayOptions): MotionBeatSnapshot | undefined;
  active(nowMs: number): MotionBeatSnapshot | undefined;
  clear(): void;
}

export function createMotionBeatController(): MotionBeatController {
  let current: MotionBeatSnapshot | undefined;
  let lastStreamPlayMs = -Infinity;

  return {
    play(options) {
      // Only consumed surface transitions occupy the shared slot.
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
