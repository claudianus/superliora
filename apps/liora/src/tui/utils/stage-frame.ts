import type { AppearancePreferences } from '#/tui/config';
import { mixHexColor, type RendererCell, type RendererFrameRegion } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';
import { isTUIInputInteractionActive } from '#/tui/utils/input-interaction';

/** Cells between bundle edge and the stroke ring. */
export const STAGE_FRAME_GAP = 2;
/** Stroke ring needs gap + 1 cell outside the bundle on every side. */
export const STAGE_FRAME_MARGIN = STAGE_FRAME_GAP + 1;
/** Short L arms — long rails + bloom read as a noisy second box. */
export const STAGE_FRAME_ARM_TARGET = 3;
export const STAGE_FRAME_ARM_MIN = 2;
export const STAGE_FRAME_ENTRANCE_MS = 280;
/** Slow corner luminance breathe (ms per full cycle). */
export const STAGE_FRAME_BREATHE_MS = 2600;

/** @deprecated Kept for test/import compatibility; bloom removed. */
export const STAGE_FRAME_BLOOM = 0;
/** @deprecated Chase removed; corner breathe only. */
export const STAGE_FRAME_CHASE_MS_PER_CELL = STAGE_FRAME_BREATHE_MS;
/** @deprecated Chase removed. */
export const STAGE_FRAME_TRAIL_LEN = 0;

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

export function stageFrameEntranceArmLength(fullArm: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  if (p <= 0) return 0;
  if (p >= 1) return Math.max(0, Math.floor(fullArm));
  return Math.max(0, Math.round(fullArm * p));
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

export function stageFrameArmLength(bundle: StageFrameBand): number {
  const fit = (side: number): number => {
    // two arms + ≥2 empty cells between tips
    if (STAGE_FRAME_ARM_TARGET * 2 + 2 <= side) return STAGE_FRAME_ARM_TARGET;
    if (STAGE_FRAME_ARM_MIN * 2 + 2 <= side) return STAGE_FRAME_ARM_MIN;
    return Math.max(1, Math.floor((side - 2) / 2));
  };
  return Math.min(fit(bundle.width), fit(bundle.height));
}

export interface StageFrameStrokeCell {
  readonly x: number;
  readonly y: number;
  readonly char: string;
  /** Always stroke — bloom removed for visual clarity. */
  readonly kind: 'stroke';
  readonly corner: boolean;
}

const CORNER_CHARS = new Set(['╭', '╮', '╰', '╯']);

export function stageFrameStrokeCells(
  bundle: StageFrameBand,
  armLength: number,
): readonly StageFrameStrokeCell[] {
  const arm = Math.max(1, Math.floor(armLength));
  const left = bundle.x - STAGE_FRAME_GAP;
  const right = bundle.x + bundle.width + STAGE_FRAME_GAP - 1;
  const top = bundle.y - STAGE_FRAME_GAP;
  const bottom = bundle.y + bundle.height + STAGE_FRAME_GAP - 1;
  const out: StageFrameStrokeCell[] = [];

  const push = (x: number, y: number, char: string) => {
    out.push({ x, y, char, kind: 'stroke', corner: CORNER_CHARS.has(char) });
  };

  // TL
  push(left, top, '╭');
  for (let i = 1; i < arm; i++) push(left + i, top, '─');
  for (let i = 1; i < arm; i++) push(left, top + i, '│');

  // TR
  push(right, top, '╮');
  for (let i = 1; i < arm; i++) push(right - i, top, '─');
  for (let i = 1; i < arm; i++) push(right, top + i, '│');

  // BR
  push(right, bottom, '╯');
  for (let i = 1; i < arm; i++) push(right - i, bottom, '─');
  for (let i = 1; i < arm; i++) push(right, bottom - i, '│');

  // BL
  push(left, bottom, '╰');
  for (let i = 1; i < arm; i++) push(left + i, bottom, '─');
  for (let i = 1; i < arm; i++) push(left, bottom - i, '│');

  return out;
}

/** 0..1 ease-in-out breathe phase. */
export function stageFrameBreathePhase(nowMs: number): number {
  const cycle = STAGE_FRAME_BREATHE_MS;
  if (cycle <= 0) return 0;
  const t = (Math.max(0, nowMs) % cycle) / cycle;
  // Smooth half-sine — never snaps.
  return 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
}

export function paintStageFrameCells(input: {
  readonly bundle: StageFrameBand;
  readonly cols: number;
  readonly rows: number;
  readonly nowMs: number;
  readonly appearance: AppearancePreferences;
  /** Freeze motion (typing / decorative skip) — static dim corners. */
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
  const fullArm = stageFrameArmLength(input.bundle);
  const arm = stageFrameEntranceArmLength(fullArm, progress);
  if (arm <= 0) return [];

  const geometry = stageFrameStrokeCells(input.bundle, arm);
  const border = currentTheme.color('border');
  const glow = currentTheme.color('glow');
  const freeze =
    ambientOff || input.freezeChase === true || isTUIInputInteractionActive(input.nowMs);
  const breathe = freeze ? 0 : stageFrameBreathePhase(input.nowMs);
  // Premium peaks a little brighter; subtle stays near border.
  const peakMix = mode === 'premium' ? 0.42 : 0.28;
  const cornerFg = mixHexColor(border, glow, breathe * peakMix);
  const armFg = mixHexColor(border, currentTheme.color('surfaceSunken'), 0.15);

  const out: StageFramePaintCell[] = [];
  const onScreen = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < input.cols && y < input.rows;

  for (const cell of geometry) {
    if (!onScreen(cell.x, cell.y)) continue;
    if (cell.corner) {
      out.push({
        x: cell.x,
        y: cell.y,
        char: cell.char,
        fg: cornerFg,
        ...(breathe > 0.72 && mode === 'premium' ? { bold: true } : {}),
      });
    } else {
      out.push({ x: cell.x, y: cell.y, char: cell.char, fg: armFg });
    }
  }

  return out;
}

export function createStageFrameOverlayRegion(input: {
  readonly bundle: StageFrameBand;
  readonly cols: number;
  readonly rows: number;
  readonly nowMs: number;
  readonly appearance: AppearancePreferences;
  readonly freezeChase?: boolean;
}): RendererFrameRegion | undefined {
  const painted = paintStageFrameCells(input);
  if (painted.length === 0) return undefined;
  const lines: RendererCell[][] = Array.from({ length: input.rows }, () => []);
  for (const cell of painted) {
    if (cell.y < 0 || cell.y >= input.rows || cell.x < 0 || cell.x >= input.cols) continue;
    const row = lines[cell.y]!;
    row[cell.x] = { char: cell.char, style: { fg: cell.fg, bold: cell.bold } };
  }
  return {
    id: 'stageFrame',
    rect: { x: 0, y: 0, width: input.cols, height: input.rows },
    content: lines,
    clear: false,
    zIndex: 5,
  };
}
