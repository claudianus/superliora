import { describe, expect, it } from 'vitest';

import {
  RAIL_WIDTH,
  resolveStageLayout,
  STAGE_MAX_HEIGHT,
  STAGE_MAX_WIDTH,
  STAGE_RAIL_GAP,
} from '#/tui/controllers/stage-layout';

describe('resolveStageLayout', () => {
  it('uses the full terminal size on compact terminals', () => {
    const layout = resolveStageLayout({ width: 80, height: 24, hasRailContent: true });
    expect(layout).toMatchObject({
      profile: 'compact',
      mode: 'stack',
      stage: { x: 0, y: 0, width: 80, height: 24 },
      bundleWidth: 80,
      bundleHeight: 24,
    });
    expect(layout.rail).toBeUndefined();
  });

  it('centers a capped portrait stage on ultrawide tall terminals without rail content', () => {
    const layout = resolveStageLayout({ width: 200, height: 120, hasRailContent: false });
    expect(layout.mode).toBe('stack');
    expect(layout.stage).toEqual({
      x: Math.floor((200 - STAGE_MAX_WIDTH) / 2),
      y: Math.floor((120 - STAGE_MAX_HEIGHT) / 2),
      width: STAGE_MAX_WIDTH,
      height: STAGE_MAX_HEIGHT,
    });
    expect(layout.rail).toBeUndefined();
  });

  it('opens a centered stage+rail bundle when content fits on ultrawide', () => {
    const layout = resolveStageLayout({ width: 200, height: 120, hasRailContent: true });
    const bundle = STAGE_MAX_WIDTH + STAGE_RAIL_GAP + RAIL_WIDTH;
    expect(layout.mode).toBe('rail');
    expect(layout.bundleWidth).toBe(bundle);
    expect(layout.bundleHeight).toBe(STAGE_MAX_HEIGHT);
    expect(layout.stage).toEqual({
      x: Math.floor((200 - bundle) / 2),
      y: Math.floor((120 - STAGE_MAX_HEIGHT) / 2),
      width: STAGE_MAX_WIDTH,
      height: STAGE_MAX_HEIGHT,
    });
    expect(layout.rail).toEqual({
      x: layout.stage.x + STAGE_MAX_WIDTH + STAGE_RAIL_GAP,
      y: layout.stage.y,
      width: RAIL_WIDTH,
      height: STAGE_MAX_HEIGHT,
    });
  });

  it('opens the rail on wide terminals because the portrait stage bundle fits', () => {
    // Portrait stage (50) + gap + rail (36) = 88 ≤ 120.
    const layout = resolveStageLayout({ width: 120, height: 100, hasRailContent: true });
    const bundle = STAGE_MAX_WIDTH + STAGE_RAIL_GAP + RAIL_WIDTH;
    expect(layout.profile).toBe('wide');
    expect(layout.mode).toBe('rail');
    expect(layout.stage.width).toBe(STAGE_MAX_WIDTH);
    expect(layout.stage.height).toBe(STAGE_MAX_HEIGHT);
    expect(layout.stage.x).toBe(Math.floor((120 - bundle) / 2));
    expect(layout.stage.y).toBe(Math.floor((100 - STAGE_MAX_HEIGHT) / 2));
    expect(layout.rail?.width).toBe(RAIL_WIDTH);
  });

  it('keeps tiny terminals full-bleed even when short and wide', () => {
    const layout = resolveStageLayout({ width: 160, height: 12, hasRailContent: true });
    expect(layout.profile).toBe('tiny');
    expect(layout.mode).toBe('stack');
    expect(layout.stage).toEqual({ x: 0, y: 0, width: 160, height: 12 });
  });

  it('centers vertically on tall compact terminals without narrowing width', () => {
    const layout = resolveStageLayout({ width: 80, height: 120, hasRailContent: false });
    expect(layout.profile).toBe('compact');
    expect(layout.stage).toEqual({
      x: 0,
      y: Math.floor((120 - STAGE_MAX_HEIGHT) / 2),
      width: 80,
      height: STAGE_MAX_HEIGHT,
    });
  });
});
