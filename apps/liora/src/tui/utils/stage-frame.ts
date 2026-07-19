import type { AppearancePreferences } from '#/tui/config';
import { mixHexColor, type RendererCell, type RendererFrameRegion } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';
import { isTUIInputInteractionActive } from '#/tui/utils/input-interaction';
import {
  applySkyToLetterboxRegions,
  paintStageLetterboxSky,
} from '#/tui/utils/stage-letterbox-sky';

/** Cells between bundle edge and the stroke ring. */
export const STAGE_FRAME_GAP = 1;
/** Full box needs gap + stroke outside the bundle on every side. */
export const STAGE_FRAME_MARGIN = STAGE_FRAME_GAP + 1;
export const STAGE_FRAME_ENTRANCE_MS = 360;
/** Quiet chase — slower than Ultrawork editor (~24 cells/s). */
export const STAGE_FRAME_CHASE_MS_PER_CELL = 95;
export const STAGE_FRAME_TRAIL_LEN = 10;

/** @deprecated Corner-arm API removed; full box only. */
export const STAGE_FRAME_ARM_TARGET = 0;
/** @deprecated */
export const STAGE_FRAME_ARM_MIN = 0;
/** @deprecated */
export const STAGE_FRAME_BLOOM = 0;
/** @deprecated */
export const STAGE_FRAME_BREATHE_MS = 0;

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

export function noteStageFrameBundle(bundleKey: string, nowMs: number): void {
  if (bundleKey === entranceBundleKey) return;
  entranceBundleKey = bundleKey;
  entranceStartedAtMs = nowMs;
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

/** @deprecated Full box has no arms — returns 1 when progress > 0. */
export function stageFrameEntranceArmLength(_fullArm: number, progress: number): number {
  return progress <= 0 ? 0 : 1;
}

/** @deprecated */
export function stageFrameArmLength(_bundle: StageFrameBand): number {
  return 0;
}

/** @deprecated */
export function stageFrameBreathePhase(_nowMs: number): number {
  return 0;
}

/** Outer centered bundle: stage alone, or stage+gap+rail. */
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
  readonly kind: 'stroke';
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

/** Letterbox band rects outside the frame ring (theme canvas fill). */
export function stageFrameLetterboxBands(
  bundle: StageFrameBand,
  cols: number,
  rows: number,
): readonly StageFrameBand[] {
  const left = bundle.x - STAGE_FRAME_GAP;
  const right = bundle.x + bundle.width + STAGE_FRAME_GAP - 1;
  const top = bundle.y - STAGE_FRAME_GAP;
  const bottom = bundle.y + bundle.height + STAGE_FRAME_GAP - 1;
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

/** @deprecated Prefer {@link stageFrameLetterboxBands} for paint cost. */
export function stageFrameLetterboxCells(
  bundle: StageFrameBand,
  cols: number,
  rows: number,
  bg: string | undefined,
): readonly StageFramePaintCell[] {
  if (bg === undefined) return [];
  const out: StageFramePaintCell[] = [];
  for (const band of stageFrameLetterboxBands(bundle, cols, rows)) {
    for (let y = band.y; y < band.y + band.height; y++) {
      for (let x = band.x; x < band.x + band.width; x++) {
        out.push({ x, y, char: ' ', fg: bg, bg });
      }
    }
  }
  return out;
}

export function paintStageFrameCells(input: {
  readonly bundle: StageFrameBand;
  readonly cols: number;
  readonly rows: number;
  readonly nowMs: number;
  readonly appearance: AppearancePreferences;
  /** Freeze chase (typing / decorative skip). */
  readonly freezeChase?: boolean;
}): readonly StageFramePaintCell[] {
  if (!stageFrameVisible(input.bundle, input.cols, input.rows)) return [];

  const key = stageFrameBundleKey(input.bundle);
  noteStageFrameBundle(key, input.nowMs);

  const mode = resolveQualityAdjustedAmbientEffectMode(input.appearance);
  const ambientOff = !motionEffectsAllowed() || mode === 'off';
  const progress = stageFrameEntranceProgress(
    stageFrameEntranceStartedAtMs(),
    input.nowMs,
    ambientOff,
  );
  if (progress <= 0) return [];

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
  const fadeTarget = canvasBg ?? currentTheme.color('surfaceSunken');
  const dim = mixHexColor(fadeTarget, base, Math.min(1, 0.25 + progress * 0.75));

  const freeze =
    ambientOff || input.freezeChase === true || isTUIInputInteractionActive(input.nowMs);
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
  const canvas = currentTheme.canvasBackgroundCell();
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
    regions.push(...applySkyToLetterboxRegions(bands, sky, canvas?.style.bg));
  }

  const painted = paintStageFrameCells(input);
  if (painted.length === 0) return regions;

  const left = input.bundle.x - STAGE_FRAME_GAP;
  const top = input.bundle.y - STAGE_FRAME_GAP;
  const right = input.bundle.x + input.bundle.width + STAGE_FRAME_GAP - 1;
  const bottom = input.bundle.y + input.bundle.height + STAGE_FRAME_GAP - 1;
  const boxW = right - left + 1;
  const boxH = bottom - top + 1;
  const lines: RendererCell[][] = Array.from({ length: boxH }, () => []);
  for (const cell of painted) {
    const lx = cell.x - left;
    const ly = cell.y - top;
    if (ly < 0 || ly >= boxH || lx < 0 || lx >= boxW) continue;
    lines[ly]![lx] = {
      char: cell.char,
      style: {
        fg: cell.fg,
        ...(cell.bg !== undefined ? { bg: cell.bg } : {}),
        ...(cell.bold ? { bold: true } : {}),
      },
    };
  }
  regions.push({
    id: 'stageFrame',
    rect: { x: left, y: top, width: boxW, height: boxH },
    content: lines,
    clear: false,
    zIndex: 5,
  });
  return regions;
}

/** @deprecated Prefer {@link createStageFrameOverlayRegions}. */
export function createStageFrameOverlayRegion(input: {
  readonly bundle: StageFrameBand;
  readonly cols: number;
  readonly rows: number;
  readonly nowMs: number;
  readonly appearance: AppearancePreferences;
  readonly freezeChase?: boolean;
}): RendererFrameRegion | undefined {
  const regions = createStageFrameOverlayRegions(input);
  return regions.find((r) => r.id === 'stageFrame');
}
