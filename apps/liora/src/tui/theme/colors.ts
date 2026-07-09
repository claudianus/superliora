/**
 * Color palette definitions for dark and light themes.
 *
 * `darkColors` / `lightColors` are the semantic `ColorPalette` consumed by
 * every UI component via the global Theme singleton. Each token holds its hex
 * value directly — see the per-token docs on `ColorPalette` for what each one
 * controls.
 *
 * Light palette values are tuned for ≥ 4.5:1 contrast against #FFFFFF
 * for text tokens and ≥ 3:1 for chrome (border / large text), matching
 * WCAG AA.
 */

// Each token below documents where it is actually consumed, so theme authors
// know what changing it affects. "Widely" means the token is read across most
// dialogs/messages rather than in one specific place.
export interface ColorPalette {
  // ── Brand ──
  /** Dominant interactive/brand colour: links & inline code, the selected item
   *  in nearly every dialog, the focused editor border, plan/"running" badges,
   *  spinners. The most widely used token. */
  primary: string;
  /** Secondary highlight: approval "▶" prefix, device-code box, image
   *  placeholder, BTW / queue panes, custom-registry import. */
  accent: string;

  // ── Text ──
  /** Default body text: dialog bodies, todo titles, footer model label,
   *  markdown headings, tool/read output, and assistant-side message bullets
   *  (assistant / tool / agent / read) plus markdown list bullets. */
  text: string;
  /** Emphasised / bold text: input dialogs, status messages. */
  textStrong: string;
  /** Secondary, dimmed text (the most widely used dim shade): thinking blocks,
   *  hints, descriptions, completed todos, markdown quotes, and the footer
   *  status bar (cwd path, git badge). */
  textDim: string;
  /** Faintest text: counters, scroll info, descriptions, markdown link URLs,
   *  code-block borders. */
  textMuted: string;

  // ── Surface ──
  /** Root canvas background. Used for the TUI-owned terminal cells and, when
   *  explicitly enabled, the session terminal background. */
  background: string;
  /** Default panel/dialog surface, slightly lifted from the canvas. */
  surface: string;
  /** Raised surface for focused or premium chrome. */
  surfaceRaised: string;
  /** Sunken surface for inactive panes and recessed areas. */
  surfaceSunken: string;
  /** Borders: pane & editor borders, markdown horizontal rule. */
  border: string;
  /** Focus / attention border — currently only the approval panel. */
  borderFocus: string;
  /** Selection background for pickers, tabs, and imported terminal palettes. */
  selectionBg: string;
  /** Selection foreground text. */
  selectionText: string;
  /** Cursor colour for opt-in terminal palette mutation. */
  cursor: string;

  // ── State ──
  /** Success: ✓ marks, "enabled", completed states. */
  success: string;
  /** Warning: auto/yolo badges, stale markers, plan-mode hint. */
  warning: string;
  /** Error: error messages, failed tool output. */
  error: string;

  // ── Diff (all consumed by components/media/diff-preview.ts) ──
  /** Added lines. */
  diffAdded: string;
  /** Removed lines. */
  diffRemoved: string;
  /** Added lines — intra-line changed words (bold). */
  diffAddedStrong: string;
  /** Removed lines — intra-line changed words (bold). */
  diffRemovedStrong: string;
  /** Line-number gutter (also approval panel/preview). */
  diffGutter: string;
  /** Meta / hunk headers. */
  diffMeta: string;

  // ── Roles ──
  /** User message: bullet & text, skill-activation name. The one role colour
   *  with its own hue — assistant/thinking/status bullets reuse text/textDim. */
  roleUser: string;

  // ── Shell mode ──
  /** Shell mode (`!`): the `!` prompt symbol, bash-mode editor border, and the
   *  echoed `$ command` line. Its own hue (violet), distinct from
   *  plan-mode (primary) and the user role (roleUser). */
  shellMode: string;

  // ── Premium effects ──
  /** Glow / halo accent for focus effects. */
  glow: string;
  /** Particle accent for event bursts and ambient effects. */
  particle: string;
  /** Start of premium gradient treatments. */
  gradientStart: string;
  /** End of premium gradient treatments. */
  gradientEnd: string;

  // ── Syntax highlighting ──
  /** Syntax default / identifiers. */
  syntaxText: string;
  /** Keywords, language constants, and built-ins. */
  syntaxKeyword: string;
  /** Function and method names. */
  syntaxFunction: string;
  /** Class/type names and attributes. */
  syntaxType: string;
  /** String literals. */
  syntaxString: string;
  /** Numeric and boolean literals. */
  syntaxNumber: string;
  /** Comments and doc tags. */
  syntaxComment: string;
  /** Operators, punctuation, and symbols. */
  syntaxOperator: string;
  /** Tags, selectors, and markup names. */
  syntaxTag: string;
  /** Metadata, decorators, and preprocessor lines. */
  syntaxMeta: string;
}

export const darkColors: ColorPalette = {
  primary: '#4FA8FF',
  accent: '#5BC0BE',

  text: '#E0E0E0',
  textStrong: '#F5F5F5',
  textDim: '#888888',
  textMuted: '#6B6B6B',

  background: '#0B0F14',
  surface: '#111827',
  surfaceRaised: '#182233',
  surfaceSunken: '#080C10',
  border: '#5A5A5A',
  borderFocus: '#E8A838',
  selectionBg: '#1D4E89',
  selectionText: '#F5F5F5',
  cursor: '#E0E0E0',

  success: '#4EC87E',
  warning: '#E8A838',
  error: '#E85454',

  diffAdded: '#4EC87E',
  diffRemoved: '#E85454',
  diffAddedStrong: '#7AD99B',
  diffRemovedStrong: '#F08585',
  diffGutter: '#6B6B6B',
  diffMeta: '#888888',

  roleUser: '#FFCB6B',
  shellMode: '#BD93F9',
  glow: '#7DD3FC',
  particle: '#B784FF',
  gradientStart: '#00D5FF',
  gradientEnd: '#B784FF',

  syntaxText: '#E0E0E0',
  syntaxKeyword: '#C792EA',
  syntaxFunction: '#82AAFF',
  syntaxType: '#FFCB6B',
  syntaxString: '#C3E88D',
  syntaxNumber: '#F78C6C',
  syntaxComment: '#697098',
  syntaxOperator: '#89DDFF',
  syntaxTag: '#F07178',
  syntaxMeta: '#7FDBCA',
};

export const lightColors: ColorPalette = {
  primary: '#1565C0',
  accent: '#00838F',

  text: '#1A1A1A',
  textStrong: '#1A1A1A',
  textDim: '#454545',
  textMuted: '#5F5F5F',

  background: '#FFFFFF',
  surface: '#F4F7FB',
  surfaceRaised: '#E8F0FA',
  surfaceSunken: '#EEF2F7',
  border: '#737373',
  borderFocus: '#92660A',
  selectionBg: '#D8E8FF',
  selectionText: '#0B1020',
  cursor: '#1A1A1A',

  success: '#0E7A38',
  warning: '#92660A',
  error: '#B91C1C',

  diffAdded: '#0E7A38',
  diffRemoved: '#B91C1C',
  diffAddedStrong: '#0E7A38',
  diffRemovedStrong: '#B91C1C',
  diffGutter: '#737373',
  diffMeta: '#5F5F5F',

  roleUser: '#9A4A00',
  shellMode: '#7C3AED',
  glow: '#075985',
  particle: '#7C3AED',
  gradientStart: '#075985',
  gradientEnd: '#0F766E',

  syntaxText: '#1A1A1A',
  syntaxKeyword: '#6D28D9',
  syntaxFunction: '#075985',
  syntaxType: '#9A4A00',
  syntaxString: '#0E7A38',
  syntaxNumber: '#B45309',
  syntaxComment: '#6B7280',
  syntaxOperator: '#0F766E',
  syntaxTag: '#B91C1C',
  syntaxMeta: '#5F5F5F',
};

export type ResolvedTheme = 'dark' | 'light';

/** Synchronous palette lookup for built-in themes only. */
export function getBuiltInPalette(resolved: ResolvedTheme): ColorPalette {
  return resolved === 'dark' ? darkColors : lightColors;
}
