import { ANSI_RESET_STYLE } from './terminal-output';
import { measureDisplayWidth, splitDisplayClusters } from './text-metrics';

export interface RendererComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}

export type Component = RendererComponent;

export type RendererTextBackgroundFn = (text: string) => string;

export interface RendererAnsiTextOptions {
  readonly tabWidth?: number;
}

export class Text implements RendererComponent {
  private cachedText?: string;
  private cachedWidth?: number;
  private cachedLines?: string[];
  private customBgFn?: RendererTextBackgroundFn;

  constructor(
    private text = '',
    private readonly paddingX = 1,
    private readonly paddingY = 1,
    customBgFn?: RendererTextBackgroundFn,
  ) {
    this.customBgFn = customBgFn;
  }

  setText(text: string): void {
    if (this.text === text) return;
    this.text = text;
    this.invalidate();
  }

  setCustomBgFn(customBgFn?: RendererTextBackgroundFn): void {
    if (this.customBgFn === customBgFn) return;
    this.customBgFn = customBgFn;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedText = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    const safeWidth = normalizeTextWidth(width);
    if (this.cachedLines !== undefined && this.cachedText === this.text && this.cachedWidth === safeWidth) {
      return this.cachedLines;
    }

    const result = this.renderUncached(safeWidth);
    this.cachedText = this.text;
    this.cachedWidth = safeWidth;
    this.cachedLines = result;
    return result;
  }

  private renderUncached(width: number): string[] {
    if (width <= 0 || this.text.length === 0 || this.text.trim() === '') return [];

    const paddingX = normalizePadding(this.paddingX);
    const paddingY = normalizePadding(this.paddingY);
    const normalizedText = this.text.replaceAll('\t', '   ');
    const contentWidth = Math.max(1, width - paddingX * 2);
    const wrappedLines = wrapAnsiDisplayText(normalizedText, contentWidth, { tabWidth: 3 });
    const leftMargin = ' '.repeat(paddingX);
    const rightMargin = ' '.repeat(paddingX);
    const contentLines = wrappedLines.map((line) =>
      padAnsiDisplayLine(leftMargin + line + rightMargin, width, this.customBgFn),
    );

    const emptyLine = padAnsiDisplayLine('', width, this.customBgFn);
    const emptyLines = Array.from({ length: paddingY }, () => emptyLine);
    return [...emptyLines, ...contentLines, ...emptyLines];
  }
}

export function measureAnsiDisplayWidth(
  text: string,
  options: RendererAnsiTextOptions = {},
): number {
  let width = 0;
  for (const segment of scanAnsiText(text, normalizeTabWidth(options.tabWidth))) {
    if (segment.kind === 'text') width += segment.width;
  }
  return width;
}

export function visibleWidth(text: string): number {
  return measureAnsiDisplayWidth(text, { tabWidth: 3 });
}

export function stripAnsiControls(text: string): string {
  let out = '';
  for (const segment of scanAnsiText(text, 3)) {
    if (segment.kind === 'text') out += segment.text;
  }
  return out;
}

export function wrapAnsiDisplayText(
  text: string,
  width: number,
  options: RendererAnsiTextOptions = {},
): string[] {
  const maxWidth = normalizeTextWidth(width);
  if (maxWidth <= 0) return [''];
  if (text.length === 0) return [''];

  const state = new RendererAnsiState();
  const lines: string[] = [];
  let current = '';
  let currentWidth = 0;
  const tabWidth = normalizeTabWidth(options.tabWidth);

  for (const token of tokenizeAnsiWrapText(text, tabWidth)) {
    if (token.kind === 'newline') {
      lines.push(state.closeLine(current.trimEnd()));
      current = state.prefix();
      currentWidth = 0;
      continue;
    }

    if (token.width <= 0) {
      current += token.text;
      state.processText(token.text);
      continue;
    }

    if (token.width > maxWidth && !token.whitespace) {
      if (currentWidth > 0) {
        lines.push(state.closeLine(current.trimEnd()));
      }
      const broken = breakLongAnsiToken(token.text, maxWidth, state, tabWidth);
      lines.push(...broken.lines);
      current = broken.current;
      currentWidth = broken.width;
      continue;
    }

    if (currentWidth > 0 && currentWidth + token.width > maxWidth) {
      lines.push(state.closeLine(current.trimEnd()));
      current = state.prefix();
      currentWidth = 0;
      if (token.whitespace) continue;
    }

    current += token.text;
    currentWidth += token.width;
    state.processText(token.text);
  }

  if (current.length > 0 || lines.length === 0) {
    lines.push(state.closeLine(current.trimEnd()));
  }
  return lines;
}

export function wrapTextWithAnsi(text: string, width: number): string[] {
  return wrapAnsiDisplayText(text, width, { tabWidth: 3 });
}

export function truncateAnsiDisplayText(
  text: string,
  maxWidth: number,
  ellipsis = '...',
  pad = false,
  options: RendererAnsiTextOptions = {},
): string {
  const width = normalizeTextWidth(maxWidth);
  if (width <= 0) return '';
  if (text.length === 0) return pad ? ' '.repeat(width) : '';

  const ellipsisWidth = measureAnsiDisplayWidth(ellipsis, options);
  if (ellipsisWidth >= width) {
    const textWidth = measureAnsiDisplayWidth(text, options);
    if (textWidth <= width) return pad ? text + ' '.repeat(width - textWidth) : text;

    const clippedEllipsis = truncatePlainDisplayText(
      ellipsis,
      width,
      normalizeTabWidth(options.tabWidth),
    );
    return pad
      ? clippedEllipsis + ' '.repeat(Math.max(0, width - measureDisplayWidth(clippedEllipsis)))
      : clippedEllipsis;
  }

  const contentWidth = Math.max(0, width - ellipsisWidth);
  const textWidth = measureAnsiDisplayWidth(text, options);
  if (textWidth <= width) {
    return pad ? text + ' '.repeat(width - textWidth) : text;
  }

  const state = new RendererAnsiState();
  let out = '';
  let used = 0;
  const tabWidth = normalizeTabWidth(options.tabWidth);

  for (const segment of scanAnsiText(text, tabWidth)) {
    if (segment.kind === 'control') {
      out += segment.text;
      state.process(segment.text);
      continue;
    }

    if (segment.width <= 0) {
      out += segment.text;
      continue;
    }

    if (used + segment.width > contentWidth) break;
    out += segment.text;
    used += segment.width;
  }

  const clippedEllipsis = truncatePlainDisplayText(ellipsis, width - used, tabWidth);
  const result = state.closeLine(out) + clippedEllipsis;
  return pad ? result + ' '.repeat(Math.max(0, width - used - measureDisplayWidth(clippedEllipsis))) : result;
}

export function truncateToWidth(
  text: string,
  maxWidth: number,
  ellipsis = '...',
  pad = false,
): string {
  return truncateAnsiDisplayText(text, maxWidth, ellipsis, pad, { tabWidth: 3 });
}

function padAnsiDisplayLine(
  line: string,
  width: number,
  customBgFn: RendererTextBackgroundFn | undefined,
): string {
  const safeWidth = normalizeTextWidth(width);
  const clipped = measureAnsiDisplayWidth(line, { tabWidth: 3 }) > safeWidth
    ? truncateAnsiDisplayText(line, safeWidth, '', false, { tabWidth: 3 })
    : line;
  const padding = ' '.repeat(Math.max(0, safeWidth - measureAnsiDisplayWidth(clipped, { tabWidth: 3 })));
  const padded = clipped + padding;
  return customBgFn === undefined ? padded : customBgFn(padded);
}

type RendererAnsiSegment =
  | { readonly kind: 'control'; readonly text: string; readonly width: 0 }
  | { readonly kind: 'text'; readonly text: string; readonly width: number };

type RendererAnsiWrapToken =
  | { readonly kind: 'newline' }
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly width: number;
      readonly whitespace: boolean;
    };

function tokenizeAnsiWrapText(text: string, tabWidth: number): RendererAnsiWrapToken[] {
  const tokens: RendererAnsiWrapToken[] = [];
  let tokenText = '';
  let tokenWidth = 0;
  let tokenWhitespace: boolean | undefined;

  const flush = (): void => {
    if (tokenText.length === 0) return;
    tokens.push({
      kind: 'text',
      text: tokenText,
      width: tokenWidth,
      whitespace: tokenWhitespace === true,
    });
    tokenText = '';
    tokenWidth = 0;
    tokenWhitespace = undefined;
  };

  for (const segment of scanAnsiText(text, tabWidth)) {
    if (segment.kind === 'control') {
      tokenText += segment.text;
      continue;
    }
    if (segment.text === '\n') {
      flush();
      tokens.push({ kind: 'newline' });
      continue;
    }

    const whitespace = segment.width > 0 && segment.text.trim() === '';
    if (tokenWhitespace !== undefined && whitespace !== tokenWhitespace) {
      flush();
    }
    tokenWhitespace = whitespace;
    tokenText += segment.text;
    tokenWidth += segment.width;
  }

  flush();
  return tokens;
}

function breakLongAnsiToken(
  text: string,
  maxWidth: number,
  state: RendererAnsiState,
  tabWidth: number,
): { readonly lines: readonly string[]; readonly current: string; readonly width: number } {
  const lines: string[] = [];
  let current = state.prefix();
  let currentWidth = 0;

  for (const segment of scanAnsiText(text, tabWidth)) {
    if (segment.kind === 'control') {
      current += segment.text;
      state.process(segment.text);
      continue;
    }
    if (segment.width <= 0) {
      current += segment.text;
      continue;
    }
    if (segment.width > maxWidth) continue;
    if (currentWidth > 0 && currentWidth + segment.width > maxWidth) {
      lines.push(state.closeLine(current.trimEnd()));
      current = state.prefix();
      currentWidth = 0;
    }
    current += segment.text;
    currentWidth += segment.width;
  }

  return { lines, current, width: currentWidth };
}

function* scanAnsiText(text: string, tabWidth: number): Generator<RendererAnsiSegment> {
  let cursor = 0;
  while (cursor < text.length) {
    const control = readAnsiControlAt(text, cursor);
    if (control !== undefined) {
      yield { kind: 'control', text: control.text, width: 0 };
      cursor += control.length;
      continue;
    }

    const nextEscape = text.indexOf('\u001B', cursor + 1);
    const end = nextEscape === -1 ? text.length : nextEscape;
    for (const cluster of splitDisplayClusters(text.slice(cursor, end))) {
      if (cluster.text === '\t') {
        yield { kind: 'text', text: ' '.repeat(tabWidth), width: tabWidth };
      } else {
        yield { kind: 'text', text: cluster.text, width: cluster.width };
      }
    }
    cursor = end;
  }
}

function readAnsiControlAt(
  text: string,
  index: number,
): { readonly text: string; readonly length: number } | undefined {
  if (text.codePointAt(index) !== 0x1b) return undefined;
  const next = text.codePointAt(index + 1);
  if (next === undefined) return undefined;

  if (next === 0x5b) return readAnsiUntilFinalByte(text, index, 0x40, 0x7e);
  if (next === 0x5d || next === 0x50 || next === 0x5e || next === 0x5f) {
    return readAnsiStringControl(text, index);
  }
  if (next >= 0x40 && next <= 0x5f) {
    return { text: text.slice(index, index + 2), length: 2 };
  }
  return undefined;
}

function readAnsiUntilFinalByte(
  text: string,
  index: number,
  minFinalByte: number,
  maxFinalByte: number,
): { readonly text: string; readonly length: number } | undefined {
  for (let cursor = index + 2; cursor < text.length; cursor++) {
    const code = text.codePointAt(cursor);
    if (code === undefined) continue;
    if (code >= minFinalByte && code <= maxFinalByte) {
      return { text: text.slice(index, cursor + 1), length: cursor + 1 - index };
    }
  }
  return { text: text.slice(index), length: text.length - index };
}

function readAnsiStringControl(
  text: string,
  index: number,
): { readonly text: string; readonly length: number } {
  for (let cursor = index + 2; cursor < text.length; cursor++) {
    const code = text.codePointAt(cursor);
    if (code === 0x07) {
      return { text: text.slice(index, cursor + 1), length: cursor + 1 - index };
    }
    if (code === 0x1b && text.codePointAt(cursor + 1) === 0x5c) {
      return { text: text.slice(index, cursor + 2), length: cursor + 2 - index };
    }
  }
  return { text: text.slice(index), length: text.length - index };
}

class RendererAnsiState {
  private activeSgr = '';
  private fg = false;
  private bg = false;
  private bold = false;
  private dim = false;
  private italic = false;
  private underline = false;
  private inverse = false;

  process(control: string): void {
    const sgr = parseSgrControl(control);
    if (sgr === undefined) return;

    for (let index = 0; index < sgr.length; index++) {
      const code = sgr[index] ?? 0;
      switch (code) {
        case 0:
          this.reset();
          break;
        case 1:
          this.bold = true;
          break;
        case 2:
          this.dim = true;
          break;
        case 3:
          this.italic = true;
          break;
        case 4:
          this.underline = true;
          break;
        case 7:
          this.inverse = true;
          break;
        case 22:
          this.bold = false;
          this.dim = false;
          break;
        case 23:
          this.italic = false;
          break;
        case 24:
          this.underline = false;
          break;
        case 27:
          this.inverse = false;
          break;
        case 38:
          this.fg = true;
          index += sgr[index + 1] === 2 ? 4 : sgr[index + 1] === 5 ? 2 : 0;
          break;
        case 39:
          this.fg = false;
          break;
        case 48:
          this.bg = true;
          index += sgr[index + 1] === 2 ? 4 : sgr[index + 1] === 5 ? 2 : 0;
          break;
        case 49:
          this.bg = false;
          break;
        default:
          if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) this.fg = true;
          if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) this.bg = true;
          break;
      }
    }

    if (sgr.some((code) => code !== 0)) {
      this.activeSgr += control;
    }
    if (!this.hasActiveStyle()) this.activeSgr = '';
  }

  processText(text: string): void {
    for (const segment of scanAnsiText(text, 3)) {
      if (segment.kind === 'control') this.process(segment.text);
    }
  }

  prefix(): string {
    return this.activeSgr;
  }

  closeLine(line: string): string {
    return this.hasActiveStyle() && line.length > 0 ? line + ANSI_RESET_STYLE : line;
  }

  private reset(): void {
    this.activeSgr = '';
    this.fg = false;
    this.bg = false;
    this.bold = false;
    this.dim = false;
    this.italic = false;
    this.underline = false;
    this.inverse = false;
  }

  private hasActiveStyle(): boolean {
    return (
      this.fg ||
      this.bg ||
      this.bold ||
      this.dim ||
      this.italic ||
      this.underline ||
      this.inverse
    );
  }
}

function parseSgrControl(control: string): readonly number[] | undefined {
  if (!control.startsWith('\u001B[') || !control.endsWith('m')) return undefined;
  const raw = control.slice(2, -1);
  if (raw.length === 0) return [0];
  return raw.split(';').map((part) => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  });
}

function truncatePlainDisplayText(text: string, maxWidth: number, tabWidth: number): string {
  let out = '';
  let used = 0;
  for (const segment of scanAnsiText(text, tabWidth)) {
    if (segment.kind === 'control' || segment.width <= 0) continue;
    if (used + segment.width > maxWidth) break;
    out += segment.text;
    used += segment.width;
  }
  return out;
}

function normalizeTextWidth(width: number): number {
  return Number.isFinite(width) && width > 0 ? Math.floor(width) : 0;
}

function normalizePadding(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeTabWidth(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? 3 : Math.floor(value);
}
