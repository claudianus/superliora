import { describe, expect, it } from 'vitest';
import {
  STAGE_FRAME_ARM_MIN,
  STAGE_FRAME_ARM_TARGET,
  STAGE_FRAME_MARGIN,
  stageFrameArmLength,
  stageFrameBundleRect,
  stageFrameStrokeCells,
  stageFrameVisible,
} from '#/tui/utils/stage-frame';
import {
  RAIL_WIDTH,
  resolveStageLayout,
  STAGE_MAX_HEIGHT,
  STAGE_MAX_WIDTH,
  STAGE_RAIL_GAP,
} from '#/tui/controllers/stage-layout';

describe('stageFrameVisible', () => {
  it('hides when any margin is below STAGE_FRAME_MARGIN', () => {
    expect(stageFrameVisible({ x: 3, y: 10, width: 108, height: 56 }, 200, 80)).toBe(false);
    expect(stageFrameVisible({ x: 10, y: 3, width: 108, height: 56 }, 200, 80)).toBe(false);
  });

  it('shows on ultrawide tall centered stage', () => {
    const layout = resolveStageLayout({ width: 200, height: 80, hasRailContent: false });
    const bundle = stageFrameBundleRect(layout);
    expect(bundle.x).toBeGreaterThanOrEqual(STAGE_FRAME_MARGIN);
    expect(stageFrameVisible(bundle, 200, 80)).toBe(true);
  });

  it('hides on compact full-bleed', () => {
    const layout = resolveStageLayout({ width: 80, height: 24, hasRailContent: false });
    expect(stageFrameVisible(stageFrameBundleRect(layout), 80, 24)).toBe(false);
  });
});

describe('stageFrameArmLength', () => {
  it('uses target 5 when sides are long enough', () => {
    expect(stageFrameArmLength({ x: 20, y: 10, width: 108, height: 56 })).toBe(STAGE_FRAME_ARM_TARGET);
  });

  it('clamps to 4 when opposite arms would meet', () => {
    // width must satisfy 4+4+2 <= width but not 5+5+2
    expect(stageFrameArmLength({ x: 20, y: 10, width: 11, height: 56 })).toBe(STAGE_FRAME_ARM_MIN);
  });
});

describe('stageFrameStrokeCells', () => {
  it('places L corners outside the bundle by gap 2 and includes bloom twins', () => {
    const bundle = { x: 20, y: 12, width: 108, height: 56 };
    const cells = stageFrameStrokeCells(bundle, 5);
    const strokes = cells.filter((c) => c.kind === 'stroke');
    const blooms = cells.filter((c) => c.kind === 'bloom');
    expect(strokes.some((c) => c.char === '╭' && c.x === 18 && c.y === 10)).toBe(true);
    expect(blooms.length).toBeGreaterThan(0);
    expect(blooms.every((b) => b.x < bundle.x || b.x >= bundle.x + bundle.width || b.y < bundle.y || b.y >= bundle.y + bundle.height)).toBe(true);
  });

  it('tracks rail bundle width, not stage-only width', () => {
    const layout = resolveStageLayout({ width: 200, height: 80, hasRailContent: true });
    const bundle = stageFrameBundleRect(layout);
    expect(bundle.width).toBe(STAGE_MAX_WIDTH + STAGE_RAIL_GAP + RAIL_WIDTH);
    const cells = stageFrameStrokeCells(bundle, stageFrameArmLength(bundle));
    const maxX = Math.max(...cells.map((c) => c.x));
    expect(maxX).toBeGreaterThanOrEqual(bundle.x + bundle.width);
  });
});
