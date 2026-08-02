/**
 * Transcript render-mode isolation for virtual-scroll geometry and pure-scroll
 * paint.
 *
 * Geometry (`contentRowCount` / line-count probes) and pure-scroll frames must
 * never pay full highlight / pretty-print / unbounded tokenize on cold bodies.
 * Measure mode is set only around line-count probes. Cheap-paint mode is set
 * for pure transcript scroll frames so the viewport uses cache/placeholder only
 * (no child materialize on the wheel path).
 *
 * Scroll-storm tracking: frames closer than {@link TRANSCRIPT_SCROLL_STORM_GAP_MS}
 * after a pure-scroll paint are "storm" — hosts must defer content invalidation
 * and the viewport must not evict or cold-paint.
 *
 * Real ambient/content paints leave both flags clear so live ticks and full
 * formatting still run.
 */

let measureDepth = 0;
let cheapPaintDepth = 0;
/** Last pure-scroll paint timestamp (ms). 0 = never. */
let lastPureScrollPaintAt = 0;

/**
 * Wheel frames closer than this are a scroll storm: no child paint, no eviction,
 * no content invalidation that forces O(transcript) work.
 */
export const TRANSCRIPT_SCROLL_STORM_GAP_MS = 40;

/**
 * Bodies larger than this skip full ANSI wrap under measure mode and return a
 * length-only estimate. Full wrap of multi-100k source during geometry of a
 * long transcript is the permanent-freeze class (minutes of blocked event loop).
 */
export const TRANSCRIPT_MEASURE_FULL_WRAP_CHAR_CAP = 8_000;

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

/**
 * Record a pure-scroll paint and return whether this frame is part of a storm
 * (previous pure-scroll was within {@link TRANSCRIPT_SCROLL_STORM_GAP_MS}).
 */
export function noteTranscriptPureScrollPaint(
  nowMs: number = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now(),
): boolean {
  const storm =
    lastPureScrollPaintAt > 0 && nowMs - lastPureScrollPaintAt < TRANSCRIPT_SCROLL_STORM_GAP_MS;
  lastPureScrollPaintAt = nowMs;
  return storm;
}

/**
 * True when a pure-scroll paint ran recently enough that mid-scroll content
 * invalidation must defer (same window as storm gap, slightly longer hold for
 * hosts that only check between frames).
 */
export function isTranscriptScrollStorm(
  nowMs: number = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now(),
  gapMs: number = TRANSCRIPT_SCROLL_STORM_GAP_MS,
): boolean {
  return lastPureScrollPaintAt > 0 && nowMs - lastPureScrollPaintAt < gapMs;
}

/** Last pure-scroll paint time (0 if none). Hosts use this for settle hold. */
export function lastTranscriptPureScrollPaintAt(): number {
  return lastPureScrollPaintAt;
}

/**
 * O(source) row estimate for geometry probes — no ANSI wrap state machine.
 * Slightly over/under full wrap for wide glyphs; scrollbar may jitter once
 * full paint warms the real count. Prefer that over multi-minute freezes.
 */
export function estimateTranscriptWrappedRowCount(
  text: string,
  contentWidth: number,
  paddingY = 0,
): number {
  const width = Number.isFinite(contentWidth) && contentWidth > 0 ? Math.floor(contentWidth) : 1;
  const padY = Number.isFinite(paddingY) && paddingY > 0 ? Math.floor(paddingY) : 0;
  if (text.length === 0 || text.trim().length === 0) return 0;
  let rows = 0;
  let lineLen = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 10 /* \n */) {
      rows += Math.max(1, Math.ceil(lineLen / width));
      lineLen = 0;
      continue;
    }
    // Skip CSI-ish escapes roughly so ANSI dumps do not inflate estimates.
    if (ch === 0x1b) {
      i += 1;
      while (i < text.length) {
        const c = text.charCodeAt(i);
        if (c >= 0x40 && c <= 0x7e) break;
        i += 1;
      }
      continue;
    }
    lineLen += 1;
  }
  rows += Math.max(1, Math.ceil(lineLen / width));
  return rows + padY * 2;
}

/**
 * Length-only stand-in for measure mode. Geometry probes only read `.length`
 * — never allocate multi-k string arrays (that alone froze the event loop).
 */
export function measurePlaceholderLines(rowCount: number): string[] {
  const n =
    Number.isFinite(rowCount) && rowCount > 0
      ? Math.min(Math.floor(rowCount), 1_000_000)
      : 0;
  if (n === 0) return [];
  return { length: n } as unknown as string[];
}

/** Test helper. */
export function resetTranscriptMeasureModeForTest(): void {
  measureDepth = 0;
  cheapPaintDepth = 0;
  lastPureScrollPaintAt = 0;
}
