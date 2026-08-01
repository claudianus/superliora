import type { Component } from '../text/component';
import { shouldSkipExpensiveTranscriptFormat } from '../transcript/measure-mode';

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
  /** Pure-scroll / measure amortisation — never promoted to full paint cache. */
  private cheapCache: RendererChildrenRenderCacheSnapshot | undefined;

  clear(): void {
    this.cache = undefined;
    this.cheapCache = undefined;
  }

  render(options: RendererChildrenRenderCacheOptions): string[] {
    const width = options.width;
    const cacheEpoch = options.cacheEpoch ?? -1;
    const cacheEnabled = options.isCacheEnabled?.() ?? true;
    const cheap = shouldSkipExpensiveTranscriptFormat();

    if (cheap) {
      // Full cache is valid under scroll when already warm (preferred).
      const fullHit = tryReuseChildrenCache(this.cache, options, cacheEnabled, width, cacheEpoch);
      if (fullHit !== undefined) return fullHit;
      const cheapHit = tryReuseChildrenCache(
        this.cheapCache,
        options,
        cacheEnabled,
        width,
        cacheEpoch,
      );
      if (cheapHit !== undefined) return cheapHit;
    } else {
      const fullHit = tryReuseChildrenCache(this.cache, options, cacheEnabled, width, cacheEpoch);
      if (fullHit !== undefined) return fullHit;
    }

    const childRefs: Component[] = [];
    const childRenderRefs: Array<readonly string[]> = [];
    const projectedLines: Array<readonly string[]> = [];

    for (let i = 0; i < options.children.length; i++) {
      const child = options.children[i]!;
      const lines = options.renderChild?.(child, width, i) ?? child.render(width);
      childRefs.push(child);
      childRenderRefs.push(lines);
      projectedLines.push(options.projectChildLines?.(lines, child, width, i) ?? lines);
    }

    const out = projectedLines.flat();
    if (!cacheEnabled) {
      this.cache = undefined;
      this.cheapCache = undefined;
      return out;
    }

    const snapshot: RendererChildrenRenderCacheSnapshot = {
      width,
      cacheEpoch,
      childRefs,
      childRenderRefs,
      projectedLines,
      out,
    };
    if (cheap) {
      this.cheapCache = snapshot;
    } else {
      this.cache = snapshot;
      this.cheapCache = undefined;
    }
    return out;
  }
}

function tryReuseChildrenCache(
  cache: RendererChildrenRenderCacheSnapshot | undefined,
  options: RendererChildrenRenderCacheOptions,
  cacheEnabled: boolean,
  width: number,
  cacheEpoch: number,
): string[] | undefined {
  if (
    !cacheEnabled ||
    cache === undefined ||
    cache.width !== width ||
    cache.cacheEpoch !== cacheEpoch ||
    cache.childRefs.length !== options.children.length
  ) {
    return undefined;
  }

  // Must re-render children to detect identity/array-ref changes; if all
  // children return the same line array refs as the snapshot, reuse flat out.
  const projectedLines: Array<readonly string[]> = [];
  for (let i = 0; i < options.children.length; i++) {
    const child = options.children[i]!;
    if (cache.childRefs[i] !== child) return undefined;
    const lines = options.renderChild?.(child, width, i) ?? child.render(width);
    if (cache.childRenderRefs[i] !== lines) return undefined;
    projectedLines.push(cache.projectedLines[i]!);
  }
  return cache.out;
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
  /** Pure-scroll amortisation slot (plain/cheap layout only). */
  private cheapCache: RendererWidthRenderCacheSnapshot | undefined;

  clear(): void {
    this.cache = undefined;
    this.cheapCache = undefined;
  }

  render(options: RendererWidthRenderCacheOptions): string[] {
    const cacheEnabled = options.isCacheEnabled?.() ?? true;
    const cacheEpoch = options.cacheEpoch ?? -1;
    const cheap = shouldSkipExpensiveTranscriptFormat();

    if (cacheEnabled) {
      if (
        this.cache !== undefined &&
        this.cache.width === options.width &&
        this.cache.cacheEpoch === cacheEpoch
      ) {
        // Full cache is always usable (including under pure scroll).
        return this.cache.out;
      }
      if (
        cheap &&
        this.cheapCache !== undefined &&
        this.cheapCache.width === options.width &&
        this.cheapCache.cacheEpoch === cacheEpoch
      ) {
        return this.cheapCache.out;
      }
    }

    const out = options.render(options.width);
    if (!cacheEnabled) {
      this.cache = undefined;
      this.cheapCache = undefined;
      return out;
    }

    if (cheap) {
      this.cheapCache = { width: options.width, cacheEpoch, out };
    } else {
      this.cache = { width: options.width, cacheEpoch, out };
      this.cheapCache = undefined;
    }
    return out;
  }
}
