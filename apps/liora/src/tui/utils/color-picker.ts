/**
 * ColorPicker — terminal color selection UI with palettes.
 *
 * Provides GUI-quality color picking:
 * - 256-color palette grid (16x16)
 * - True color (24-bit) RGB selection
 * - HSL/HSV color wheel representation
 * - Named color presets (CSS colors)
 * - Recent colors history
 * - Color preview with contrast check
 * - Hex/RGB/HSL input parsing
 * - Color harmony suggestions (complementary, analogous, triadic)
 * - Gradient preview
 * - Accessibility contrast ratio (WCAG)
 * - Keyboard navigation (arrows in palette)
 * - Copy color value
 *
 * Visual style:
 * ┌─ Color Picker ─────────────────────────────────┐
 * │ Preview: ████████  #FF6B6B                     │
 * │ RGB: 255, 107, 107  HSL: 0°, 100%, 71%         │
 * │                                                 │
 * │ Palette:                                        │
 * │ ■■■■■■■■■■■■■■■■                               │
 * │ ■■■■■■■■■■■■■■■■                               │
 * │ ■■■■■■■□■■■■■■■■  ← cursor                     │
 * │ ■■■■■■■■■■■■■■■■                               │
 * │                                                 │
 * │ Recent: ■ ■ ■ ■ ■                              │
 * └─────────────────────────────────────────────────┘
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RGB {
  readonly r: number; // 0-255
  readonly g: number;
  readonly b: number;
}

export interface HSL {
  readonly h: number; // 0-360
  readonly s: number; // 0-100
  readonly l: number; // 0-100
}

export interface ColorInfo {
  readonly hex: string;
  readonly rgb: RGB;
  readonly hsl: HSL;
  readonly ansi256: number;
  readonly name?: string;
}

export interface ColorPickerRenderOptions {
  readonly width: number;
  readonly showPalette?: boolean;
  readonly showRecent?: boolean;
  readonly showHarmony?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export type HarmonyType = 'complementary' | 'analogous' | 'triadic' | 'split' | 'tetradic';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAMED_COLORS: Record<string, string> = {
  red: '#FF0000', green: '#00FF00', blue: '#0000FF',
  yellow: '#FFFF00', cyan: '#00FFFF', magenta: '#FF00FF',
  white: '#FFFFFF', black: '#000000', gray: '#808080',
  orange: '#FFA500', purple: '#800080', pink: '#FFC0CB',
  brown: '#A52A2A', navy: '#000080', teal: '#008080',
  olive: '#808000', maroon: '#800000', lime: '#00FF00',
  aqua: '#00FFFF', silver: '#C0C0C0', gold: '#FFD700',
  coral: '#FF7F50', salmon: '#FA8072', indigo: '#4B0082',
  violet: '#EE82EE', crimson: '#DC143C', turquoise: '#40E0D0',
};

const MAX_RECENT = 8;

// ---------------------------------------------------------------------------
// ColorPicker
// ---------------------------------------------------------------------------

export class ColorPicker {
  private current: ColorInfo;
  private recentColors: ColorInfo[] = [];
  private paletteCursor = { row: 0, col: 0 };

  constructor(initialColor = '#FF6B6B') {
    this.current = this.parseColor(initialColor);
  }

  // ─── Color Selection ─────────────────────────────────────────────

  /** Set color from hex string. */
  setHex(hex: string): void {
    this.current = this.parseColor(hex);
    this.addToRecent(this.current);
  }

  /** Set color from RGB values. */
  setRGB(r: number, g: number, b: number): void {
    this.current = this.rgbToColorInfo({ r, g, b });
    this.addToRecent(this.current);
  }

  /** Set color from HSL values. */
  setHSL(h: number, s: number, l: number): void {
    const rgb = this.hslToRgb({ h, s, l });
    this.current = this.rgbToColorInfo(rgb);
    this.addToRecent(this.current);
  }

  /** Set color from ANSI 256 index. */
  setAnsi256(index: number): void {
    const rgb = this.ansi256ToRgb(index);
    this.current = this.rgbToColorInfo(rgb);
    this.addToRecent(this.current);
  }

  /** Set color from named color. */
  setNamed(name: string): boolean {
    const hex = NAMED_COLORS[name.toLowerCase()];
    if (hex) {
      this.setHex(hex);
      return true;
    }
    return false;
  }

  /** Get current color. */
  getCurrent(): ColorInfo {
    return this.current;
  }

  /** Get recent colors. */
  getRecent(): readonly ColorInfo[] {
    return this.recentColors;
  }

  private addToRecent(color: ColorInfo): void {
    this.recentColors = [color, ...this.recentColors.filter((c) => c.hex !== color.hex)].slice(0, MAX_RECENT);
  }

  // ─── Palette Navigation ──────────────────────────────────────────

  /** Move palette cursor. */
  movePaletteCursor(dRow: number, dCol: number): void {
    this.paletteCursor = {
      row: Math.max(0, Math.min(15, this.paletteCursor.row + dRow)),
      col: Math.max(0, Math.min(15, this.paletteCursor.col + dCol)),
    };
    // Select the color at cursor
    const index = this.paletteCursor.row * 16 + this.paletteCursor.col;
    this.setAnsi256(index);
  }

  /** Get palette cursor position. */
  getPaletteCursor(): { row: number; col: number } {
    return this.paletteCursor;
  }

  // ─── Color Harmony ───────────────────────────────────────────────

  /** Get harmonious colors. */
  getHarmony(type: HarmonyType): ColorInfo[] {
    const { h, s, l } = this.current.hsl;

    const offsets: Record<HarmonyType, number[]> = {
      complementary: [180],
      analogous: [-30, 30],
      triadic: [120, 240],
      split: [150, 210],
      tetradic: [90, 180, 270],
    };

    return offsets[type].map((offset) => {
      const newH = (h + offset) % 360;
      const rgb = this.hslToRgb({ h: newH, s, l });
      return this.rgbToColorInfo(rgb);
    });
  }

  // ─── Contrast & Accessibility ────────────────────────────────────

  /** Calculate contrast ratio with another color (WCAG). */
  getContrastRatio(other: ColorInfo): number {
    const l1 = this.getLuminance(this.current.rgb);
    const l2 = this.getLuminance(other.rgb);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /** Check if contrast passes WCAG AA for normal text. */
  passesAA(other: ColorInfo): boolean {
    return this.getContrastRatio(other) >= 4.5;
  }

  /** Check if contrast passes WCAG AAA for normal text. */
  passesAAA(other: ColorInfo): boolean {
    return this.getContrastRatio(other) >= 7;
  }

  private getLuminance(rgb: RGB): number {
    const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
    );
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  }

  // ─── Color Conversion ────────────────────────────────────────────

  private parseColor(input: string): ColorInfo {
    let hex = input;

    // Handle named colors
    if (NAMED_COLORS[input.toLowerCase()]) {
      hex = NAMED_COLORS[input.toLowerCase()]!;
    }

    // Normalize hex
    hex = hex.replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }

    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    return this.rgbToColorInfo({ r, g, b });
  }

  private rgbToColorInfo(rgb: RGB): ColorInfo {
    const hex = `#${this.toHex(rgb.r)}${this.toHex(rgb.g)}${this.toHex(rgb.b)}`.toUpperCase();
    const hsl = this.rgbToHsl(rgb);
    const ansi256 = this.rgbToAnsi256(rgb);
    const name = this.findColorName(hex);

    return { hex, rgb, hsl, ansi256, name };
  }

  private toHex(n: number): string {
    return n.toString(16).padStart(2, '0').toUpperCase();
  }

  private rgbToHsl(rgb: RGB): HSL {
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;

    if (max === min) {
      return { h: 0, s: 0, l: Math.round(l * 100) };
    }

    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    let h: number;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  }

  private hslToRgb(hsl: HSL): RGB {
    const h = hsl.h / 360;
    const s = hsl.s / 100;
    const l = hsl.l / 100;

    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }

    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    };
  }

  private rgbToAnsi256(rgb: RGB): number {
    // Find closest ANSI 256 color
    const { r, g, b } = rgb;

    // Check grayscale ramp (232-255)
    const gray = Math.round((r + g + b) / 3);
    if (Math.abs(r - gray) < 10 && Math.abs(g - gray) < 10 && Math.abs(b - gray) < 10) {
      if (gray < 8) return 16;
      if (gray > 248) return 231;
      return 232 + Math.round((gray - 8) / 247 * 23);
    }

    // 6x6x6 color cube (16-231)
    const ri = Math.round(r / 255 * 5);
    const gi = Math.round(g / 255 * 5);
    const bi = Math.round(b / 255 * 5);
    return 16 + ri * 36 + gi * 6 + bi;
  }

  private ansi256ToRgb(index: number): RGB {
    if (index < 16) {
      // Standard colors (approximate)
      const standard: RGB[] = [
        { r: 0, g: 0, b: 0 }, { r: 128, g: 0, b: 0 }, { r: 0, g: 128, b: 0 }, { r: 128, g: 128, b: 0 },
        { r: 0, g: 0, b: 128 }, { r: 128, g: 0, b: 128 }, { r: 0, g: 128, b: 128 }, { r: 192, g: 192, b: 192 },
        { r: 128, g: 128, b: 128 }, { r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 255, g: 255, b: 0 },
        { r: 0, g: 0, b: 255 }, { r: 255, g: 0, b: 255 }, { r: 0, g: 255, b: 255 }, { r: 255, g: 255, b: 255 },
      ];
      return standard[index] ?? { r: 0, g: 0, b: 0 };
    }

    if (index < 232) {
      // 6x6x6 color cube
      const i = index - 16;
      const ri = Math.floor(i / 36);
      const gi = Math.floor((i % 36) / 6);
      const bi = i % 6;
      const values = [0, 95, 135, 175, 215, 255];
      return { r: values[ri]!, g: values[gi]!, b: values[bi]! };
    }

    // Grayscale ramp
    const gray = 8 + (index - 232) * 10;
    return { r: gray, g: gray, b: gray };
  }

  private findColorName(hex: string): string | undefined {
    for (const [name, colorHex] of Object.entries(NAMED_COLORS)) {
      if (colorHex.toUpperCase() === hex) return name;
    }
    return undefined;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render the color picker. */
  render(options: ColorPickerRenderOptions): string[] {
    const { width, showPalette = true, showRecent = true, showHarmony = true, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const innerWidth = width - 4;

    // Header
    lines.push(fg('textMuted', `┌─ Color Picker ${'─'.repeat(Math.max(0, innerWidth - 14))}┐`));

    // Preview
    const { hex, rgb, hsl, ansi256, name } = this.current;
    const previewBlock = this.renderColorBlock(this.current, 8);
    const nameStr = name ? ` (${name})` : '';
    lines.push(`│ ${previewBlock} ${boldFg('text', hex)}${dimFg('textMuted', nameStr)}`);
    lines.push(`│ ${dimFg('textMuted', `RGB: ${String(rgb.r)}, ${String(rgb.g)}, ${String(rgb.b)}  HSL: ${String(hsl.h)}°, ${String(hsl.s)}%, ${String(hsl.l)}%`)}`);
    lines.push(`│ ${dimFg('textMuted', `ANSI: ${String(ansi256)}`)}`);
    lines.push('│');

    // Palette (16x16 grid of ANSI 256 colors, showing first 256)
    if (showPalette) {
      lines.push(`│ ${boldFg('text', 'Palette:')}`);
      for (let row = 0; row < 16; row++) {
        let line = '│ ';
        for (let col = 0; col < 16; col++) {
          const index = row * 16 + col;
          const color = this.ansi256ToRgb(index);
          const isCursor = row === this.paletteCursor.row && col === this.paletteCursor.col;
          const block = isCursor
            ? `\x1b[48;2;${String(color.r)};${String(color.g)};${String(color.b)}m□\x1b[0m`
            : `\x1b[48;2;${String(color.r)};${String(color.g)};${String(color.b)}m■\x1b[0m`;
          line += block;
        }
        lines.push(line);
      }
      lines.push('│');
    }

    // Recent colors
    if (showRecent && this.recentColors.length > 0) {
      const recentBlocks = this.recentColors.map((c) => this.renderColorBlock(c, 1)).join(' ');
      lines.push(`│ ${dimFg('textMuted', 'Recent:')} ${recentBlocks}`);
      lines.push('│');
    }

    // Harmony
    if (showHarmony) {
      const comp = this.getHarmony('complementary')[0]!;
      const analog = this.getHarmony('analogous');
      lines.push(`│ ${dimFg('textMuted', 'Harmony:')}`);
      lines.push(`│   Comp: ${this.renderColorBlock(comp, 2)} ${comp.hex}`);
      lines.push(`│   Analog: ${analog.map((c) => this.renderColorBlock(c, 2)).join(' ')}`);
    }

    // Footer
    lines.push(fg('textMuted', `└${'─'.repeat(innerWidth + 2)}┘`));

    return lines;
  }

  private renderColorBlock(color: ColorInfo, width: number): string {
    const { r, g, b } = color.rgb;
    return `\x1b[48;2;${String(r)};${String(g)};${String(b)}m${' '.repeat(width)}\x1b[0m`;
  }

  /** Render a gradient between two colors. */
  renderGradient(from: ColorInfo, to: ColorInfo, steps: number): string {
    const blocks: string[] = [];
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const r = Math.round(from.rgb.r + (to.rgb.r - from.rgb.r) * t);
      const g = Math.round(from.rgb.g + (to.rgb.g - from.rgb.g) * t);
      const b = Math.round(from.rgb.b + (to.rgb.b - from.rgb.b) * t);
      blocks.push(`\x1b[48;2;${String(r)};${String(g)};${String(b)}m \x1b[0m`);
    }
    return blocks.join('');
  }
}

// ---------------------------------------------------------------------------
// Utility exports
// ---------------------------------------------------------------------------

/** Get all named colors. */
export function getNamedColors(): Record<string, string> {
  return { ...NAMED_COLORS };
}

/** Generate a random pleasing color. */
export function randomColor(): ColorInfo {
  const h = Math.floor(Math.random() * 360);
  const s = 50 + Math.floor(Math.random() * 40); // 50-90%
  const l = 40 + Math.floor(Math.random() * 30); // 40-70%

  const picker = new ColorPicker();
  picker.setHSL(h, s, l);
  return picker.getCurrent();
}
