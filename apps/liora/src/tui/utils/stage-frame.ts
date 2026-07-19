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
