import type { RendererCell, RendererFrameRegion } from '#/tui/renderer';
import type { StageFrameBand } from '#/tui/utils/stage-frame';
import {
  bandContains,
  skyCellKey,
  type StageLetterboxSkyCell,
} from '#/tui/utils/stage-letterbox-sky-geometry';

/** Intern sky cell styles so compose/diff hit pointer-equal styles. */
const skyStyleCache = new Map<string, { char: string; style: NonNullable<RendererCell['style']> }>();

function skyRendererCell(
  char: string,
  fg: string,
  canvasBg: string | undefined,
  bold: boolean | undefined,
): RendererCell {
  const key = `${char}\0${fg}\0${canvasBg ?? ''}\0${bold === true ? '1' : '0'}`;
  const hit = skyStyleCache.get(key);
  if (hit !== undefined) return hit;
  const style: NonNullable<RendererCell['style']> = {
    fg,
    ...(canvasBg !== undefined ? { bg: canvasBg } : {}),
    ...(bold === true ? { bold: true } : {}),
  };
  const cell = { char, style };
  skyStyleCache.set(key, cell);
  if (skyStyleCache.size > 512) {
    // Bound growth — drop oldest half when the intern map gets large.
    let drop = Math.floor(skyStyleCache.size / 2);
    for (const k of skyStyleCache.keys()) {
      skyStyleCache.delete(k);
      if (--drop <= 0) break;
    }
  }
  return cell;
}

type LetterboxRegionCache = {
  readonly signature: string;
  readonly emptyCell: RendererCell;
  readonly linesByBand: RendererCell[][][];
  readonly prevSkyByBand: number[][];
};

let letterboxRegionCache: LetterboxRegionCache | undefined;

/** Test helper — drop persistent letterbox region buffers. */
export function resetLetterboxSkyRegionCacheForTests(): void {
  letterboxRegionCache = undefined;
  skyStyleCache.clear();
}

/** Attach sky cell content onto letterbox band regions (absolute → local). */
export function applySkyToLetterboxRegions(
  bands: readonly StageFrameBand[],
  sky: readonly StageLetterboxSkyCell[],
  canvasBg: string | undefined,
): readonly RendererFrameRegion[] {
  const signature =
    bands.map((b) => `${b.x},${b.y},${b.width},${b.height}`).join('|') +
    `#${canvasBg ?? ''}`;
  const emptyCell: RendererCell =
    canvasBg === undefined
      ? { char: ' ' }
      : { char: ' ', style: { bg: canvasBg } };

  let cache = letterboxRegionCache;
  if (cache === undefined || cache.signature !== signature) {
    const linesByBand = bands.map((band) =>
      Array.from({ length: band.height }, () =>
        Array.from({ length: band.width }, () => emptyCell),
      ),
    );
    cache = {
      signature,
      emptyCell,
      linesByBand,
      prevSkyByBand: bands.map(() => []),
    };
    letterboxRegionCache = cache;
  }

  const byBand: StageLetterboxSkyCell[][] = bands.map(() => []);
  for (const cell of sky) {
    for (let i = 0; i < bands.length; i++) {
      if (bandContains(bands[i]!, cell.x, cell.y)) {
        byBand[i]!.push(cell);
        break;
      }
    }
  }

  return bands.map((band, i) => {
    const lines = cache.linesByBand[i]!;
    // Restore bg under last sky scatter (avoids full-band Array.from each tick).
    // Create a fresh row reference on mutation so the compositor's lineKey
    // WeakMap (keyed by array identity) recomputes the row key and the
    // composition cache does not skip the changed row.
    for (const packed of cache.prevSkyByBand[i]!) {
      const lx = packed & 0xffff;
      const ly = (packed >>> 16) & 0xffff;
      const row = lines[ly];
      if (row !== undefined && lx < row.length) {
        const copy = [...row];
        copy[lx] = cache.emptyCell;
        lines[ly] = copy;
      }
    }
    const nextKeys: number[] = [];
    for (const cell of byBand[i]!) {
      const lx = cell.x - band.x;
      const ly = cell.y - band.y;
      if (ly < 0 || ly >= band.height || lx < 0 || lx >= band.width) continue;
      const row = lines[ly]!;
      const copy = [...row];
      copy[lx] = skyRendererCell(cell.char, cell.fg, canvasBg, cell.bold);
      lines[ly] = copy;
      nextKeys.push(skyCellKey(lx, ly));
    }
    cache.prevSkyByBand[i] = nextKeys;
    return {
      id: `stageFrameLetterbox:${i}`,
      rect: band,
      content: lines,
      clear: false,
      ...(canvasBg !== undefined
        ? { background: { char: ' ' as const, style: { bg: canvasBg } } }
        : {}),
      zIndex: 4,
    };
  });
}
