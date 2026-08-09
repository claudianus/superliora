// Extracts useful string fields from partially streamed JSON tool args.
// This is intentionally a preview parser, not a full JSON parser.
export const STREAMING_ARGS_FIELD_RE =
  /"(path|file_path|command|pattern|query|url|description|title|name)"\s*:\s*"((?:\\.|[^"\\])*)"/g;

// Bounds live tool-argument previews; final tool.call payloads remain complete.
export const STREAMING_ARGS_PREVIEW_MAX_CHARS = 64 * 1024;

// Coalesces high-frequency model/tool deltas before rebuilding TUI components.
// Doubles as the floor/default interval for the adaptive flush throttle.
// ~60fps floor keeps type-on aligned with the ambient render loop.
export const STREAMING_UI_FLUSH_MS = 16;

// Upper bound of the adaptive flush interval. Sustained delta bursts stretch
// the window up to this far to coalesce repaints; light traffic stays at the
// floor and semantic boundaries flush immediately regardless.
export const STREAMING_UI_FLUSH_MAX_MS = 24;

// Pending dirty marks within one flush cycle at or above which the throttle
// stretches from STREAMING_UI_FLUSH_MS toward STREAMING_UI_FLUSH_MAX_MS.
export const STREAMING_UI_FLUSH_BURST_DELTAS = 8;

// ---------------------------------------------------------------------------
// Smooth stream reveal (client-side catch-up interpolation)
// Premium profile: soft kinetic type-on with ease-in/out speed, ~60fps ticks,
// and a tighter lag budget so bursts read as streaming ink — not delayed dumps.
// ---------------------------------------------------------------------------

/** Minimum catch-up speed while the display lags the server draft (code points/sec). */
export const STREAM_REVEAL_BASE_CPS = 72;

/** Hard ceiling on catch-up speed so huge backlogs do not paint every frame. */
export const STREAM_REVEAL_MAX_CPS = 480;

/**
 * Extra code points/sec added per backlog code point before easing toward MAX.
 * Higher gain keeps mid bursts catching up without a hard dump.
 */
export const STREAM_REVEAL_BACKLOG_GAIN = 2.2;

/**
 * If estimated time-to-catch-up at current speed exceeds this, jump farther
 * in a single tick so the display never lags more than ~this long.
 */
export const STREAM_REVEAL_MAX_LAG_MS = 240;

/** Reveal timer cadence (~60fps). Independent of ambient animationFps. */
export const STREAM_REVEAL_TICK_MS = 16;

/** When still lagging, always advance at least this many code points per tick. */
export const STREAM_REVEAL_MIN_CHARS_PER_TICK = 2;

/** Live caret glyph painted at the growing edge while catch-up is active. */
export const STREAM_REVEAL_CARET = '▌';

/** How long the caret blinks on after each advance (ms). Soft pulse, not a hard blink. */
export const STREAM_REVEAL_CARET_ON_MS = 120;

// ---------------------------------------------------------------------------
// Staged line reveal (settled Write/Edit preview entrance)
// A finished tool preview grows line-by-line instead of dumping at once.
// The whole entrance is time-bounded so long previews never wait on line
// count; subtle stretches the same ease so it reads calmer, not shorter.
// ---------------------------------------------------------------------------

/** Total time budget for a settled tool preview to grow all of its lines. */
export const STAGED_LINE_REVEAL_MS_PREMIUM = 380;

/** Subtle profile duration — the premium curve stretched for a calmer cascade. */
export const STAGED_LINE_REVEAL_MS_SUBTLE = 480;
