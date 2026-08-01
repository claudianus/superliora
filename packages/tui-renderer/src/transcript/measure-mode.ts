/**
 * Geometry measure isolation for virtual-scroll line counts.
 *
 * `contentRowCount` / `resolveChildLineCounts` call `child.render(width)` only
 * to read `.length`. Tool cards and other live components historically ran
 * animation clocks inside `render()` (rebuildBody + requestRender). That made
 * every geometry probe re-enter the same expensive side effects that dirtied
 * geometry again — a sustained main-thread storm that looks like a permanent
 * TUI freeze under load (streaming tools, swarm, long transcripts).
 *
 * Measure mode is set only around line-count probes. Real paint paths still
 * run live ticks normally (scroll paint has its own suppress flag in liora).
 */

let measureDepth = 0;

/** Run `fn` with live render side effects suppressed for geometry probes. */
export function withTranscriptMeasureMode<T>(fn: () => T): T {
  measureDepth += 1;
  try {
    return fn();
  } finally {
    measureDepth -= 1;
  }
}

/** True while a parent is measuring row counts (not painting). */
export function isTranscriptMeasureMode(): boolean {
  return measureDepth > 0;
}

/** Test helper. */
export function resetTranscriptMeasureModeForTest(): void {
  measureDepth = 0;
}
