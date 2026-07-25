// Extracts useful string fields from partially streamed JSON tool args.
// This is intentionally a preview parser, not a full JSON parser.
export const STREAMING_ARGS_FIELD_RE =
  /"(path|file_path|command|pattern|query|url|description|title|name)"\s*:\s*"((?:\\.|[^"\\])*)"/g;

// Bounds live tool-argument previews; final tool.call payloads remain complete.
export const STREAMING_ARGS_PREVIEW_MAX_CHARS = 64 * 1024;

// Coalesces high-frequency model/tool deltas before rebuilding TUI components.
export const STREAMING_UI_FLUSH_MS = 50;

// ---------------------------------------------------------------------------
// Smooth stream reveal (client-side catch-up interpolation)
// Tuned for a snappy-but-smooth feel: lag stays under ~120ms, ~40fps ticks.
// ---------------------------------------------------------------------------

/** Minimum catch-up speed while the display lags the server draft (code points/sec). */
export const STREAM_REVEAL_BASE_CPS = 120;

/** Hard ceiling on catch-up speed so huge backlogs do not paint every frame. */
export const STREAM_REVEAL_MAX_CPS = 900;

/**
 * Extra code points/sec added per backlog code point before easing toward MAX.
 * Larger gain = snappier recovery after big chunks.
 */
export const STREAM_REVEAL_BACKLOG_GAIN = 6;

/**
 * If estimated time-to-catch-up at current speed exceeds this, jump farther
 * in a single tick so the display never lags more than ~this long.
 */
export const STREAM_REVEAL_MAX_LAG_MS = 120;

/** Reveal timer cadence (~40fps). Independent of ambient animationFps. */
export const STREAM_REVEAL_TICK_MS = 24;

/** When still lagging, always advance at least this many code points per tick. */
export const STREAM_REVEAL_MIN_CHARS_PER_TICK = 1;
