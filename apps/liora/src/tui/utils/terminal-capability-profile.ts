/**
 * TerminalCapabilityProfile — unified terminal feature detection and optimal
 * feature selection.
 *
 * Aggregates all terminal detection signals into a single capability profile
 * that other TUI modules query to automatically enable the best available
 * features without manual configuration.
 *
 * Detection layers:
 * 1. Environment heuristics (TERM, TERM_PROGRAM, COLORTERM, etc.)
 * 2. Runtime probing (DA1 primary device attributes, kitty query)
 * 3. User overrides (SUPERLIORA_FORCE_* env vars)
 *
 * Feature tiers:
 * - basic: 256 colors, no images, standard keyboard
 * - enhanced: truecolor, mouse, focus events, bracketed paste
 * - premium: kitty protocol suite (keyboard, graphics, sync output, OSC 52/99)
 *
 * The profile is computed once at startup and cached. Runtime probes can
 * upgrade capabilities asynchronously (e.g. kitty graphics confirmed via
 * response to a query sequence).
 */

import { DEFAULT_FEATURES, TERMINAL_DB } from './terminal-capability-db';
import {
  buildSummary,
  calculateTier,
  computeEffectiveDimensions,
} from './terminal-capability-queries';

export type {
  FeatureRecommendation,
} from './terminal-capability-queries';
export {
  getColorEncoder,
  getFeatureRecommendations,
  getImageStrategy,
  getMaxSafeFps,
  hasFeature,
} from './terminal-capability-queries';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FeatureTier = 'basic' | 'enhanced' | 'premium';

export type ColorDepth = 'none' | 'ansi16' | 'ansi256' | 'truecolor';

export type ImageProtocol = 'none' | 'kitty' | 'iterm2' | 'sixel';

export type KeyboardProtocol = 'legacy' | 'kitty-enhanced' | 'modify-other-keys';

export type UnicodeVersion = 6 | 9 | 12 | 15;

export interface TerminalFeatureFlags {
  /** True color (24-bit) support. */
  readonly trueColor: boolean;
  /** Kitty keyboard protocol (progressive enhancement). */
  readonly kittyKeyboard: boolean;
  /** Kitty graphics protocol (inline images). */
  readonly kittyGraphics: boolean;
  /** iTerm2 inline images (OSC 1337). */
  readonly iterm2Images: boolean;
  /** Sixel graphics support. */
  readonly sixel: boolean;
  /** Synchronized output (BSU/ESU). */
  readonly synchronizedOutput: boolean;
  /** Mouse tracking (SGR mode). */
  readonly mouseTracking: boolean;
  /** Focus in/out events. */
  readonly focusEvents: boolean;
  /** Bracketed paste mode. */
  readonly bracketedPaste: boolean;
  /** OSC 52 clipboard access. */
  readonly osc52Clipboard: boolean;
  /** OSC 99 desktop notifications. */
  readonly osc99Notify: boolean;
  /** Styled underlines (undercurl, underdotted, underdashed). */
  readonly styledUnderlines: boolean;
  /** Hyperlinks (OSC 8). */
  readonly hyperlinks: boolean;
  /** Unicode wide grapheme clusters (emoji ZWJ sequences). */
  readonly unicodeWide: boolean;
  /** Overline / strikethrough attributes. */
  readonly extendedAttributes: boolean;
  /** Cursor shape control (DECSCUSR). */
  readonly cursorShape: boolean;
  /** Kitty pointer shape protocol (OSC 22) — hover cursor affordances. */
  readonly pointerShapes: boolean;
  /** Cursor color change (OSC 12). */
  readonly cursorColor: boolean;
  /** Window title setting (OSC 0/2). */
  readonly windowTitle: boolean;
  /** Alternate screen buffer. */
  readonly alternateScreen: boolean;
}

export interface TerminalIdentity {
  readonly term: string;
  readonly termProgram: string;
  readonly termProgramVersion: string;
  readonly multiplexer: 'tmux' | 'zellij' | 'screen' | null;
  readonly ssh: boolean;
  readonly ci: boolean;
  readonly interactive: boolean;
}

export interface TerminalCapabilityProfile {
  readonly identity: TerminalIdentity;
  readonly tier: FeatureTier;
  readonly colorDepth: ColorDepth;
  readonly imageProtocol: ImageProtocol;
  readonly keyboardProtocol: KeyboardProtocol;
  readonly unicodeVersion: UnicodeVersion;
  readonly features: TerminalFeatureFlags;
  /** Effective columns (accounting for multiplexer chrome). */
  readonly effectiveColumns: number;
  /** Effective rows (accounting for multiplexer chrome). */
  readonly effectiveRows: number;
  /** Human-readable summary of detected capabilities. */
  readonly summary: string;
}

export interface CapabilityOverrides {
  readonly forceTrueColor?: boolean;
  readonly forceKittyGraphics?: boolean;
  readonly forceSixel?: boolean;
  readonly forceNoColor?: boolean;
  readonly forceNoMouse?: boolean;
  readonly forceNoImages?: boolean;
}

// ---------------------------------------------------------------------------
// Detection Logic
// ---------------------------------------------------------------------------

/**
 * Detect the terminal identity from environment variables.
 */
export function detectTerminalIdentity(env: NodeJS.ProcessEnv): TerminalIdentity {
  const term = env['TERM'] ?? '';
  const termProgram = env['TERM_PROGRAM'] ?? '';
  const termProgramVersion = env['TERM_PROGRAM_VERSION'] ?? '';

  let multiplexer: TerminalIdentity['multiplexer'] = null;
  if (env['TMUX']) multiplexer = 'tmux';
  else if (env['ZELLIJ']) multiplexer = 'zellij';
  else if (term.startsWith('screen')) multiplexer = 'screen';

  const ssh = !!(env['SSH_CONNECTION'] || env['SSH_CLIENT'] || env['SSH_TTY']);
  const ci = !!(env['CI'] || env['GITHUB_ACTIONS'] || env['GITLAB_CI']);
  const interactive = term !== 'dumb' && !ci && process.stdin.isTTY === true;

  return { term, termProgram, termProgramVersion, multiplexer, ssh, ci, interactive };
}

/**
 * Identify which known terminal we're running in.
 */
function identifyTerminal(identity: TerminalIdentity): string | null {
  const term = identity.term.toLowerCase();
  const program = identity.termProgram.toLowerCase();

  if (term.includes('kitty') || process.env['KITTY_WINDOW_ID']) return 'kitty';
  if (term.includes('ghostty') || program.includes('ghostty') || process.env['GHOSTTY_RESOURCES_DIR']) return 'ghostty';
  if (term.includes('wezterm') || program.includes('wezterm') || process.env['WEZTERM_PANE']) return 'wezterm';
  if (program.includes('iterm')) return 'iterm2';
  if (term.includes('alacritty') || process.env['ALACRITTY_WINDOW_ID']) return 'alacritty';
  if (term.includes('foot')) return 'foot';
  if (term.includes('rio') || program.includes('rio')) return 'rio';
  if (program.includes('vscode')) return 'vscode';
  return null;
}

/**
 * Detect unicode version based on environment hints.
 */
function detectUnicodeVersion(env: NodeJS.ProcessEnv): UnicodeVersion {
  const term = (env['TERM'] ?? '').toLowerCase();
  const program = (env['TERM_PROGRAM'] ?? '').toLowerCase();

  if (term.includes('kitty') || term.includes('ghostty') || term.includes('wezterm')) {
    return 15;
  }
  if (program.includes('iterm') || program.includes('vscode')) {
    return 12;
  }
  const unicodeWidth = env['SUPERLIORA_UNICODE_WIDTH'];
  if (unicodeWidth === '15') return 15;
  if (unicodeWidth === '12') return 12;
  if (unicodeWidth === '9') return 9;

  return 12;
}

/**
 * Build the complete terminal capability profile.
 */
export function buildCapabilityProfile(
  env: NodeJS.ProcessEnv = process.env,
  columns?: number,
  rows?: number,
): TerminalCapabilityProfile {
  const identity = detectTerminalIdentity(env);
  const overrides = parseOverrides(env);
  const terminalKey = identifyTerminal(identity);

  let features: TerminalFeatureFlags = { ...DEFAULT_FEATURES };
  let colorDepth: ColorDepth = 'ansi256';
  let imageProtocol: ImageProtocol = 'none';
  let keyboardProtocol: KeyboardProtocol = 'legacy';
  let tier: FeatureTier = 'basic';

  if (terminalKey && TERMINAL_DB[terminalKey]) {
    const entry = TERMINAL_DB[terminalKey]!;
    tier = entry.tier;
    colorDepth = entry.colorDepth;
    imageProtocol = entry.imageProtocol;
    keyboardProtocol = entry.keyboardProtocol;
    features = { ...DEFAULT_FEATURES, ...entry.features };
  }

  const colorterm = (env['COLORTERM'] ?? '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') {
    colorDepth = 'truecolor';
    features = { ...features, trueColor: true };
    if (tier === 'basic') tier = 'enhanced';
  } else if (identity.term.includes('256color')) {
    colorDepth = 'ansi256';
  }

  if (env['NO_COLOR'] !== undefined && !env['FORCE_COLOR']) {
    colorDepth = 'none';
    features = { ...features, trueColor: false };
    tier = 'basic';
  }
  if (env['FORCE_COLOR'] && env['FORCE_COLOR'] !== '0') {
    if (colorDepth === 'none') colorDepth = 'ansi16';
  }

  if (identity.multiplexer === 'tmux' || identity.multiplexer === 'zellij') {
    if (imageProtocol === 'kitty' && identity.multiplexer === 'zellij') {
      imageProtocol = 'none';
      features = { ...features, kittyGraphics: false };
    }
    if (keyboardProtocol === 'kitty-enhanced' && identity.multiplexer) {
      keyboardProtocol = 'modify-other-keys';
      features = { ...features, kittyKeyboard: false };
    }
    features = { ...features, pointerShapes: false };
  }

  if (identity.ssh) {
    features = { ...features, osc99Notify: false };
  }

  if (!identity.interactive) {
    features = {
      ...features,
      mouseTracking: false, focusEvents: false, bracketedPaste: false,
      synchronizedOutput: false, kittyKeyboard: false, cursorShape: false, pointerShapes: false,
    };
    keyboardProtocol = 'legacy';
  }

  features = applyOverrides(features, overrides);
  if (overrides.forceNoColor) {
    colorDepth = 'none';
    features = { ...features, trueColor: false };
  }
  if (overrides.forceTrueColor) {
    colorDepth = 'truecolor';
    features = { ...features, trueColor: true };
  }
  if (overrides.forceNoImages) {
    imageProtocol = 'none';
    features = { ...features, kittyGraphics: false, iterm2Images: false, sixel: false };
  }
  if (overrides.forceKittyGraphics) {
    imageProtocol = 'kitty';
    features = { ...features, kittyGraphics: true };
  }
  if (overrides.forceSixel) {
    imageProtocol = 'sixel';
    features = { ...features, sixel: true };
  }
  if (overrides.forceNoMouse) {
    features = { ...features, mouseTracking: false };
  }

  tier = calculateTier(features, colorDepth);

  const rawCols = columns ?? process.stdout.columns ?? 80;
  const rawRows = rows ?? process.stdout.rows ?? 24;
  const { effectiveColumns, effectiveRows } = computeEffectiveDimensions(
    rawCols, rawRows, identity.multiplexer,
  );

  const unicodeVersion = detectUnicodeVersion(env);

  const summary = buildSummary(tier, colorDepth, imageProtocol, keyboardProtocol, identity);

  return {
    identity,
    tier,
    colorDepth,
    imageProtocol,
    keyboardProtocol,
    unicodeVersion,
    features,
    effectiveColumns,
    effectiveRows,
    summary,
  };
}

function parseOverrides(env: NodeJS.ProcessEnv): CapabilityOverrides {
  return {
    forceTrueColor: env['SUPERLIORA_FORCE_TRUECOLOR'] === '1',
    forceKittyGraphics: env['SUPERLIORA_FORCE_KITTY_GRAPHICS'] === '1',
    forceSixel: env['SUPERLIORA_FORCE_SIXEL'] === '1',
    forceNoColor: env['SUPERLIORA_FORCE_NO_COLOR'] === '1',
    forceNoMouse: env['SUPERLIORA_FORCE_NO_MOUSE'] === '1',
    forceNoImages: env['SUPERLIORA_FORCE_NO_IMAGES'] === '1',
  };
}

function applyOverrides(features: TerminalFeatureFlags, overrides: CapabilityOverrides): TerminalFeatureFlags {
  let result = features;
  if (overrides.forceNoMouse) {
    result = { ...result, mouseTracking: false };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Singleton / Cache
// ---------------------------------------------------------------------------

let cachedProfile: TerminalCapabilityProfile | null = null;

/**
 * Get the cached terminal capability profile (computed once per process).
 * Call `invalidateProfile()` after terminal resize or env changes.
 */
export function getTerminalProfile(): TerminalCapabilityProfile {
  if (!cachedProfile) {
    cachedProfile = buildCapabilityProfile();
  }
  return cachedProfile;
}

/**
 * Force re-detection (e.g. after TERM change or multiplexer attach/detach).
 */
export function invalidateProfile(): void {
  cachedProfile = null;
}

/**
 * Render a compact capability badge for status bars.
 */
export function renderCapabilityBadge(
  profile: TerminalCapabilityProfile,
  fg: (token: string, text: string) => string,
): string {
  const tierGlyph = profile.tier === 'premium' ? '◆' : profile.tier === 'enhanced' ? '◇' : '○';
  const tierColor = profile.tier === 'premium' ? 'accent' : profile.tier === 'enhanced' ? 'primary' : 'textMuted';
  return fg(tierColor, tierGlyph);
}
