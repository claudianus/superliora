import type { RendererCell, RendererCellStyle } from './cell-buffer';
import { textToCells } from './text-metrics';

const ANSI_CONTROL_RE = /\u001B\[([0-9;]*)m|\u001B\]8;([^\u0007\u001B]*);([^\u0007\u001B]*)(?:\u0007|\u001B\\)/g;

const ANSI_COLOR_16 = [
  '#000000',
  '#800000',
  '#008000',
  '#808000',
  '#000080',
  '#800080',
  '#008080',
  '#c0c0c0',
  '#808080',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#0000ff',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
] as const;

type MutableRendererCellStyle = {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
};

export function ansiTextToCells(text: string): readonly RendererCell[] {
  const cells: RendererCell[] = [];
  let style: RendererCellStyle | undefined;
  let link: string | undefined;
  let cursor = 0;

  ANSI_CONTROL_RE.lastIndex = 0;
  for (const match of text.matchAll(ANSI_CONTROL_RE)) {
    const start = match.index;
    appendPlainText(cells, text.slice(cursor, start), style, link);
    if (match[1] !== undefined) {
      style = applySgr(style, parseSgrParams(match[1]));
    } else {
      link = normalizeOsc8Uri(match[3]);
    }
    cursor = start + match[0].length;
  }
  appendPlainText(cells, text.slice(cursor), style, link);
  return cells;
}

export function ansiTextToCellLines(lines: readonly string[]): readonly (readonly RendererCell[])[] {
  return lines.map((line) => ansiTextToCells(line));
}

function appendPlainText(
  cells: RendererCell[],
  text: string,
  style: RendererCellStyle | undefined,
  link: string | undefined,
): void {
  for (const cell of textToCells(text.replaceAll(/[\r\n]/g, ''), style)) {
    cells.push(link === undefined ? cell : { ...cell, link });
  }
}

function normalizeOsc8Uri(uri: string | undefined): string | undefined {
  if (uri === undefined || uri.length === 0) return undefined;
  const normalized = uri.replaceAll(/[\u0000-\u001F\u007F]/g, '');
  return normalized.length === 0 ? undefined : normalized;
}

function parseSgrParams(raw: string | undefined): number[] {
  if (raw === undefined || raw.length === 0) return [0];
  return raw.split(';').map((part) => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  });
}

function applySgr(
  current: RendererCellStyle | undefined,
  params: readonly number[],
): RendererCellStyle | undefined {
  let style = cloneStyle(current);
  for (let i = 0; i < params.length; i++) {
    const code = params[i] ?? 0;
    switch (code) {
      case 0:
        style = {};
        break;
      case 1:
        style.bold = true;
        break;
      case 2:
        style.dim = true;
        break;
      case 3:
        style.italic = true;
        break;
      case 4:
        style.underline = true;
        break;
      case 7:
        style.inverse = true;
        break;
      case 22:
        delete style.bold;
        delete style.dim;
        break;
      case 23:
        delete style.italic;
        break;
      case 24:
        delete style.underline;
        break;
      case 27:
        delete style.inverse;
        break;
      case 39:
        delete style.fg;
        break;
      case 49:
        delete style.bg;
        break;
      case 38:
      case 48: {
        const color = parseExtendedColor(params, i + 1);
        if (color !== undefined) {
          if (code === 38) style.fg = color.hex;
          else style.bg = color.hex;
          i = color.nextIndex;
        }
        break;
      }
      default:
        applyBasicColor(style, code);
        break;
    }
  }
  return normalizeStyle(style);
}

function parseExtendedColor(
  params: readonly number[],
  startIndex: number,
): { readonly hex: string; readonly nextIndex: number } | undefined {
  const mode = params[startIndex];
  if (mode === 2) {
    const r = params[startIndex + 1];
    const g = params[startIndex + 2];
    const b = params[startIndex + 3];
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return {
      hex: rgbToHex(clampByte(r), clampByte(g), clampByte(b)),
      nextIndex: startIndex + 3,
    };
  }
  if (mode === 5) {
    const value = params[startIndex + 1];
    if (value === undefined) return undefined;
    return { hex: ansi256ToHex(clampByte(value)), nextIndex: startIndex + 1 };
  }
  return undefined;
}

function applyBasicColor(style: MutableRendererCellStyle, code: number): void {
  if (code >= 30 && code <= 37) {
    style.fg = ANSI_COLOR_16[code - 30];
    return;
  }
  if (code >= 40 && code <= 47) {
    style.bg = ANSI_COLOR_16[code - 40];
    return;
  }
  if (code >= 90 && code <= 97) {
    style.fg = ANSI_COLOR_16[8 + code - 90];
    return;
  }
  if (code >= 100 && code <= 107) {
    style.bg = ANSI_COLOR_16[8 + code - 100];
  }
}

function ansi256ToHex(value: number): string {
  if (value < 16) return ANSI_COLOR_16[value]!;
  if (value >= 232) {
    const level = 8 + (value - 232) * 10;
    return rgbToHex(level, level, level);
  }
  const color = value - 16;
  const r = Math.floor(color / 36);
  const g = Math.floor((color % 36) / 6);
  const b = color % 6;
  return rgbToHex(colorCubeLevel(r), colorCubeLevel(g), colorCubeLevel(b));
}

function colorCubeLevel(value: number): number {
  return value === 0 ? 0 : 55 + value * 40;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
}

function byteToHex(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.floor(value)));
}

function cloneStyle(style: RendererCellStyle | undefined): MutableRendererCellStyle {
  if (style === undefined) return {};
  return { ...style };
}

function normalizeStyle(style: MutableRendererCellStyle): RendererCellStyle | undefined {
  return Object.keys(style).length === 0 ? undefined : style;
}
