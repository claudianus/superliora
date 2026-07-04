/**
 * Theme class + global singleton.
 *
 * Components import `currentTheme` and call methods like
 * `currentTheme.fg('primary', text)` at render time.  When the user switches
 * themes we call `currentTheme.setPalette(newPalette)` — the same singleton
 * instance stays alive, so every component (including already-rendered
 * transcript entries) sees the new colours on the next render frame.
 */

import chalk from 'chalk';

import type { ColorPalette } from './colors';
import { darkColors } from './colors';

export type ColorToken = keyof ColorPalette;

export class Theme {
  private _palette: ColorPalette;
  private _canvasBackgroundEnabled = true;

  constructor(palette: ColorPalette) {
    this._palette = palette;
  }

  get palette(): ColorPalette {
    return this._palette;
  }

  setPalette(palette: ColorPalette): void {
    this._palette = palette;
  }

  get canvasBackgroundEnabled(): boolean {
    return this._canvasBackgroundEnabled;
  }

  setCanvasBackgroundEnabled(enabled: boolean): void {
    this._canvasBackgroundEnabled = enabled;
  }

  color(token: ColorToken): string {
    return this._palette[token];
  }

  /* ── Foreground helpers ── */

  fg(token: ColorToken, text: string): string {
    return chalk.hex(this._palette[token])(text);
  }

  boldFg(token: ColorToken, text: string): string {
    return chalk.hex(this._palette[token]).bold(text);
  }

  dimFg(token: ColorToken, text: string): string {
    return chalk.hex(this._palette[token]).dim(text);
  }

  italicFg(token: ColorToken, text: string): string {
    return chalk.hex(this._palette[token]).italic(text);
  }

  underlineFg(token: ColorToken, text: string): string {
    return chalk.hex(this._palette[token]).underline(text);
  }

  strikethroughFg(token: ColorToken, text: string): string {
    return chalk.hex(this._palette[token]).strikethrough(text);
  }

  /* ── Background helpers ── */

  bg(token: ColorToken, text: string): string {
    return chalk.bgHex(this._palette[token])(text);
  }

  /* ── Standalone style helpers ── */
  //
  // These apply a text attribute (bold / dim / italic / …) using a sensible
  // default palette token so they never fall back to the terminal's bare
  // foreground.  Prefer the explicit `boldFg(token, text)` / `dimFg(token,
  // text)` helpers when the caller knows the exact semantic token; these are
  // convenience shortcuts for callers that only need the attribute.

  bold(text: string): string {
    return chalk.hex(this._palette.textStrong).bold(text);
  }

  dim(text: string): string {
    return chalk.hex(this._palette.textDim).dim(text);
  }

  italic(text: string): string {
    return chalk.hex(this._palette.text).italic(text);
  }

  underline(text: string): string {
    return chalk.hex(this._palette.primary).underline(text);
  }

  strikethrough(text: string): string {
    return chalk.hex(this._palette.textMuted).strikethrough(text);
  }
}

/** Global singleton.  Initialise with dark palette; switch via `setPalette`. */
export const currentTheme = new Theme(darkColors);
