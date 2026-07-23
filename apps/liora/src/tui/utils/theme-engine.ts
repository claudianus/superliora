/**
 * ThemeEngine — dynamic theme switching with color palette management.
 *
 * Provides a comprehensive theming system:
 * - Multiple built-in themes (dark, light, nord, tokyo-night, catppuccin, dracula)
 * - Runtime theme switching without restart
 * - Color palette with semantic tokens (primary, accent, success, warning, error)
 * - True color (24-bit) and 256-color fallback support
 * - Contrast-aware text color selection
 * - Theme preview rendering
 * - Custom theme creation from base + overrides
 * - Persistence of theme preference
 *
 * Color tokens:
 * - primary: Main interactive elements
 * - accent: Highlights, selections, focus
 * - success: Positive feedback
 * - warning: Caution states
 * - error: Negative/destructive states
 * - text: Default foreground
 * - textMuted: Secondary text
 * - textDim: Tertiary/disabled text
 * - bg: Default background
 * - bgElevated: Raised surfaces
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColorRGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface ThemePalette {
  readonly primary: ColorRGB;
  readonly accent: ColorRGB;
  readonly success: ColorRGB;
  readonly warning: ColorRGB;
  readonly error: ColorRGB;
  readonly text: ColorRGB;
  readonly textMuted: ColorRGB;
  readonly textDim: ColorRGB;
  readonly bg: ColorRGB;
  readonly bgElevated: ColorRGB;
}

export interface Theme {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly dark: boolean;
  readonly palette: ThemePalette;
}

export interface ThemeRenderOptions {
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Built-in Themes
// ---------------------------------------------------------------------------

const THEME_DARK: Theme = {
  id: 'dark',
  name: 'Dark',
  description: 'Default dark theme with balanced contrast',
  dark: true,
  palette: {
    primary: { r: 97, g: 175, b: 239 },   // #61afef
    accent: { r: 198, g: 120, b: 221 },   // #c678dd
    success: { r: 152, g: 195, b: 121 },  // #98c379
    warning: { r: 229, g: 192, b: 123 },  // #e5c07b
    error: { r: 224, g: 108, b: 117 },    // #e06c75
    text: { r: 220, g: 223, b: 228 },     // #dcdf e4
    textMuted: { r: 140, g: 145, b: 155 },
    textDim: { r: 92, g: 99, b: 112 },
    bg: { r: 30, g: 33, b: 40 },          // #1e2128
    bgElevated: { r: 40, g: 44, b: 52 },
  },
};

const THEME_LIGHT: Theme = {
  id: 'light',
  name: 'Light',
  description: 'Clean light theme for bright environments',
  dark: false,
  palette: {
    primary: { r: 64, g: 120, b: 192 },
    accent: { r: 166, g: 80, b: 190 },
    success: { r: 80, g: 160, b: 60 },
    warning: { r: 190, g: 140, b: 30 },
    error: { r: 200, g: 60, b: 60 },
    text: { r: 40, g: 44, b: 52 },
    textMuted: { r: 100, g: 105, b: 115 },
    textDim: { r: 150, g: 155, b: 165 },
    bg: { r: 250, g: 250, b: 252 },
    bgElevated: { r: 240, g: 240, b: 245 },
  },
};

const THEME_NORD: Theme = {
  id: 'nord',
  name: 'Nord',
  description: 'Arctic, north-bluish clean theme',
  dark: true,
  palette: {
    primary: { r: 136, g: 192, b: 208 },  // #88c0d0
    accent: { r: 180, g: 142, b: 173 },   // #b48ead
    success: { r: 163, g: 190, b: 140 },  // #a3be8c
    warning: { r: 235, g: 203, b: 139 },  // #ebcb8b
    error: { r: 191, g: 97, b: 106 },     // #bf616a
    text: { r: 236, g: 239, b: 244 },     // #eceff4
    textMuted: { r: 160, g: 172, b: 190 },
    textDim: { r: 108, g: 122, b: 144 },
    bg: { r: 46, g: 52, b: 64 },          // #2e3440
    bgElevated: { r: 59, g: 66, b: 82 },
  },
};

const THEME_TOKYO_NIGHT: Theme = {
  id: 'tokyo-night',
  name: 'Tokyo Night',
  description: 'Clean dark theme inspired by Tokyo lights',
  dark: true,
  palette: {
    primary: { r: 122, g: 162, b: 247 },  // #7aa2f7
    accent: { r: 187, g: 154, b: 247 },   // #bb9af7
    success: { r: 158, g: 206, b: 106 },  // #9ece6a
    warning: { r: 224, g: 175, b: 104 },  // #e0af68
    error: { r: 247, g: 118, b: 142 },    // #f7768e
    text: { r: 192, g: 202, b: 245 },     // #c0caf5
    textMuted: { r: 122, g: 132, b: 168 },
    textDim: { r: 86, g: 95, b: 137 },
    bg: { r: 26, g: 27, b: 38 },          // #1a1b26
    bgElevated: { r: 36, g: 40, b: 59 },
  },
};

const THEME_CATPPUCCIN: Theme = {
  id: 'catppuccin',
  name: 'Catppuccin Mocha',
  description: 'Soothing pastel theme for the high-spirited',
  dark: true,
  palette: {
    primary: { r: 137, g: 180, b: 250 },  // #89b4fa
    accent: { r: 203, g: 166, b: 247 },   // #cba6f7
    success: { r: 166, g: 227, b: 161 },  // #a6e3a1
    warning: { r: 249, g: 226, b: 175 },  // #f9e2af
    error: { r: 243, g: 139, b: 168 },    // #f38ba8
    text: { r: 205, g: 214, b: 244 },     // #cdd6f4
    textMuted: { r: 147, g: 153, b: 178 },
    textDim: { r: 108, g: 112, b: 134 },
    bg: { r: 30, g: 30, b: 46 },          // #1e1e2e
    bgElevated: { r: 49, g: 50, b: 68 },
  },
};

const THEME_DRACULA: Theme = {
  id: 'dracula',
  name: 'Dracula',
  description: 'Dark theme with vibrant colors',
  dark: true,
  palette: {
    primary: { r: 189, g: 147, b: 249 },  // #bd93f9
    accent: { r: 255, g: 121, b: 198 },   // #ff79c6
    success: { r: 80, g: 250, b: 123 },   // #50fa7b
    warning: { r: 241, g: 250, b: 140 },  // #f1fa8c
    error: { r: 255, g: 85, b: 85 },      // #ff5555
    text: { r: 248, g: 248, b: 242 },     // #f8f8f2
    textMuted: { r: 160, g: 162, b: 172 },
    textDim: { r: 98, g: 102, b: 118 },
    bg: { r: 40, g: 42, b: 54 },          // #282a36
    bgElevated: { r: 68, g: 71, b: 90 },
  },
};

export const BUILTIN_THEMES: readonly Theme[] = [
  THEME_DARK, THEME_LIGHT, THEME_NORD, THEME_TOKYO_NIGHT, THEME_CATPPUCCIN, THEME_DRACULA,
];

// ---------------------------------------------------------------------------
// ThemeEngine
// ---------------------------------------------------------------------------

export class ThemeEngine {
  private themes: Map<string, Theme> = new Map();
  private currentThemeId: string;
  private onChange: ((theme: Theme) => void) | null = null;

  constructor(initialThemeId: string = 'dark') {
    // Register built-in themes
    for (const theme of BUILTIN_THEMES) {
      this.themes.set(theme.id, theme);
    }
    this.currentThemeId = this.themes.has(initialThemeId) ? initialThemeId : 'dark';
  }

  // ─── Theme Management ─────────────────────────────────────────────

  /** Register a custom theme. */
  registerTheme(theme: Theme): void {
    this.themes.set(theme.id, theme);
  }

  /** Remove a custom theme (cannot remove built-ins). */
  removeTheme(id: string): boolean {
    if (BUILTIN_THEMES.some((t) => t.id === id)) return false;
    if (id === this.currentThemeId) return false;
    return this.themes.delete(id);
  }

  /** Get all available themes. */
  getThemes(): Theme[] {
    return [...this.themes.values()];
  }

  /** Get a theme by ID. */
  getTheme(id: string): Theme | null {
    return this.themes.get(id) ?? null;
  }

  // ─── Active Theme ─────────────────────────────────────────────────

  /** Switch to a theme by ID. */
  setTheme(id: string): boolean {
    if (!this.themes.has(id)) return false;
    this.currentThemeId = id;
    if (this.onChange) {
      this.onChange(this.themes.get(id)!);
    }
    return true;
  }

  /** Cycle to the next theme. */
  cycleTheme(): Theme {
    const ids = [...this.themes.keys()];
    const idx = ids.indexOf(this.currentThemeId);
    const nextIdx = (idx + 1) % ids.length;
    this.currentThemeId = ids[nextIdx]!;
    const theme = this.themes.get(this.currentThemeId)!;
    if (this.onChange) this.onChange(theme);
    return theme;
  }

  /** Cycle to the previous theme. */
  cycleThemeReverse(): Theme {
    const ids = [...this.themes.keys()];
    const idx = ids.indexOf(this.currentThemeId);
    const prevIdx = (idx - 1 + ids.length) % ids.length;
    this.currentThemeId = ids[prevIdx]!;
    const theme = this.themes.get(this.currentThemeId)!;
    if (this.onChange) this.onChange(theme);
    return theme;
  }

  /** Get the current theme. */
  getCurrent(): Theme {
    return this.themes.get(this.currentThemeId)!;
  }

  get currentId(): string {
    return this.currentThemeId;
  }

  // ─── Color Utilities ──────────────────────────────────────────────

  /** Get a color from the current palette by token name. */
  getColor(token: string): ColorRGB {
    const palette = this.getCurrent().palette;
    return (palette as Record<string, ColorRGB>)[token] ?? palette.text;
  }

  /** Convert a ColorRGB to an ANSI 24-bit foreground escape. */
  toAnsiFg(color: ColorRGB): string {
    return `\x1b[38;2;${String(color.r)};${String(color.g)};${String(color.b)}m`;
  }

  /** Convert a ColorRGB to an ANSI 24-bit background escape. */
  toAnsiBg(color: ColorRGB): string {
    return `\x1b[48;2;${String(color.r)};${String(color.g)};${String(color.b)}m`;
  }

  /** Convert a ColorRGB to the nearest 256-color code. */
  to256Color(color: ColorRGB): number {
    // Simple nearest-match in the 6x6x6 color cube (indices 16-231)
    const r = Math.round(color.r / 255 * 5);
    const g = Math.round(color.g / 255 * 5);
    const b = Math.round(color.b / 255 * 5);
    return 16 + r * 36 + g * 6 + b;
  }

  /** Calculate the luminance of a color (0-1). */
  luminance(color: ColorRGB): number {
    const [rs, gs, bs] = [color.r / 255, color.g / 255, color.b / 255].map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * rs! + 0.7152 * gs! + 0.0722 * bs!;
  }

  /** Calculate contrast ratio between two colors (1-21). */
  contrastRatio(a: ColorRGB, b: ColorRGB): number {
    const la = this.luminance(a);
    const lb = this.luminance(b);
    const lighter = Math.max(la, lb);
    const darker = Math.min(la, lb);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /** Blend two colors by a ratio (0 = all A, 1 = all B). */
  blend(a: ColorRGB, b: ColorRGB, ratio: number): ColorRGB {
    return {
      r: Math.round(a.r + (b.r - a.r) * ratio),
      g: Math.round(a.g + (b.g - a.g) * ratio),
      b: Math.round(a.b + (b.b - a.b) * ratio),
    };
  }

  // ─── Event Handling ───────────────────────────────────────────────

  /** Set a callback for theme changes. */
  setChangeHandler(handler: (theme: Theme) => void): void {
    this.onChange = handler;
  }

  // ─── Rendering ────────────────────────────────────────────────────

  /** Render a theme preview showing all color tokens. */
  renderPreview(theme: Theme, options: ThemeRenderOptions): string[] {
    const { fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const p = theme.palette;

    lines.push(boldFg('text', ` ${theme.name} ${dimFg('textMuted', `— ${theme.description}`)}`));
    lines.push('');

    // Color swatches
    const tokens: Array<[string, ColorRGB]> = [
      ['primary', p.primary],
      ['accent', p.accent],
      ['success', p.success],
      ['warning', p.warning],
      ['error', p.error],
    ];

    for (const [name, color] of tokens) {
      const swatch = this.toAnsiFg(color) + '███\x1b[0m';
      const hex = rgbToHex(color);
      lines.push(`  ${swatch} ${fg('text', name.padEnd(10))} ${dimFg('textMuted', hex)}`);
    }

    lines.push('');

    // Text samples
    lines.push(`  ${fg('text', 'Default text')} ${fg('textMuted', 'Muted text')} ${dimFg('textDim', 'Dim text')}`);
    lines.push(`  ${this.toAnsiFg(p.primary)}Primary text\x1b[0m ${this.toAnsiFg(p.accent)}Accent text\x1b[0m`);
    lines.push(`  ${this.toAnsiFg(p.success)}Success\x1b[0m ${this.toAnsiFg(p.warning)}Warning\x1b[0m ${this.toAnsiFg(p.error)}Error\x1b[0m`);

    // Contrast info
    const textContrast = this.contrastRatio(p.text, p.bg);
    lines.push('');
    lines.push(dimFg('textMuted', `  Contrast: ${textContrast.toFixed(1)}:1 ${textContrast >= 4.5 ? '✓ WCAG AA' : '✗ Low'}`));

    return lines;
  }

  /** Render a theme selection list. */
  renderThemeList(options: ThemeRenderOptions): string[] {
    const { fg, boldFg, dimFg } = options;
    const lines: string[] = [];

    lines.push(boldFg('text', ' Themes'));
    lines.push(dimFg('textMuted', '─'.repeat(30)));

    for (const theme of this.themes.values()) {
      const isCurrent = theme.id === this.currentThemeId;
      const cursor = isCurrent ? fg('accent', '▸ ') : '  ';
      const name = isCurrent ? boldFg('accent', theme.name) : fg('text', theme.name);
      const badge = isCurrent ? fg('success', ' ●') : '';
      const darkBadge = theme.dark ? dimFg('textMuted', ' 🌙') : dimFg('textMuted', ' ☀️');

      lines.push(`${cursor}${name}${badge}${darkBadge}`);
    }

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function rgbToHex(color: ColorRGB): string {
  const r = color.r.toString(16).padStart(2, '0');
  const g = color.g.toString(16).padStart(2, '0');
  const b = color.b.toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}
