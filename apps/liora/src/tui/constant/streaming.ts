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
// Tuned for visible motion: lag stays under ~200ms, ~45fps ticks.
// Too-fast catch-up made the previous pass feel like "just delayed dumps".
// ---------------------------------------------------------------------------

/** Minimum catch-up speed while the display lags the server draft (code points/sec). */
export const STREAM_REVEAL_BASE_CPS = 55;

/** Hard ceiling on catch-up speed so huge backlogs do not paint every frame. */
export const STREAM_REVEAL_MAX_CPS = 420;

/**
 * Extra code points/sec added per backlog code point before easing toward MAX.
 * Moderate gain keeps bursts readable instead of snapping closed.
 */
export const STREAM_REVEAL_BACKLOG_GAIN = 2.5;

/**
 * If estimated time-to-catch-up at current speed exceeds this, jump farther
 * in a single tick so the display never lags more than ~this long.
 */
export const STREAM_REVEAL_MAX_LAG_MS = 200;

/** Reveal timer cadence (~45fps). Independent of ambient animationFps. */
export const STREAM_REVEAL_TICK_MS = 22;

/** When still lagging, always advance at least this many code points per tick. */
export const STREAM_REVEAL_MIN_CHARS_PER_TICK = 1;
