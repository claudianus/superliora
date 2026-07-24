import type { AppearancePreferences } from '#/tui/config';
import { mixHexColor, type RendererCell, type RendererFrameRegion } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';
import {
  applySkyToLetterboxRegions,
  paintStageLetterboxSky,
} from '#/tui/utils/stage-letterbox-sky';

/** Cells between bundle edge and the stroke ring. */
export const STAGE_FRAME_GAP = 1;
/** Outer dim halo cells beyond the stroke ring. */
export const STAGE_FRAME_HALO = 1;
/** Full box needs gap + stroke + halo outside the bundle on every side. */
export const STAGE_FRAME_MARGIN = STAGE_FRAME_GAP + 1 + STAGE_FRAME_HALO;
export const STAGE_FRAME_ENTRANCE_MS = 360;
/** Quiet chase — slower than Ultrawork editor (~24 cells/s). */
export const STAGE_FRAME_CHASE_MS_PER_CELL = 95;
export const STAGE_FRAME_TRAIL_LEN = 10;

export interface StageFrameBand {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StageFramePaintCell {
  readonly x: number;
  readonly y: number;
  readonly char: string;
  readonly fg: string;
  readonly bg?: string;
  readonly bold?: boolean;
}

let entranceBundleKey: string | undefined;
let entranceStartedAtMs = 0;

export function stageFrameBundleKey(bundle: StageFrameBand): string {
  return `${bundle.x},${bundle.y},${bundle.width},${bundle.height}`;
}

/**
 * Track the visible stage bundle that drives the entrance animation.
 *
 * - `null` marks a hidden frame — the next appearance replays the entrance.
 * - The first appearance starts the entrance at `nowMs`.
 * - Geometry changes while the frame stays visible (resize drags, inline
 *   frame growth shifting the centered band) keep the running progress.
 *   Restarting on every drift tick left the rim perpetually half-drawn and
 *   kept the chase highlight from ever starting.
 */
export function noteStageFrameBundle(bundleKey: string | null, nowMs: number): void {
  if (bundleKey === null) {
    entranceBundleKey = undefined;
    entranceStartedAtMs = 0;
    return;
  }
  if (bundleKey === entranceBundleKey) return;
  const wasVisible = entranceBundleKey !== undefined;
  entranceBundleKey = bundleKey;
  if (!wasVisible) entranceStartedAtMs = nowMs;
}

export function stageFrameEntranceStartedAtMs(): number {
  return entranceStartedAtMs;
}

export function resetStageFrameEntranceForTests(): void {
  entranceBundleKey = undefined;
  entranceStartedAtMs = 0;
}

/** Ease-out cubic; snaps to 1 when ambient is off. */
export function stageFrameEntranceProgress(
  startedAtMs: number,
  nowMs: number,
  ambientOff: boolean,
): number {
  if (ambientOff) return 1;
  const span = STAGE_FRAME_ENTRANCE_MS;
  if (span <= 0) return 1;
  const t = Math.min(1, Math.max(0, (nowMs - startedAtMs) / span));
  return 1 - (1 - t) ** 3;
}

/** Outer centered bundle rect for the stage frame. */
export function stageFrameBundleRect(layout: {
  readonly stage: StageFrameBand;
  readonly bundleWidth: number;
  readonly bundleHeight: number;
}): StageFrameBand {
  return {
    x: layout.stage.x,
    y: layout.stage.y,
    width: layout.bundleWidth,
    height: layout.bundleHeight,
  };
}

export function stageFrameVisible(bundle: StageFrameBand, cols: number, rows: number): boolean {
  if (bundle.width <= 0 || bundle.height <= 0) return false;
  const right = cols - (bundle.x + bundle.width);
  const bottom = rows - (bundle.y + bundle.height);
  return (
    bundle.x >= STAGE_FRAME_MARGIN &&
    right >= STAGE_FRAME_MARGIN &&
    bundle.y >= STAGE_FRAME_MARGIN &&
    bottom >= STAGE_FRAME_MARGIN
  );
}

export interface StageFrameStrokeCell {
  readonly x: number;
  readonly y: number;
  readonly char: string;
  readonly kind: 'stroke' | 'halo';
  readonly corner: boolean;
}

const CORNER_CHARS = new Set(['╭', '╮', '╰', '╯']);

/**
 * Closed rounded rectangle around the bundle, clockwise from top-left.
 * Path order is used for the chase highlight.
 */
export function stageFrameStrokeCells(bundle: StageFrameBand): readonly StageFrameStrokeCell[] {
  const left = bundle.x - STAGE_FRAME_GAP;
  const right = bundle.x + bundle.width + STAGE_FRAME_GAP - 1;
  const top = bundle.y - STAGE_FRAME_GAP;
  const bottom = bundle.y + bundle.height + STAGE_FRAME_GAP - 1;
  if (right <= left || bottom <= top) return [];

  const out: StageFrameStrokeCell[] = [];
  const push = (x: number, y: number, char: string) => {
    out.push({ x, y, char, kind: 'stroke', corner: CORNER_CHARS.has(char) });
  };

  push(left, top, '╭');
  for (let x = left + 1; x < right; x++) push(x, top, '─');
  push(right, top, '╮');
  for (let y = top + 1; y < bottom; y++) push(right, y, '│');
  push(right, bottom, '╯');
  for (let x = right - 1; x > left; x--) push(x, bottom, '─');
  push(left, bottom, '╰');
  for (let y = bottom - 1; y > top; y--) push(left, y, '│');

  return out;
}

/**
 * Soft outer ring one cell beyond the stroke — depth cue against letterbox.
 * Not part of the chase path.
 */
export function stageFrameHaloCells(bundle: StageFrameBand): readonly StageFrameStrokeCell[] {
  if (STAGE_FRAME_HALO <= 0) return [];
  const left = bundle.x - STAGE_FRAME_GAP - STAGE_FRAME_HALO;
  const right = bundle.x + bundle.width + STAGE_FRAME_GAP - 1 + STAGE_FRAME_HALO;
  const top = bundle.y - STAGE_FRAME_GAP - STAGE_FRAME_HALO;
  const bottom = bundle.y + bundle.height + STAGE_FRAME_GAP - 1 + STAGE_FRAME_HALO;
  if (right <= left || bottom <= top) return [];

  const out: StageFrameStrokeCell[] = [];
  const push = (x: number, y: number, char: string) => {
    out.push({ x, y, char, kind: 'halo', corner: CORNER_CHARS.has(char) });
  };

  push(left, top, '╭');
  for (let x = left + 1; x < right; x++) push(x, top, '─');
  push(right, top, '╮');
  for (let y = top + 1; y < bottom; y++) push(right, y, '│');
  push(right, bottom, '╯');
  for (let x = right - 1; x > left; x--) push(x, bottom, '─');
  push(left, bottom, '╰');
  for (let y = bottom - 1; y > top; y--) push(left, y, '│');

  return out;
}

/** Letterbox fill one step darker than the stage canvas (theme tones only). */
export function resolveLetterboxCanvasBg(): string | undefined {
  const canvasBg = currentTheme.canvasBackgroundCell()?.style.bg;
  if (canvasBg === undefined) return undefined;
  const sunken = currentTheme.color('surfaceSunken');
  return mixHexColor(canvasBg, sunken, 0.32);
}

function positiveModulo(n: number, m: number): number {
  if (m <= 0) return 0;
  return ((n % m) + m) % m;
}

function chaseFgForTrailStep(
  step: number,
  trailLen: number,
  head: string,
  mid: string,
  soft: string,
  dim: string,
): string {
  const t = step / Math.max(1, trailLen);
  if (t < 0.1) return head;
  if (t < 0.35) return mid;
  if (t < 0.7) return soft;
  return dim;
}

/** Letterbox band rects outside the frame ring + outer halo (theme canvas fill). */
export function stageFrameLetterboxBands(
  bundle: StageFrameBand,
  cols: number,
  rows: number,
): readonly StageFrameBand[] {
  // Stay outside halo (GAP+HALO), not just the stroke. Overlapping halo made
  // ambient letterbox clear:true wipe the full-width halo row every tick.
  const inset = STAGE_FRAME_GAP + STAGE_FRAME_HALO;
  const left = bundle.x - inset;
  const right = bundle.x + bundle.width + inset - 1;
  const top = bundle.y - inset;
  const bottom = bundle.y + bundle.height + inset - 1;
  const bands: StageFrameBand[] = [];
  if (top > 0) bands.push({ x: 0, y: 0, width: cols, height: top });
  if (bottom + 1 < rows) {
    bands.push({ x: 0, y: bottom + 1, width: cols, height: rows - (bottom + 1) });
  }
  const midH = bottom - top + 1;
  if (midH > 0 && left > 0) bands.push({ x: 0, y: top, width: left, height: midH });
  if (midH > 0 && right + 1 < cols) {
    bands.push({ x: right + 1, y: top, width: cols - (right + 1), height: midH });
  }
  return bands.filter((b) => b.width > 0 && b.height > 0);
}

export function paintStageFrameCells(input: {
  readonly bundle: StageFrameBand;
  readonly cols: number;
  readonly rows: number;
  readonly nowMs: number;
  readonly appearance: AppearancePreferences;
  /** Freeze chase (ambient off / explicit freeze only — not typing holdoff). */
  readonly freezeChase?: boolean;
}): readonly StageFramePaintCell[] {
  const key = stageFrameVisible(input.bundle, input.cols, input.rows)
    ? stageFrameBundleKey(input.bundle)
    : null;
  noteStageFrameBundle(key, input.nowMs);
  if (key === null) return [];

  const mode = resolveQualityAdjustedAmbientEffectMode(input.appearance);
  const ambientOff = !motionEffectsAllowed() || mode === 'off';
  // First visible tick has progress 0 (startedAt === nowMs). Still paint —
  // snapping away made the ring missing for a frame and fought damage-only
  // presents (underlay flashed through as black bands).
  const progress = stageFrameEntranceProgress(
    stageFrameEntranceStartedAtMs(),
    input.nowMs,
    ambientOff,
  );

  const path = stageFrameStrokeCells(input.bundle);
  if (path.length === 0) return [];

  const canvasCell = currentTheme.canvasBackgroundCell();
  const canvasBg = canvasCell?.style.bg;
  const border = currentTheme.color('border');
  const primary = currentTheme.color('primary');
  const glow = currentTheme.color('glow');
  // Visible base — never crush into the panel fill.
  const base = mixHexColor(border, primary, 0.35);
  const head = mixHexColor(glow, primary, mode === 'premium' ? 0.35 : 0.55);
  const mid = mixHexColor(head, base, 0.28);
  const soft = mixHexColor(head, base, 0.55);
  // Entrance fades the whole ring in from canvas/background toward base.
  // The old formula (0.25 + progress * 0.75) capped at 50/50 blend with the
  // background at full progress, making the stroke nearly invisible on dark
  // themes.  Bias heavily toward `base` so the ring reads as a clear border.
  const fadeTarget = canvasBg ?? currentTheme.color('surfaceSunken');
  const dim = mixHexColor(fadeTarget, base, Math.min(1, 0.55 + progress * 0.45));
  const letterboxBg = resolveLetterboxCanvasBg() ?? fadeTarget;
  // Halo must also stay visible — the old 0.2+progress*0.35 maxed at 55% dim
  // which crushed the outer glow into the letterbox fill.
  const haloFg = mixHexColor(letterboxBg, dim, Math.min(1, 0.45 + progress * 0.55));

  // Typing holdoff must not freeze the stage chase — only explicit freezeChase / ambient off.
  const freeze = ambientOff || input.freezeChase === true;
  const trailLen = Math.min(
    STAGE_FRAME_TRAIL_LEN,
    Math.max(4, Math.floor(path.length / 8)),
  );
  const headIndex =
    freeze || path.length === 0
      ? -1
      : positiveModulo(Math.floor(input.nowMs / STAGE_FRAME_CHASE_MS_PER_CELL), path.length);

  const strokeFg = new Map<string, { fg: string; bold: boolean }>();
  for (const cell of path) {
    strokeFg.set(`${cell.x},${cell.y}`, { fg: dim, bold: false });
  }
  if (!freeze && headIndex >= 0 && progress >= 0.85) {
    for (let step = 0; step <= trailLen; step++) {
      const idx = positiveModulo(headIndex - step, path.length);
      const cell = path[idx]!;
      const fg = chaseFgForTrailStep(step, trailLen, head, mid, soft, dim);
      const t = step / Math.max(1, trailLen);
      strokeFg.set(`${cell.x},${cell.y}`, { fg, bold: t < 0.28 && mode === 'premium' });
    }
  }

  const out: StageFramePaintCell[] = [];
  const onScreen = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < input.cols && y < input.rows;

  for (const cell of stageFrameHaloCells(input.bundle)) {
    if (!onScreen(cell.x, cell.y)) continue;
    out.push({
      x: cell.x,
      y: cell.y,
      char: cell.char,
      fg: haloFg,
      bg: letterboxBg,
    });
  }

  for (const cell of path) {
    if (!onScreen(cell.x, cell.y)) continue;
    const style = strokeFg.get(`${cell.x},${cell.y}`) ?? { fg: dim, bold: false };
    out.push({
      x: cell.x,
      y: cell.y,
      char: cell.char,
      fg: style.fg,
      ...(canvasBg !== undefined ? { bg: canvasBg } : {}),
      ...(style.bold ? { bold: true } : {}),
    });
  }

  return out;
}

export function createStageFrameOverlayRegions(input: {
  readonly bundle: StageFrameBand;
  readonly cols: number;
  readonly rows: number;
  readonly nowMs: number;
  readonly appearance: AppearancePreferences;
  readonly freezeChase?: boolean;
}): readonly RendererFrameRegion[] {
  if (!stageFrameVisible(input.bundle, input.cols, input.rows)) return [];

  const regions: RendererFrameRegion[] = [];
  const letterboxBg = resolveLetterboxCanvasBg();
  const bands = stageFrameLetterboxBands(input.bundle, input.cols, input.rows);
  const sky = paintStageLetterboxSky({
    bands,
    cols: input.cols,
    rows: input.rows,
    nowMs: input.nowMs,
    appearance: input.appearance,
    freeze: input.freezeChase === true,
  });
  if (bands.length > 0) {
    regions.push(...applySkyToLetterboxRegions(bands, sky, letterboxBg));
  }

  const painted = paintStageFrameCells(input);
  if (painted.length === 0) return regions;

  const left = input.bundle.x - STAGE_FRAME_GAP - STAGE_FRAME_HALO;
  const top = input.bundle.y - STAGE_FRAME_GAP - STAGE_FRAME_HALO;
  const right = input.bundle.x + input.bundle.width + STAGE_FRAME_GAP - 1 + STAGE_FRAME_HALO;
  const bottom = input.bundle.y + input.bundle.height + STAGE_FRAME_GAP - 1 + STAGE_FRAME_HALO;
  const boxW = right - left + 1;
  const boxH = bottom - top + 1;
  const ring = STAGE_FRAME_GAP + STAGE_FRAME_HALO;
  // Rim-only bands — never a sparse full-stage rect. A clear:true fill of the
  // old full rect left the interior as unstyled EMPTY (terminal-default black).
  const rimBands: StageFrameBand[] = [
    { x: left, y: top, width: boxW, height: ring },
    { x: left, y: bottom - ring + 1, width: boxW, height: ring },
    { x: left, y: top + ring, width: ring, height: Math.max(0, boxH - 2 * ring) },
    {
      x: right - ring + 1,
      y: top + ring,
      width: ring,
      height: Math.max(0, boxH - 2 * ring),
    },
  ].filter((b) => b.width > 0 && b.height > 0);

  const rimBg = letterboxBg ?? currentTheme.color('surfaceSunken');
  const emptyRim: RendererCell = { char: ' ', style: { bg: rimBg } };
  const rimCacheSig =
    rimBands.map((b) => `${b.x},${b.y},${b.width},${b.height}`).join('|') + `#${rimBg}`;

  for (let i = 0; i < rimBands.length; i++) {
    const band = rimBands[i]!;
    const lines = takeRimBandLines(band, emptyRim, i, rimCacheSig);
    // Clear previous chase scatter before writing this frame's painted cells.
    clearRimBandScatter(i, lines, emptyRim);
    for (const cell of painted) {
      const lx = cell.x - band.x;
      const ly = cell.y - band.y;
      if (ly < 0 || ly >= band.height || lx < 0 || lx >= band.width) continue;
      // Fresh row reference so the compositor lineKey WeakMap recomputes.
      const row = [...lines[ly]!];
      row[lx] = rimCell(cell.char, cell.fg, cell.bg ?? rimBg, cell.bold);
      lines[ly] = row;
      noteRimBandScatter(i, lx, ly);
    }
    regions.push({
      id: `stageFrame:${i}`,
      rect: band,
      content: lines,
      clear: false,
      background: emptyRim,
      zIndex: 5,
    });
  }
  return regions;
}

type RimRegionCache = {
  signature: string;
  linesByBand: RendererCell[][][];
  prevByBand: number[][];
};

let rimRegionCache: RimRegionCache | undefined;
const rimStyleCache = new Map<string, RendererCell>();

function rimCell(char: string, fg: string, bg: string, bold: boolean | undefined): RendererCell {
  const key = `${char}\0${fg}\0${bg}\0${bold === true ? '1' : '0'}`;
  const hit = rimStyleCache.get(key);
  if (hit !== undefined) return hit;
  const cell: RendererCell = {
    char,
    style: { fg, bg, ...(bold === true ? { bold: true } : {}) },
  };
  rimStyleCache.set(key, cell);
  if (rimStyleCache.size > 256) {
    let drop = Math.floor(rimStyleCache.size / 2);
    for (const k of rimStyleCache.keys()) {
      rimStyleCache.delete(k);
      if (--drop <= 0) break;
    }
  }
  return cell;
}

function takeRimBandLines(
  band: StageFrameBand,
  emptyRim: RendererCell,
  index: number,
  signature: string,
): RendererCell[][] {
  if (rimRegionCache === undefined || rimRegionCache.signature !== signature) {
    rimRegionCache = {
      signature,
      linesByBand: [],
      prevByBand: [],
    };
  }
  while (rimRegionCache.linesByBand.length <= index) {
    rimRegionCache.linesByBand.push([]);
    rimRegionCache.prevByBand.push([]);
  }
  const existing = rimRegionCache.linesByBand[index]!;
  if (
    existing.length === band.height &&
    (existing.length === 0 || existing[0]!.length === band.width)
  ) {
    return existing;
  }
  const lines = Array.from({ length: band.height }, () =>
    Array.from({ length: band.width }, () => emptyRim),
  );
  rimRegionCache.linesByBand[index] = lines;
  rimRegionCache.prevByBand[index] = [];
  return lines;
}

function clearRimBandScatter(
  index: number,
  lines: RendererCell[][],
  emptyRim: RendererCell,
): void {
  const prev = rimRegionCache?.prevByBand[index];
  if (prev === undefined) return;
  for (const packed of prev) {
    const lx = packed & 0xffff;
    const ly = (packed >>> 16) & 0xffff;
    const row = lines[ly];
    if (row !== undefined && lx < row.length) {
      // Fresh row reference so the compositor lineKey WeakMap recomputes.
      const copy = [...row];
      copy[lx] = emptyRim;
      lines[ly] = copy;
    }
  }
  prev.length = 0;
}

function noteRimBandScatter(index: number, lx: number, ly: number): void {
  rimRegionCache?.prevByBand[index]?.push(((ly & 0xffff) << 16) | (lx & 0xffff));
}


