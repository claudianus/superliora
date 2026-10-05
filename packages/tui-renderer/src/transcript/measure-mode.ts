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
    const ch = text.codePointAt(i);
    if (ch === 10 /* \n */) {
      rows += Math.max(1, Math.ceil(lineLen / width));
      lineLen = 0;
      continue;
    }
    // Skip ANSI escapes so styled bodies do not inflate estimates. The skip
    // must consume the sequence introducer itself: for CSI (`ESC [`) the `[`
    // is already inside the final-byte range [0x40,0x7E], so scanning for the
    // first in-range byte stops on `[` and counts every parameter byte as
    // visible text. Per-char styled labels (gradient loaders with URLs) are
    // ~30x raw-to-visible — they measured as 100+ phantom rows and pushed the
    // real paint window off the transcript entirely.
    if (ch === 0x1b) {
      i += 1;
      const intro = i < text.length ? text.codePointAt(i) : -1;
      if (intro === 0x5b) {
        // CSI: ESC [ + params (0x30–0x3F) + intermediates (0x20–0x2F) + final.
        i += 1;
        while (i < text.length) {
          const c = text.codePointAt(i) ?? -1;
          i += 1;
          if (c >= 0x40 && c <= 0x7e) break;
        }
      } else if (intro === 0x5d) {
        // OSC: ESC ] + payload + BEL or ST (ESC \).
        i += 1;
        while (i < text.length) {
          const c = text.codePointAt(i) ?? -1;
          i += 1;
          if (c === 0x07) break;
          if (c === 0x1b && i < text.length && text.codePointAt(i) === 0x5c) {
            i += 1;
            break;
          }
        }
      } else {
        // Fe/nF escape: intermediates (0x20–0x2F)* then one final byte.
        while (i < text.length) {
          const c = text.codePointAt(i) ?? -1;
          if (c >= 0x20 && c <= 0x2f) {
            i += 1;
            continue;
          }
          if (c >= 0x30 && c <= 0x7e) i += 1;
          break;
        }
      }
      i -= 1;
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
 *
 * The object is intentionally *not* a real `string[]`. Callers that need to
 * iterate or project lines (spread, `.slice`, `.map`) must either:
 * - short-circuit under {@link isTranscriptMeasureMode} and use `.length` only, or
 * - implement {@link RendererComponent.measureContentRows} so geometry never
 *   materializes through `render()`.
 *
 * Small counts (≤ {@link MEASURE_PLACEHOLDER_MATERIALIZE_CAP}) return a real
 * empty-string array so nested viewports that window-slice stay safe when the
 * projected height is already soft-capped (e.g. truncated tool bodies).
 */
export const MEASURE_PLACEHOLDER_MATERIALIZE_CAP = 1_024;

export function measurePlaceholderLines(rowCount: number): string[] {
  const n =
    Number.isFinite(rowCount) && rowCount > 0
      ? Math.min(Math.floor(rowCount), 1_000_000)
      : 0;
  if (n === 0) return [];
  // Soft-capped bodies (truncated tool output ≤ ~601 rows) need a real array so
  // parents that `.slice`/spread for nested viewports do not throw.
  if (n <= MEASURE_PLACEHOLDER_MATERIALIZE_CAP) {
    return Array.from({ length: n }, () => '');
  }
  // Large geometry stubs: length only. Do not implement Symbol.iterator —
  // spreading a 100k stand-in would re-allocate and re-freeze the event loop.
  return { length: n } as unknown as string[];
}

/** Test helper. */
export function resetTranscriptMeasureModeForTest(): void {
  measureDepth = 0;
  cheapPaintDepth = 0;
  lastPureScrollPaintAt = 0;
}
