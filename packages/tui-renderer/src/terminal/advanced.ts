/**
 * Advanced terminal protocol utilities — OSC 99 notifications, OSC 52
 * clipboard, styled underlines (undercurl/underdotted/underdashed), and
 * kitty-specific extensions.
 *
 * These are opt-in enhancements; callers should probe terminal capabilities
 * before emitting sequences that not all emulators support.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ESC = '\u001B';
const ST = `${ESC}\\`;
const BEL = '\u0007';

// ---------------------------------------------------------------------------
// OSC 99 — Desktop Notifications (kitty extension)
// ---------------------------------------------------------------------------

export type NotificationUrgency = 'low' | 'normal' | 'critical';

export interface TerminalNotificationOptions {
  readonly title: string;
  readonly body?: string;
  readonly urgency?: NotificationNotificationUrgency;
  /** Application identifier for grouping. */
  readonly appId?: string;
  /** Notification identifier for replacement. */
  readonly identifier?: string;
  /** Whether to focus the window when the notification is clicked. */
  readonly focusOnClick?: boolean;
  /** Timeout in milliseconds. 0 = use server default. */
  readonly timeoutMs?: number;
  /** Icon name (freedesktop icon spec) or path. */
  readonly icon?: string;
  /** Whether the notification should produce a sound. */
  readonly silent?: boolean;
}

type NotificationNotificationUrgency = NotificationUrgency;

const URGENCY_CODE: Record<NotificationUrgency, string> = {
  low: 'u=low',
  normal: 'u=normal',
  critical: 'u=critical',
};

/**
 * Encode an OSC 99 desktop notification.
 *
 * Protocol: `ESC ] 99 ; <metadata> ; <title> ESC \`
 * Metadata fields are separated by `:` and use `key=value` pairs.
 * Body is sent as a second chunk with `d=1` (body follows).
 *
 * Supported by: kitty >= 0.36, WezTerm (partial).
 * Graceful degradation: unsupported terminals silently ignore the sequence.
 */
export function encodeOsc99Notification(options: TerminalNotificationOptions): string {
  const meta: string[] = [];

  if (options.appId) meta.push(`a=${options.appId}`);
  if (options.identifier) meta.push(`i=${options.identifier}`);
  if (options.urgency && options.urgency !== 'normal') {
    meta.push(URGENCY_CODE[options.urgency]);
  }
  if (options.focusOnClick === true) meta.push('f=1');
  if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
    meta.push(`t=${String(options.timeoutMs)}`);
  }
  if (options.icon) meta.push(`n=${options.icon}`);
  if (options.silent === true) meta.push('s=1');

  const metaStr = meta.join(':');
  let seq: string;

  if (options.body) {
    // Two-part: title with d=0 (more data follows), then body with d=1
    const titlePart = `${ESC}]99;${metaStr ? metaStr + ':' : ''}d=0;${escapeOscPayload(options.title)}${ST}`;
    const bodyPart = `${ESC}]99;;d=1;${escapeOscPayload(options.body)}${ST}`;
    seq = titlePart + bodyPart;
  } else {
    seq = `${ESC}]99;${metaStr};${escapeOscPayload(options.title)}${ST}`;
  }

  return seq;
}

/** Escape ST and BEL from OSC payloads to prevent premature termination. */
function escapeOscPayload(text: string): string {
  return text.replace(/\u001B/g, '').replace(/\u0007/g, '');
}

// ---------------------------------------------------------------------------
// OSC 52 — Clipboard Access
// ---------------------------------------------------------------------------

export type ClipboardSelection = 'clipboard' | 'primary' | 'secondary' | 'select';

const CLIPBOARD_SELECTION_CODE: Record<ClipboardSelection, string> = {
  clipboard: 'c',
  primary: 'p',
  secondary: 's',
  select: 'q',
};

/**
 * Encode an OSC 52 clipboard-write sequence.
 * Sets the system clipboard to `text` without requiring external tools.
 *
 * Supported by: kitty, WezTerm, iTerm2 (config), xterm, foot, alacritty.
 * Security: some terminals require explicit user opt-in.
 */
export function encodeClipboardWrite(
  text: string,
  selection: ClipboardSelection = 'clipboard',
): string {
  const sel = CLIPBOARD_SELECTION_CODE[selection];
  const encoded = Buffer.from(text, 'utf-8').toString('base64');
  return `${ESC}]52;${sel};${encoded}${ST}`;
}

/**
 * Encode an OSC 52 clipboard-read request.
 * The terminal responds asynchronously with the clipboard content.
 *
 * Response format: `ESC ] 52 ; <sel> ; <base64> ST`
 *
 * Note: Many terminals disable read access by default for security.
 */
export function encodeClipboardRead(selection: ClipboardSelection = 'clipboard'): string {
  const sel = CLIPBOARD_SELECTION_CODE[selection];
  return `${ESC}]52;${sel};?${ST}`;
}

/**
 * Parse an OSC 52 clipboard-read response.
 * Returns the decoded text, or null if the response is malformed/denied.
 */
export function parseClipboardResponse(raw: string): string | null {
  // Match: ESC ] 52 ; <sel> ; <base64> (ST | BEL)
  const match = raw.match(/\u001B\]52;[cpsq];([A-Za-z0-9+/=\n]+?)(?:\u001B\\|\u0007)/);
  if (!match?.[1]) return null;
  try {
    return Buffer.from(match[1].replace(/\n/g, ''), 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Styled Underlines (kitty extension to SGR 4)
// ---------------------------------------------------------------------------

export type UnderlineStyle =
  | 'none'
  | 'straight'
  | 'double'
  | 'curly'
  | 'dotted'
  | 'dashed';

const UNDERLINE_STYLE_CODE: Record<UnderlineStyle, string> = {
  none: '4:0',
  straight: '4:1',
  double: '4:2',
  curly: '4:3',
  dotted: '4:4',
  dashed: '4:5',
};

/**
 * Encode a styled underline SGR sequence.
 *
 * - `straight` = standard single underline (SGR 4:1)
 * - `double` = double underline (SGR 4:2)
 * - `curly` = undercurl / wavy (SGR 4:3) — great for diagnostics
 * - `dotted` = dotted underline (SGR 4:4)
 * - `dashed` = dashed underline (SGR 4:5)
 *
 * Supported by: kitty, WezTerm, foot, mintty, contour.
 * Fallback: unsupported terminals render as straight underline or ignore.
 */
export function encodeUnderlineStyle(style: UnderlineStyle): string {
  return `${ESC}[${UNDERLINE_STYLE_CODE[style]}m`;
}

/**
 * Encode an underline color (SGR 58).
 * Sets the color of the underline independently from the text foreground.
 */
export function encodeUnderlineColor(hex: string): string {
  const normalized = hex.replace(/^#/, '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '';
  return `${ESC}[58;2;${r};${g};${b}m`;
}

/** Reset underline color to default (SGR 59). */
export const ANSI_RESET_UNDERLINE_COLOR = `${ESC}[59m`;

// ---------------------------------------------------------------------------
// Kitty-specific: Title stack (push/pop terminal title)
// ---------------------------------------------------------------------------

/**
 * Push the current terminal title onto the title stack.
 * Allows temporary title changes that can be reverted.
 */
export const ANSI_PUSH_TITLE = `${ESC}[22;2t`;

/** Pop the terminal title from the stack (restore previous). */
export const ANSI_POP_TITLE = `${ESC}[23;2t`;

/**
 * Set the terminal window title.
 * Uses OSC 2 (window title only, not icon name).
 */
export function encodeSetTitle(title: string): string {
  return `${ESC}]2;${escapeOscPayload(title)}${ST}`;
}

// ---------------------------------------------------------------------------
// Kitty-specific: Progressive enhancement / unscroll
// ---------------------------------------------------------------------------

/**
 * Encode a "unscroll" region — tells the terminal that the next N lines
 * written at the top of the scrollback should be placed *above* the current
 * viewport rather than scrolling content down.
 *
 * Used for smooth streaming output that doesn't jitter the viewport.
 * CSI = N ; u
 */
export function encodeUnscroll(lines: number): string {
  if (lines <= 0) return '';
  return `${ESC}[=${lines};u`;
}

// ---------------------------------------------------------------------------
// Hyperlink helpers (extended OSC 8 with params)
// ---------------------------------------------------------------------------

export interface HyperlinkOptions {
  readonly url: string;
  /** Optional unique ID for multi-cell links (same ID = same link). */
  readonly id?: string;
}

/**
 * Encode an OSC 8 hyperlink with optional parameters.
 * The `id` parameter allows multi-cell links to be treated as one entity
 * (e.g., a wrapped URL across lines).
 *
 * Format: `ESC ] 8 ; id=<id> ; <url> ESC \`
 */
export function encodeHyperlink(options: HyperlinkOptions): string {
  const params = options.id ? `id=${options.id}` : '';
  return `${ESC}]8;${params};${options.url}${ST}`;
}

/** Close an OSC 8 hyperlink. */
export const ANSI_CLOSE_HYPERLINK = `${ESC}]8;;${ST}`;

// ---------------------------------------------------------------------------
// Capability probing
// ---------------------------------------------------------------------------

export interface TerminalAdvancedCapabilities {
  readonly osc99Notifications: boolean;
  readonly osc52Clipboard: boolean;
  readonly styledUnderlines: boolean;
  readonly hyperlinks: boolean;
  readonly unscroll: boolean;
}

/**
 * Detect advanced terminal capabilities from environment variables.
 * This is a heuristic — full detection requires DA2/DECRQM round-trips.
 */
export function detectAdvancedCapabilities(env: Record<string, string | undefined>): TerminalAdvancedCapabilities {
  const term = env['TERM'] ?? '';
  const termProgram = env['TERM_PROGRAM'] ?? '';
  const kittyWindowId = env['KITTY_WINDOW_ID'];

  const isKitty = term.includes('kitty') || kittyWindowId !== undefined;
  const isWezTerm = termProgram === 'WezTerm' || term.includes('wezterm');
  const isFoot = term.includes('foot');
  const isIterm2 = termProgram === 'iTerm.app';
  const isAlacritty = term.includes('alacritty');
  const isContour = termProgram === 'contour';

  return {
    osc99Notifications: isKitty,
    osc52Clipboard: isKitty || isWezTerm || isFoot || isIterm2 || isAlacritty,
    styledUnderlines: isKitty || isWezTerm || isFoot || isContour,
    hyperlinks: isKitty || isWezTerm || isFoot || isIterm2 || isAlacritty || isContour,
    unscroll: isKitty,
  };
}
