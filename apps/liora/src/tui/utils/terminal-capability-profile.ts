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
// Known Terminal Database
// ---------------------------------------------------------------------------

interface TerminalDbEntry {
  readonly tier: FeatureTier;
  readonly colorDepth: ColorDepth;
  readonly imageProtocol: ImageProtocol;
  readonly keyboardProtocol: KeyboardProtocol;
  readonly features: Partial<TerminalFeatureFlags>;
}

const TERMINAL_DB: Record<string, TerminalDbEntry> = {
  kitty: {
    tier: 'premium',
    colorDepth: 'truecolor',
    imageProtocol: 'kitty',
    keyboardProtocol: 'kitty-enhanced',
    features: {
      trueColor: true, kittyKeyboard: true, kittyGraphics: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true, osc99Notify: true,
      styledUnderlines: true, hyperlinks: true, unicodeWide: true,
      extendedAttributes: true, cursorShape: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  ghostty: {
    tier: 'premium',
    colorDepth: 'truecolor',
    imageProtocol: 'kitty',
    keyboardProtocol: 'kitty-enhanced',
    features: {
      trueColor: true, kittyKeyboard: true, kittyGraphics: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true,
      styledUnderlines: true, hyperlinks: true, unicodeWide: true,
      extendedAttributes: true, cursorShape: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  wezterm: {
    tier: 'premium',
    colorDepth: 'truecolor',
    imageProtocol: 'iterm2',
    keyboardProtocol: 'kitty-enhanced',
    features: {
      trueColor: true, kittyKeyboard: true, iterm2Images: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true,
      styledUnderlines: true, hyperlinks: true, unicodeWide: true,
      extendedAttributes: true, cursorShape: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  iterm2: {
    tier: 'enhanced',
    colorDepth: 'truecolor',
    imageProtocol: 'iterm2',
    keyboardProtocol: 'modify-other-keys',
    features: {
      trueColor: true, iterm2Images: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true,
      hyperlinks: true, unicodeWide: true,
      cursorShape: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  alacritty: {
    tier: 'enhanced',
    colorDepth: 'truecolor',
    imageProtocol: 'none',
    keyboardProtocol: 'modify-other-keys',
    features: {
      trueColor: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true,
      styledUnderlines: true, hyperlinks: true, unicodeWide: true,
      cursorShape: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  foot: {
    tier: 'enhanced',
    colorDepth: 'truecolor',
    imageProtocol: 'sixel',
    keyboardProtocol: 'modify-other-keys',
    features: {
      trueColor: true, sixel: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, osc52Clipboard: true,
      hyperlinks: true, unicodeWide: true,
      cursorShape: true, windowTitle: true, alternateScreen: true,
    },
  },
  rio: {
    tier: 'premium',
    colorDepth: 'truecolor',
    imageProtocol: 'kitty',
    keyboardProtocol: 'kitty-enhanced',
    features: {
      trueColor: true, kittyKeyboard: true, kittyGraphics: true,
      synchronizedOutput: true, mouseTracking: true, focusEvents: true,
      bracketedPaste: true, hyperlinks: true, unicodeWide: true,
      cursorShape: true, cursorColor: true,
      windowTitle: true, alternateScreen: true,
    },
  },
  vscode: {
    tier: 'enhanced',
    colorDepth: 'truecolor',
    imageProtocol: 'none',
    keyboardProtocol: 'legacy',
    features: {
      trueColor: true,
      mouseTracking: true, bracketedPaste: true,
      hyperlinks: true, unicodeWide: true,
      cursorShape: true, windowTitle: true, alternateScreen: true,
    },
  },
};

// ---------------------------------------------------------------------------
// Detection Logic
// ---------------------------------------------------------------------------

const DEFAULT_FEATURES: TerminalFeatureFlags = {
  trueColor: false, kittyKeyboard: false, kittyGraphics: false,
  iterm2Images: false, sixel: false, synchronizedOutput: false,
  mouseTracking: false, focusEvents: false, bracketedPaste: false,
  osc52Clipboard: false, osc99Notify: false, styledUnderlines: false,
  hyperlinks: false, unicodeWide: false, extendedAttributes: false,
  cursorShape: true, cursorColor: false, windowTitle: true,
  alternateScreen: true,
};

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
  // TERM_PROGRAM_VERSION or explicit hints
  const term = (env['TERM'] ?? '').toLowerCase();
  const program = (env['TERM_PROGRAM'] ?? '').toLowerCase();

  // Modern terminals (2023+) typically support Unicode 15
  if (term.includes('kitty') || term.includes('ghostty') || term.includes('wezterm')) {
    return 15;
  }
  if (program.includes('iterm') || program.includes('vscode')) {
    return 12;
  }
  // Check for explicit unicode width env
  const unicodeWidth = env['SUPERLIORA_UNICODE_WIDTH'];
  if (unicodeWidth === '15') return 15;
  if (unicodeWidth === '12') return 12;
  if (unicodeWidth === '9') return 9;

  // Default: most modern systems support at least Unicode 12
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

  // Start from defaults
  let features: TerminalFeatureFlags = { ...DEFAULT_FEATURES };
  let colorDepth: ColorDepth = 'ansi256';
  let imageProtocol: ImageProtocol = 'none';
  let keyboardProtocol: KeyboardProtocol = 'legacy';
  let tier: FeatureTier = 'basic';

  // Apply known terminal database entry
  if (terminalKey && TERMINAL_DB[terminalKey]) {
    const entry = TERMINAL_DB[terminalKey]!;
    tier = entry.tier;
    colorDepth = entry.colorDepth;
    imageProtocol = entry.imageProtocol;
    keyboardProtocol = entry.keyboardProtocol;
    features = { ...DEFAULT_FEATURES, ...entry.features };
  }

  // Environment-based color detection
  const colorterm = (env['COLORTERM'] ?? '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') {
    colorDepth = 'truecolor';
    features = { ...features, trueColor: true };
    if (tier === 'basic') tier = 'enhanced';
  } else if (identity.term.includes('256color')) {
    colorDepth = 'ansi256';
  }

  // NO_COLOR / FORCE_COLOR
  if (env['NO_COLOR'] !== undefined && !env['FORCE_COLOR']) {
    colorDepth = 'none';
    features = { ...features, trueColor: false };
    tier = 'basic';
  }
  if (env['FORCE_COLOR'] && env['FORCE_COLOR'] !== '0') {
    if (colorDepth === 'none') colorDepth = 'ansi16';
  }

  // Multiplexer degradation
  if (identity.multiplexer === 'tmux' || identity.multiplexer === 'zellij') {
    // Images generally don't pass through multiplexers (except tmux passthrough)
    if (imageProtocol === 'kitty' && identity.multiplexer === 'zellij') {
      imageProtocol = 'none';
      features = { ...features, kittyGraphics: false };
    }
    // Keyboard protocol may be degraded in multiplexers
    if (keyboardProtocol === 'kitty-enhanced' && identity.multiplexer) {
      keyboardProtocol = 'modify-other-keys';
      features = { ...features, kittyKeyboard: false };
    }
  }

  // SSH degradation: some features unreliable over SSH
  if (identity.ssh) {
    features = { ...features, osc99Notify: false };
  }

  // Non-interactive: disable all interactive features
  if (!identity.interactive) {
    features = {
      ...features,
      mouseTracking: false, focusEvents: false, bracketedPaste: false,
      synchronizedOutput: false, kittyKeyboard: false, cursorShape: false,
    };
    keyboardProtocol = 'legacy';
  }

  // Apply user overrides
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

  // Recalculate tier based on final features
  tier = calculateTier(features, colorDepth);

  // Effective dimensions (multiplexer chrome deduction)
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

// ---------------------------------------------------------------------------
// Feature Recommendations
// ---------------------------------------------------------------------------

export interface FeatureRecommendation {
  readonly feature: string;
  readonly enabled: boolean;
  readonly reason: string;
}

/**
 * Get recommendations for which visual features to enable based on profile.
 */
export function getFeatureRecommendations(profile: TerminalCapabilityProfile): FeatureRecommendation[] {
  const recs: FeatureRecommendation[] = [];
  const f = profile.features;

  recs.push({
    feature: 'animations',
    enabled: f.synchronizedOutput && profile.identity.interactive,
    reason: f.synchronizedOutput
      ? 'Sync output prevents tearing'
      : 'No sync output — animations may tear',
  });

  recs.push({
    feature: 'inline-images',
    enabled: profile.imageProtocol !== 'none',
    reason: profile.imageProtocol !== 'none'
      ? `${profile.imageProtocol} protocol available`
      : 'No image protocol detected',
  });

  recs.push({
    feature: 'mouse-interaction',
    enabled: f.mouseTracking,
    reason: f.mouseTracking ? 'SGR mouse tracking available' : 'Mouse not supported',
  });

  recs.push({
    feature: 'clipboard-integration',
    enabled: f.osc52Clipboard,
    reason: f.osc52Clipboard ? 'OSC 52 clipboard available' : 'No clipboard access',
  });

  recs.push({
    feature: 'desktop-notifications',
    enabled: f.osc99Notify,
    reason: f.osc99Notify ? 'OSC 99 notifications available' : 'No notification support',
  });

  recs.push({
    feature: 'styled-underlines',
    enabled: f.styledUnderlines,
    reason: f.styledUnderlines ? 'Undercurl/dotted/dashed available' : 'Basic underline only',
  });

  recs.push({
    feature: 'hyperlinks',
    enabled: f.hyperlinks,
    reason: f.hyperlinks ? 'OSC 8 hyperlinks available' : 'No hyperlink support',
  });

  recs.push({
    feature: 'high-fps-animation',
    enabled: profile.tier === 'premium' && f.synchronizedOutput,
    reason: profile.tier === 'premium'
      ? 'Premium terminal — 60fps viable'
      : 'Standard terminal — cap at 30fps',
  });

  recs.push({
    feature: 'unicode-emoji',
    enabled: f.unicodeWide && profile.unicodeVersion >= 12,
    reason: `Unicode ${String(profile.unicodeVersion)} detected`,
  });

  return recs;
}

// ---------------------------------------------------------------------------
// Capability Query Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a specific feature is available.
 */
export function hasFeature(profile: TerminalCapabilityProfile, feature: keyof TerminalFeatureFlags): boolean {
  return profile.features[feature];
}

/**
 * Get the maximum safe FPS for animations.
 */
export function getMaxSafeFps(profile: TerminalCapabilityProfile): number {
  if (!profile.identity.interactive) return 0;
  if (profile.tier === 'premium' && profile.features.synchronizedOutput) return 60;
  if (profile.tier === 'enhanced') return 30;
  return 15;
}

/**
 * Get the best available image rendering strategy.
 */
export function getImageStrategy(profile: TerminalCapabilityProfile): {
  protocol: ImageProtocol;
  maxInlineWidth: number;
  maxInlineHeight: number;
  supportsTransparency: boolean;
  supportsAnimation: boolean;
} {
  switch (profile.imageProtocol) {
    case 'kitty':
      return {
        protocol: 'kitty',
        maxInlineWidth: 4096,
        maxInlineHeight: 4096,
        supportsTransparency: true,
        supportsAnimation: true,
      };
    case 'iterm2':
      return {
        protocol: 'iterm2',
        maxInlineWidth: 2048,
        maxInlineHeight: 2048,
        supportsTransparency: true,
        supportsAnimation: false,
      };
    case 'sixel':
      return {
        protocol: 'sixel',
        maxInlineWidth: 1024,
        maxInlineHeight: 1024,
        supportsTransparency: true,
        supportsAnimation: false,
      };
    default:
      return {
        protocol: 'none',
        maxInlineWidth: 0,
        maxInlineHeight: 0,
        supportsTransparency: false,
        supportsAnimation: false,
      };
  }
}

/**
 * Get the optimal color encoding function selector.
 */
export function getColorEncoder(profile: TerminalCapabilityProfile): 'rgb' | 'palette256' | 'palette16' | 'none' {
  switch (profile.colorDepth) {
    case 'truecolor': return 'rgb';
    case 'ansi256': return 'palette256';
    case 'ansi16': return 'palette16';
    default: return 'none';
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

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

function calculateTier(features: TerminalFeatureFlags, colorDepth: ColorDepth): FeatureTier {
  if (
    colorDepth === 'truecolor' &&
    features.kittyKeyboard &&
    (features.kittyGraphics || features.iterm2Images) &&
    features.synchronizedOutput
  ) {
    return 'premium';
  }
  if (colorDepth === 'truecolor' && features.mouseTracking && features.bracketedPaste) {
    return 'enhanced';
  }
  if (colorDepth === 'ansi256' && features.mouseTracking) {
    return 'enhanced';
  }
  return 'basic';
}

function computeEffectiveDimensions(
  columns: number,
  rows: number,
  multiplexer: TerminalIdentity['multiplexer'],
): { effectiveColumns: number; effectiveRows: number } {
  let effectiveColumns = columns;
  let effectiveRows = rows;

  switch (multiplexer) {
    case 'tmux':
      // tmux status bar takes 1 row (or 2 with status-position top+bottom)
      effectiveRows -= 1;
      break;
    case 'zellij':
      // zellij has top tab bar (1) + bottom status bar (1) + possible padding
      effectiveRows -= 2;
      effectiveColumns -= 2; // side borders in some layouts
      break;
    case 'screen':
      // GNU screen hardstatus line
      effectiveRows -= 1;
      break;
  }

  return {
    effectiveColumns: Math.max(20, effectiveColumns),
    effectiveRows: Math.max(5, effectiveRows),
  };
}

function buildSummary(
  tier: FeatureTier,
  colorDepth: ColorDepth,
  imageProtocol: ImageProtocol,
  keyboardProtocol: KeyboardProtocol,
  identity: TerminalIdentity,
): string {
  const parts: string[] = [];
  parts.push(tier);
  parts.push(colorDepth);
  if (imageProtocol !== 'none') parts.push(`img:${imageProtocol}`);
  if (keyboardProtocol !== 'legacy') parts.push(`kb:${keyboardProtocol}`);
  if (identity.multiplexer) parts.push(`mux:${identity.multiplexer}`);
  if (identity.ssh) parts.push('ssh');
  return parts.join(' | ');
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
