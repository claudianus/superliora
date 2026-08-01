/**
 * Transcript render-mode isolation for virtual-scroll geometry and pure-scroll
 * paint.
 *
 * Geometry (`contentRowCount` / line-count probes) and pure-scroll frames must
 * never pay full highlight / pretty-print / unbounded tokenize on cold bodies.
 * Measure mode is set only around line-count probes. Cheap-paint mode is set
 * for pure transcript scroll frames so first-intersection history cards can
 * paint plain (or cache-hit) lines without blocking the wheel path.
 *
 * Real ambient/content paints leave both flags clear so live ticks and full
 * formatting still run.
 */

let measureDepth = 0;
let cheapPaintDepth = 0;

/** Run `fn` with live render side effects suppressed for geometry probes. */
export function withTranscriptMeasureMode<T>(fn: () => T): T {
  measureDepth += 1;
  try {
    return fn();
  } finally {
    measureDepth -= 1;
  }
}

/**
 * Run `fn` in pure-scroll cheap paint: expensive format/highlight must not run
 * on cache miss, and results must not be stored as permanent paint caches.
 */
export function withTranscriptCheapPaintMode<T>(fn: () => T): T {
  cheapPaintDepth += 1;
  try {
    return fn();
  } finally {
    cheapPaintDepth -= 1;
  }
}

/** True while a parent is measuring row counts (not painting). */
export function isTranscriptMeasureMode(): boolean {
  return measureDepth > 0;
}

/** True while pure-scroll paint is active (not ambient/content). */
export function isTranscriptCheapPaintMode(): boolean {
  return cheapPaintDepth > 0;
}

/**
 * Geometry or pure-scroll: skip multi-k highlight/pretty and never pin those
 * stubs into paint/format LRUs.
 */
export function shouldSkipExpensiveTranscriptFormat(): boolean {
  return measureDepth > 0 || cheapPaintDepth > 0;
}

/** Test helper. */
export function resetTranscriptMeasureModeForTest(): void {
  measureDepth = 0;
  cheapPaintDepth = 0;
}
