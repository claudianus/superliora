import type { Component } from './text-component';

export interface RendererChildrenRenderCacheOptions {
  readonly width: number;
  readonly children: readonly Component[];
  readonly isCacheEnabled?: () => boolean;
  readonly cacheEpoch?: number;
  readonly renderChild?: (
    child: Component,
    width: number,
    index: number,
  ) => readonly string[];
  readonly projectChildLines?: (
    lines: readonly string[],
    child: Component,
    width: number,
    index: number,
  ) => readonly string[];
}

interface RendererChildrenRenderCacheSnapshot {
  width: number;
  cacheEpoch: number;
  childRefs: Component[];
  childRenderRefs: ReadonlyArray<readonly string[]>;
  projectedLines: ReadonlyArray<readonly string[]>;
  out: string[];
}

export class RendererChildrenRenderCache {
  private cache: RendererChildrenRenderCacheSnapshot | undefined;

  clear(): void {
    this.cache = undefined;
  }

  render(options: RendererChildrenRenderCacheOptions): string[] {
    const width = options.width;
    const cacheEpoch = options.cacheEpoch ?? -1;
    const cacheEnabled = options.isCacheEnabled?.() ?? true;
    const cache = this.cache;
    const cacheValid = cacheEnabled &&
      cache !== undefined &&
      cache.width === width &&
      cache.cacheEpoch === cacheEpoch &&
      cache.childRefs.length === options.children.length;

    const childRefs: Component[] = [];
    const childRenderRefs: Array<readonly string[]> = [];
    const projectedLines: Array<readonly string[]> = [];
    let allReused = cacheValid;

    for (let i = 0; i < options.children.length; i++) {
      const child = options.children[i]!;
      const lines = options.renderChild?.(child, width, i) ?? child.render(width);
      childRefs.push(child);
      childRenderRefs.push(lines);
      const reused = cacheValid &&
        cache.childRefs[i] === child &&
        cache.childRenderRefs[i] === lines;
      if (reused) {
        projectedLines.push(cache.projectedLines[i]!);
      } else {
        allReused = false;
        projectedLines.push(options.projectChildLines?.(lines, child, width, i) ?? lines);
      }
    }

    const out = allReused ? cache!.out : projectedLines.flat();
    if (cacheEnabled) {
      this.cache = { width, cacheEpoch, childRefs, childRenderRefs, projectedLines, out };
    } else {
      this.cache = undefined;
    }
    return out;
  }
}

export interface RendererWidthRenderCacheOptions {
  readonly width: number;
  readonly isCacheEnabled?: () => boolean;
  readonly cacheEpoch?: number;
  readonly render: (width: number) => string[];
}

interface RendererWidthRenderCacheSnapshot {
  width: number;
  cacheEpoch: number;
  out: string[];
}

export class RendererWidthRenderCache {
  private cache: RendererWidthRenderCacheSnapshot | undefined;

  clear(): void {
    this.cache = undefined;
  }

  render(options: RendererWidthRenderCacheOptions): string[] {
    const cacheEnabled = options.isCacheEnabled?.() ?? true;
    const cacheEpoch = options.cacheEpoch ?? -1;
    if (
      cacheEnabled &&
      this.cache !== undefined &&
      this.cache.width === options.width &&
      this.cache.cacheEpoch === cacheEpoch
    ) {
      return this.cache.out;
    }

    const out = options.render(options.width);
    if (cacheEnabled) {
      this.cache = { width: options.width, cacheEpoch, out };
    } else {
      this.cache = undefined;
    }
    return out;
  }
}
