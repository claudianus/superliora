import type { Component, RendererTextBackgroundFn } from '../text/component';
import { visibleWidth } from '../text/component';
import {
  isTranscriptMeasureMode,
  measurePlaceholderLines,
} from '../transcript/measure-mode';
import { normalizeLineCount, normalizeRenderWidth } from './normalize';

export class Spacer implements Component {
  constructor(private lines = 1) {}

  setLines(lines: number): void {
    this.lines = normalizeLineCount(lines);
  }

  invalidate(): void {}

  measureContentRows(_width: number): number {
    return normalizeLineCount(this.lines);
  }

  render(_width: number): string[] {
    return Array.from({ length: normalizeLineCount(this.lines) }, () => '');
  }
}

export class Box implements Component {
  children: Component[] = [];
  private cache?: {
    readonly width: number;
    readonly bgSample: string | undefined;
    readonly childLines: readonly string[];
    readonly lines: string[];
  };

  constructor(
    private readonly paddingX = 1,
    private readonly paddingY = 1,
    private bgFn?: RendererTextBackgroundFn,
  ) {}

  addChild(component: Component): void {
    this.children.push(component);
    this.invalidateCache();
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index === -1) return;
    this.children.splice(index, 1);
    this.invalidateCache();
  }

  clear(): void {
    this.children = [];
    this.invalidateCache();
  }

  setBgFn(bgFn?: RendererTextBackgroundFn): void {
    this.bgFn = bgFn;
  }

  invalidate(): void {
    this.invalidateCache();
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  measureContentRows(width: number): number {
    if (this.children.length === 0) return 0;
    const safeWidth = normalizeRenderWidth(width);
    const paddingX = normalizeLineCount(this.paddingX);
    const paddingY = normalizeLineCount(this.paddingY);
    const contentWidth = Math.max(1, safeWidth - paddingX * 2);
    let childRows = 0;
    for (const child of this.children) {
      childRows +=
        typeof child.measureContentRows === 'function'
          ? child.measureContentRows(contentWidth)
          : child.render(contentWidth).length;
    }
    if (childRows === 0) return 0;
    return childRows + paddingY * 2;
  }

  render(width: number): string[] {
    if (this.children.length === 0) return [];

    // Geometry probes: sum child row counts; never map/spread multi-k placeholders.
    if (isTranscriptMeasureMode()) {
      return measurePlaceholderLines(this.measureContentRows(width));
    }

    const safeWidth = normalizeRenderWidth(width);
    const paddingX = normalizeLineCount(this.paddingX);
    const paddingY = normalizeLineCount(this.paddingY);
    const contentWidth = Math.max(1, safeWidth - paddingX * 2);
    const leftPad = ' '.repeat(paddingX);
    const childLines = this.children.flatMap((child) =>
      child.render(contentWidth).map((line) => leftPad + line),
    );
    if (childLines.length === 0) return [];

    const bgSample = this.bgFn?.('test');
    if (this.cacheMatches(safeWidth, childLines, bgSample)) return this.cache!.lines;

    const emptyLine = this.applyBg('', safeWidth);
    const result = [
      ...Array.from({ length: paddingY }, () => emptyLine),
      ...childLines.map((line) => this.applyBg(line, safeWidth)),
      ...Array.from({ length: paddingY }, () => emptyLine),
    ];
    this.cache = { width: safeWidth, bgSample, childLines, lines: result };
    return result;
  }

  private applyBg(line: string, width: number): string {
    const padding = ' '.repeat(Math.max(0, width - visibleWidth(line)));
    const padded = line + padding;
    return this.bgFn === undefined ? padded : this.bgFn(padded);
  }

  private cacheMatches(
    width: number,
    childLines: readonly string[],
    bgSample: string | undefined,
  ): boolean {
    return (
      this.cache !== undefined &&
      this.cache.width === width &&
      this.cache.bgSample === bgSample &&
      this.cache.childLines.length === childLines.length &&
      this.cache.childLines.every((line, index) => line === childLines[index])
    );
  }

  private invalidateCache(): void {
    this.cache = undefined;
  }
}
