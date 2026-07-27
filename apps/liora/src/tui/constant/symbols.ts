// Use U+25CF instead of U+23FA to avoid emoji/fallback rendering in terminals.
export const STATUS_BULLET = '● ';

// Shared transcript markers. Keep widths stable because message wrapping
// assumes the marker occupies the leading cells.
export const USER_MESSAGE_BULLET = '✨ ';
export const SUCCESS_MARK = '✓ ';
export const FAILURE_MARK = '✗ ';

// Shared selector markers — keep every list picker visually consistent.
// SELECT_POINTER marks the highlighted row; CURRENT_MARK is appended to the
// row that is the currently-active value. See src/tui/PREMIUM.md § Selection language.
export const SELECT_POINTER = '❯';
export const CURRENT_MARK = '← current';

// Shared pulse animation frames — the single source for renderPulseGlyph()
// callers so goal monitor, todo board, and chrome stay in lockstep.
export const PULSE_ACTIVE_FRAMES = ['●', '◆', '✦', '◆'] as const;
export const PULSE_BLOCKED_FRAMES = ['⚠', '●', '⚠', '●'] as const;
export const PULSE_PAUSED_FRAMES = ['○', '◌', '○', '◌'] as const;

// Shared status glyphs.
export const PENDING_GLYPH = '○';
export const SPINNER_GLYPH = '↻';
export const BACKGROUND_GLYPH = '◐';
export const BLOCKED_GLYPH = '⚠';
export const GOAL_DOT = '●';
export const HEADER_DIAMOND = '◆';

// Todo change badges — flow markers shown while a card change is fresh.
export const TODO_ADDED = '＋';
export const TODO_COMPLETED = '↘';
export const TODO_MOVED = '→';
export const TODO_REOPENED = '↟';
