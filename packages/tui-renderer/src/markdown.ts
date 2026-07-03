import {
  type Component,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type RendererTextBackgroundFn,
} from './text-component';
import { renderRendererDividerRow } from './component-primitives';

export interface DefaultTextStyle {
  readonly color?: RendererTextBackgroundFn;
  readonly bgColor?: RendererTextBackgroundFn;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly strikethrough?: boolean;
  readonly underline?: boolean;
}

export interface MarkdownTheme {
  readonly heading: RendererTextBackgroundFn;
  readonly link: RendererTextBackgroundFn;
  readonly linkUrl: RendererTextBackgroundFn;
  readonly code: RendererTextBackgroundFn;
  readonly codeBlock: RendererTextBackgroundFn;
  readonly codeBlockBorder: RendererTextBackgroundFn;
  readonly quote: RendererTextBackgroundFn;
  readonly quoteBorder: RendererTextBackgroundFn;
  readonly hr: RendererTextBackgroundFn;
  readonly listBullet: RendererTextBackgroundFn;
  readonly bold: RendererTextBackgroundFn;
  readonly italic: RendererTextBackgroundFn;
  readonly strikethrough: RendererTextBackgroundFn;
  readonly underline: RendererTextBackgroundFn;
  readonly highlightCode?: (code: string, lang?: string) => string[];
  readonly codeBlockIndent?: string;
}

interface MarkdownInlineStyleContext {
  readonly applyText: (text: string) => string;
  readonly stylePrefix: string;
}

export class Markdown implements Component {
  private cachedText?: string;
  private cachedWidth?: number;
  private cachedLines?: string[];
  private defaultStylePrefix?: string;

  constructor(
    private text: string,
    private readonly paddingX: number,
    private readonly paddingY: number,
    private readonly theme: MarkdownTheme,
    private readonly defaultTextStyle?: DefaultTextStyle,
  ) {}

  setText(text: string): void {
    if (this.text === text) return;
    this.text = text;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedText = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
    this.defaultStylePrefix = undefined;
  }

  render(width: number): string[] {
    const safeWidth = normalizeWidth(width);
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
    if (width <= 0) return [''];
    if (this.text.length === 0 || this.text.trim() === '') return [];

    const paddingX = normalizePadding(this.paddingX);
    const paddingY = normalizePadding(this.paddingY);
    const contentWidth = Math.max(1, width - paddingX * 2);
    const normalizedText = this.text.replaceAll('\t', '   ');
    const renderedLines = this.renderBlocks(normalizedText.split('\n'), contentWidth);
    const wrappedLines = renderedLines.flatMap((line) => wrapTextWithAnsi(line, contentWidth));
    const contentLines = wrappedLines.map((line) => this.padLine(' '.repeat(paddingX) + line, width));
    const emptyLine = this.padLine('', width);
    return [
      ...Array.from({ length: paddingY }, () => emptyLine),
      ...contentLines,
      ...Array.from({ length: paddingY }, () => emptyLine),
    ];
  }

  private renderBlocks(lines: readonly string[], width: number): string[] {
    const out: string[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index] ?? '';
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        out.push('');
        index++;
        continue;
      }

      const fence = line.match(/^\s*```([^\s`]*)?.*$/);
      if (fence !== null) {
        const lang = fence[1]?.trim();
        const codeLines: string[] = [];
        index++;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
          codeLines.push(lines[index] ?? '');
          index++;
        }
        if (index < lines.length) index++;
        out.push(...this.renderCodeBlock(codeLines.join('\n'), lang));
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading !== null) {
        out.push(this.renderHeading(heading[1]!.length, heading[2] ?? ''));
        index++;
        if (index < lines.length && (lines[index] ?? '').trim().length > 0) out.push('');
        continue;
      }

      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        out.push(this.theme.hr(renderRendererDividerRow({ width: Math.min(width, 80) })));
        index++;
        if (index < lines.length && (lines[index] ?? '').trim().length > 0) out.push('');
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const quoteLines: string[] = [];
        while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
          quoteLines.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
          index++;
        }
        out.push(...this.renderQuote(quoteLines, width));
        if (index < lines.length && (lines[index] ?? '').trim().length > 0) out.push('');
        continue;
      }

      if (isTableStart(lines, index)) {
        const tableLines: string[] = [];
        while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim().length > 0) {
          tableLines.push(lines[index] ?? '');
          index++;
        }
        out.push(...this.renderSimpleTable(tableLines, width));
        continue;
      }

      if (isListLine(line)) {
        while (index < lines.length && isListLine(lines[index] ?? '')) {
          out.push(this.renderListLine(lines[index] ?? ''));
          index++;
        }
        continue;
      }

      const paragraph: string[] = [];
      while (
        index < lines.length &&
        (lines[index] ?? '').trim().length > 0 &&
        !isSpecialBlockStart(lines, index)
      ) {
        paragraph.push((lines[index] ?? '').trim());
        index++;
      }
      out.push(this.renderInline(paragraph.join(' ')));
    }

    return trimTrailingBlankLines(out);
  }

  private renderHeading(level: number, text: string): string {
    const headingStyle = level === 1
      ? (value: string) => this.theme.heading(this.theme.bold(this.theme.underline(value)))
      : (value: string) => this.theme.heading(this.theme.bold(value));
    const rendered = this.renderInline(text);
    if (level >= 3) return headingStyle(`${'#'.repeat(level)} ${rendered}`);
    return headingStyle(rendered);
  }

  private renderCodeBlock(code: string, lang: string | undefined): string[] {
    const indent = this.theme.codeBlockIndent ?? '  ';
    const highlighted = this.theme.highlightCode?.(code, lang) ??
      code.split('\n').map((line) => this.theme.codeBlock(line));
    return [
      this.theme.codeBlockBorder(`\`\`\`${lang ?? ''}`),
      ...highlighted.map((line) => `${indent}${line}`),
      this.theme.codeBlockBorder('```'),
    ];
  }

  private renderQuote(lines: readonly string[], width: number): string[] {
    const quoteWidth = Math.max(1, width - 2);
    const content = this.renderBlocks(lines, quoteWidth);
    const quoteStyle = (text: string) => this.theme.quote(this.theme.italic(text));
    return content.flatMap((line) =>
      wrapTextWithAnsi(quoteStyle(line), quoteWidth).map(
        (wrapped) => this.theme.quoteBorder('│ ') + wrapped,
      ),
    );
  }

  private renderSimpleTable(lines: readonly string[], width: number): string[] {
    const fallback = lines.join('\n');
    const table = lines.filter((line, index) => index !== 1);
    const rows = table.map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => this.renderInline(cell.trim())),
    );
    if (rows.length === 0) return wrapTextWithAnsi(fallback, width);

    const columnCount = Math.max(...rows.map((row) => row.length));
    if (columnCount <= 0 || width < columnCount * 3 + 1) return wrapTextWithAnsi(fallback, width);

    const contentWidth = Math.max(columnCount, width - (columnCount * 3 + 1));
    const columnWidth = Math.max(1, Math.floor(contentWidth / columnCount));
    return rows.map((row, rowIndex) => {
      const cells = Array.from({ length: columnCount }, (_, column) =>
        truncateToWidth(row[column] ?? '', columnWidth, '…', true),
      );
      const rendered = `│ ${cells.join(' │ ')} │`;
      return rowIndex === 0 ? this.theme.bold(rendered) : rendered;
    });
  }

  private renderListLine(line: string): string {
    const match = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (match === null) return this.renderInline(line.trim());
    const indent = ' '.repeat(Math.floor((match[1]?.length ?? 0) / 2) * 2);
    const rawBullet = match[2] ?? '-';
    const bullet = /^\d/.test(rawBullet) ? `${rawBullet.replace(/[.)]$/, '.')} ` : '- ';
    return indent + this.theme.listBullet(bullet) + this.renderInline(match[3] ?? '');
  }

  private renderInline(text: string, context: MarkdownInlineStyleContext = this.defaultInlineContext()): string {
    let out = '';
    let index = 0;
    while (index < text.length) {
      const link = readDelimitedInline(text, index, '[', '](', ')');
      if (link !== undefined) {
        const label = this.renderInline(link.inner, context);
        out += this.theme.link(this.theme.underline(label)) + this.theme.linkUrl(` (${link.extra})`) + context.stylePrefix;
        index = link.end;
        continue;
      }

      const strong = readPair(text, index, '**') ?? readPair(text, index, '__');
      if (strong !== undefined) {
        out += this.theme.bold(this.renderInline(strong.inner, context)) + context.stylePrefix;
        index = strong.end;
        continue;
      }

      const strike = readPair(text, index, '~~');
      if (strike !== undefined) {
        out += this.theme.strikethrough(this.renderInline(strike.inner, context)) + context.stylePrefix;
        index = strike.end;
        continue;
      }

      const code = readPair(text, index, '`');
      if (code !== undefined) {
        out += this.theme.code(code.inner) + context.stylePrefix;
        index = code.end;
        continue;
      }

      const emphasis = readEmphasis(text, index);
      if (emphasis !== undefined) {
        out += this.theme.italic(this.renderInline(emphasis.inner, context)) + context.stylePrefix;
        index = emphasis.end;
        continue;
      }

      out += context.applyText(text[index] ?? '');
      index++;
    }
    return out;
  }

  private defaultInlineContext(): MarkdownInlineStyleContext {
    return {
      applyText: (text) => this.applyDefaultStyle(text),
      stylePrefix: this.defaultStylePrefixValue(),
    };
  }

  private applyDefaultStyle(text: string): string {
    const style = this.defaultTextStyle;
    if (style === undefined) return text;
    let out = style.color?.(text) ?? text;
    if (style.bold === true) out = this.theme.bold(out);
    if (style.italic === true) out = this.theme.italic(out);
    if (style.strikethrough === true) out = this.theme.strikethrough(out);
    if (style.underline === true) out = this.theme.underline(out);
    return out;
  }

  private defaultStylePrefixValue(): string {
    if (this.defaultStylePrefix !== undefined) return this.defaultStylePrefix;
    this.defaultStylePrefix = stylePrefix((text) => this.applyDefaultStyle(text));
    return this.defaultStylePrefix;
  }

  private padLine(line: string, width: number): string {
    const clipped = visibleWidth(line) > width ? truncateToWidth(line, width, '', false) : line;
    const padded = clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
    return this.defaultTextStyle?.bgColor?.(padded) ?? padded;
  }
}

function isListLine(line: string): boolean {
  return /^(\s*)(?:[-*+]|\d+[.)])\s+/.test(line);
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? '';
  const next = lines[index + 1] ?? '';
  return line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);
}

function isSpecialBlockStart(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? '';
  return (
    /^\s*```/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^\s*>\s?/.test(line) ||
    isListLine(line) ||
    isTableStart(lines, index)
  );
}

function readPair(
  text: string,
  index: number,
  delimiter: string,
): { readonly inner: string; readonly end: number } | undefined {
  if (!text.startsWith(delimiter, index)) return undefined;
  const end = text.indexOf(delimiter, index + delimiter.length);
  if (end <= index + delimiter.length) return undefined;
  return { inner: text.slice(index + delimiter.length, end), end: end + delimiter.length };
}

function readEmphasis(
  text: string,
  index: number,
): { readonly inner: string; readonly end: number } | undefined {
  const marker = text[index];
  if (marker !== '*' && marker !== '_') return undefined;
  if (text[index + 1] === marker) return undefined;
  if (marker === '_' && isAsciiWord(text[index - 1]) && isAsciiWord(text[index + 1])) {
    return undefined;
  }
  const end = text.indexOf(marker, index + 1);
  if (end <= index + 1) return undefined;
  return { inner: text.slice(index + 1, end), end: end + 1 };
}

function isAsciiWord(char: string | undefined): boolean {
  return char !== undefined && /^[0-9A-Za-z]$/.test(char);
}

function readDelimitedInline(
  text: string,
  index: number,
  open: string,
  middle: string,
  close: string,
): { readonly inner: string; readonly extra: string; readonly end: number } | undefined {
  if (!text.startsWith(open, index)) return undefined;
  const middleIndex = text.indexOf(middle, index + open.length);
  if (middleIndex === -1) return undefined;
  const closeIndex = text.indexOf(close, middleIndex + middle.length);
  if (closeIndex === -1) return undefined;
  return {
    inner: text.slice(index + open.length, middleIndex),
    extra: text.slice(middleIndex + middle.length, closeIndex),
    end: closeIndex + close.length,
  };
}

function stylePrefix(style: (text: string) => string): string {
  const sentinel = '\u0000';
  const styled = style(sentinel);
  const index = styled.indexOf(sentinel);
  return index >= 0 ? styled.slice(0, index) : '';
}

function trimTrailingBlankLines(lines: string[]): string[] {
  while (lines.at(-1) === '') lines.pop();
  return lines;
}

function normalizeWidth(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizePadding(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
