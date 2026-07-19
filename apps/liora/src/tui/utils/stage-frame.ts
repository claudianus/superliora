import type { AppearancePreferences } from '#/tui/config';
import { mixHexColor, type RendererCell, type RendererFrameRegion } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';
import { isTUIInputInteractionActive } from '#/tui/utils/input-interaction';

export const STAGE_FRAME_GAP = 2;
export const STAGE_FRAME_BLOOM = 1;
export const STAGE_FRAME_MARGIN = STAGE_FRAME_GAP + STAGE_FRAME_BLOOM + 1; // 4
export const STAGE_FRAME_ARM_TARGET = 5;
export const STAGE_FRAME_ARM_MIN = 4;
export const STAGE_FRAME_ENTRANCE_MS = 320;
export const STAGE_FRAME_CHASE_MS_PER_CELL = 110; // ~9 cells/s
export const STAGE_FRAME_TRAIL_LEN = 5;

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
    // two arms + ≥2 gap between tips
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
  readonly kind: 'stroke' | 'bloom';
}

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

  const pushStroke = (x: number, y: number, char: string) => {
    out.push({ x, y, char, kind: 'stroke' });
  };
  const pushBloom = (x: number, y: number, char: string) => {
    out.push({ x, y, char, kind: 'bloom' });
  };

  // TL
  pushStroke(left, top, '╭');
  for (let i = 1; i < arm; i++) pushStroke(left + i, top, '─');
  for (let i = 1; i < arm; i++) pushStroke(left, top + i, '│');
  pushBloom(left - 1, top - 1, '╭');
  for (let i = 1; i < arm; i++) pushBloom(left + i, top - 1, '─');
  for (let i = 1; i < arm; i++) pushBloom(left - 1, top + i, '│');

  // TR
  pushStroke(right, top, '╮');
  for (let i = 1; i < arm; i++) pushStroke(right - i, top, '─');
  for (let i = 1; i < arm; i++) pushStroke(right, top + i, '│');
  pushBloom(right + 1, top - 1, '╮');
  for (let i = 1; i < arm; i++) pushBloom(right - i, top - 1, '─');
  for (let i = 1; i < arm; i++) pushBloom(right + 1, top + i, '│');

  // BR
  pushStroke(right, bottom, '╯');
  for (let i = 1; i < arm; i++) pushStroke(right - i, bottom, '─');
  for (let i = 1; i < arm; i++) pushStroke(right, bottom - i, '│');
  pushBloom(right + 1, bottom + 1, '╯');
  for (let i = 1; i < arm; i++) pushBloom(right - i, bottom + 1, '─');
  for (let i = 1; i < arm; i++) pushBloom(right + 1, bottom - i, '│');

  // BL
  pushStroke(left, bottom, '╰');
  for (let i = 1; i < arm; i++) pushStroke(left + i, bottom, '─');
  for (let i = 1; i < arm; i++) pushStroke(left, bottom - i, '│');
  pushBloom(left - 1, bottom + 1, '╰');
  for (let i = 1; i < arm; i++) pushBloom(left + i, bottom + 1, '─');
  for (let i = 1; i < arm; i++) pushBloom(left - 1, bottom - i, '│');

  return out;
}

function positiveModulo(n: number, m: number): number {
  if (m <= 0) return 0;
  return ((n % m) + m) % m;
}

/** Pair bloom twins to stroke cells using geometry emission order (stroke group → bloom group). */
function bloomTwinByStroke(
  geometry: readonly StageFrameStrokeCell[],
): ReadonlyMap<string, StageFrameStrokeCell> {
  const map = new Map<string, StageFrameStrokeCell>();
  let i = 0;
  let strokeGroup: StageFrameStrokeCell[] = [];
  while (i < geometry.length) {
    const kind = geometry[i]!.kind;
    const group: StageFrameStrokeCell[] = [];
    while (i < geometry.length && geometry[i]!.kind === kind) {
      group.push(geometry[i]!);
      i += 1;
    }
    if (kind === 'stroke') {
      strokeGroup = group;
      continue;
    }
    const n = Math.min(strokeGroup.length, group.length);
    for (let j = 0; j < n; j++) {
      const stroke = strokeGroup[j]!;
      map.set(`${stroke.x},${stroke.y}`, group[j]!);
    }
  }
  return map;
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
  if (t < 0.12) return head;
  if (t < 0.4) return mid;
  if (t < 0.72) return soft;
  return dim;
}

export function paintStageFrameCells(input: {
  readonly bundle: StageFrameBand;
  readonly cols: number;
  readonly rows: number;
  readonly nowMs: number;
  readonly appearance: AppearancePreferences;
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
  const strokes = geometry.filter((c) => c.kind === 'stroke');
  const bloomByStroke = ambientOff ? new Map<string, StageFrameStrokeCell>() : bloomTwinByStroke(geometry);

  const border = currentTheme.color('border');
  // Dim chrome practice: mix border toward surfaceSunken (same family as sunken panels).
  const mixTarget = currentTheme.color('surfaceSunken');
  const bloomBase = mixHexColor(border, mixTarget, 0.65);
  const headMix = mode === 'premium' ? 0.72 : 0.52;
  const head = mixHexColor(border, currentTheme.color('glow'), headMix);
  const mid = mixHexColor(head, border, 0.32);
  const soft = mixHexColor(head, border, 0.58);
  const dim = border;

  const freeze =
    ambientOff || input.freezeChase === true || isTUIInputInteractionActive(input.nowMs);

  const path = strokes;
  const trailLen = STAGE_FRAME_TRAIL_LEN;
  const headIndex =
    path.length === 0 || freeze
      ? -1
      : positiveModulo(Math.floor(input.nowMs / STAGE_FRAME_CHASE_MS_PER_CELL), path.length);

  const strokeFg = new Map<string, { fg: string; bold: boolean }>();
  for (const cell of path) {
    strokeFg.set(`${cell.x},${cell.y}`, { fg: dim, bold: false });
  }
  if (!freeze && headIndex >= 0) {
    for (let step = 0; step <= trailLen; step++) {
      const idx = positiveModulo(headIndex - step, path.length);
      const cell = path[idx]!;
      const fg = chaseFgForTrailStep(step, trailLen, head, mid, soft, dim);
      const t = step / Math.max(1, trailLen);
      strokeFg.set(`${cell.x},${cell.y}`, { fg, bold: t < 0.35 });
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
      ...(style.bold ? { bold: true } : {}),
    });

    const twin = bloomByStroke.get(`${cell.x},${cell.y}`);
    if (!twin || !onScreen(twin.x, twin.y)) continue;
    // Bloom never brighter than its stroke twin — mix trail further toward sunken.
    const bloomFg = freeze
      ? bloomBase
      : mixHexColor(style.fg, bloomBase, mode === 'premium' && style.bold ? 0.35 : 0.55);
    out.push({
      x: twin.x,
      y: twin.y,
      char: twin.char,
      fg: bloomFg,
    });
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
