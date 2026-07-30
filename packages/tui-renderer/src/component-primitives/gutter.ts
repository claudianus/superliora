import type { Component } from '../text-component';
import { Container } from './container';
import { normalizeLineCount, normalizeRenderWidth } from './normalize';

export type RendererGutterLinePainter = (line: string, width: number) => string;

export interface RendererGutterContainerOptions {
  readonly leftPad?: number;
  readonly rightPad?: number;
  readonly paintLine?: RendererGutterLinePainter;
  readonly isCacheEnabled?: () => boolean;
}

interface RendererGutterContainerRenderCache {
  width: number;
  childRefs: Component[];
  childRenderRefs: string[][];
  prefixed: string[][];
  out: string[];
}

export class RendererGutterContainer extends Container {
  private readonly leftPad: number;
  private readonly rightPad: number;
  private readonly paintLine: RendererGutterLinePainter | undefined;
  private readonly isCacheEnabled: () => boolean;
  private renderCache: RendererGutterContainerRenderCache | undefined;

  constructor(options: RendererGutterContainerOptions = {}) {
    super();
    this.leftPad = normalizeLineCount(options.leftPad ?? 0);
    this.rightPad = normalizeLineCount(options.rightPad ?? 0);
    this.paintLine = options.paintLine;
    this.isCacheEnabled = options.isCacheEnabled ?? (() => true);
  }

  override invalidate(): void {
    this.renderCache = undefined;
    super.invalidate();
  }

  override render(width: number): string[] {
    const safeWidth = normalizeRenderWidth(width);
    const inner = Math.max(1, safeWidth - this.leftPad - this.rightPad);
    const lead = ' '.repeat(this.leftPad);
    const cache = this.renderCache;
    const cacheValid = this.isCacheEnabled() &&
      cache !== undefined &&
      cache.width === safeWidth &&
      cache.childRefs.length === this.children.length;

    const childRefs: Component[] = [];
    const childRenderRefs: string[][] = [];
    const prefixed: string[][] = [];
    let allReused = cacheValid;

    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i]!;
      const lines = child.render(inner);
      childRefs.push(child);
      childRenderRefs.push(lines);
      const reused = cacheValid &&
        cache.childRefs[i] === child &&
        cache.childRenderRefs[i] === lines;
      if (reused) {
        prefixed.push(cache.prefixed[i]!);
      } else {
        allReused = false;
        prefixed.push(lines.map((line) => this.paintCanvasLine(lead + line, safeWidth)));
      }
    }

    const out = allReused ? cache!.out : prefixed.flat();
    if (this.isCacheEnabled()) {
      this.renderCache = { width: safeWidth, childRefs, childRenderRefs, prefixed, out };
    } else {
      this.renderCache = undefined;
    }
    return out;
  }

  private paintCanvasLine(line: string, width: number): string {
    return this.paintLine?.(line, width) ?? line;
  }
}
