import { describe, expect, it } from 'vitest';
import { measureWorkspaceLayout } from '@harness-kit/tui-renderer';

import {
  COMPACT_RAIL_WIDTH,
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

  it('centers a capped stage on ultrawide tall terminals without rail content', () => {
    const layout = resolveStageLayout({ width: 200, height: 80, hasRailContent: false });
    expect(layout.mode).toBe('stack');
    expect(layout.stage).toEqual({
      x: Math.floor((200 - STAGE_MAX_WIDTH) / 2),
      y: Math.floor((80 - STAGE_MAX_HEIGHT) / 2),
      width: STAGE_MAX_WIDTH,
      height: STAGE_MAX_HEIGHT,
    });
    expect(layout.rail).toBeUndefined();
  });

  it('opens a centered stage+rail bundle when content fits on ultrawide', () => {
    const layout = resolveStageLayout({ width: 200, height: 80, hasRailContent: true });
    const bundle = STAGE_MAX_WIDTH + STAGE_RAIL_GAP + RAIL_WIDTH;
    expect(layout.mode).toBe('rail');
    expect(layout.bundleWidth).toBe(bundle);
    expect(layout.bundleHeight).toBe(STAGE_MAX_HEIGHT);
    expect(layout.stage).toEqual({
      x: Math.floor((200 - bundle) / 2),
      y: Math.floor((80 - STAGE_MAX_HEIGHT) / 2),
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

  it('opens a narrowed stage+rail bundle at the 120-column rail threshold', () => {
    // 120 cols: the stage narrows to 120 - (2 + 36) = 82 so the rail fits.
    const layout = resolveStageLayout({ width: 120, height: 64, hasRailContent: true });
    expect(layout.profile).toBe('wide');
    expect(layout.mode).toBe('rail');
    expect(layout.stage.width).toBe(82);
    expect(layout.stage.height).toBe(STAGE_MAX_HEIGHT);
    expect(layout.bundleWidth).toBe(120);
    expect(layout.stage.x).toBe(0);
    expect(layout.stage.y).toBe(Math.floor((64 - STAGE_MAX_HEIGHT) / 2));
    expect(layout.rail).toEqual({
      x: 82 + STAGE_RAIL_GAP,
      y: layout.stage.y,
      width: RAIL_WIDTH,
      height: STAGE_MAX_HEIGHT,
    });
  });

  it('keeps the vertical stack one column below the rail threshold', () => {
    const layout = resolveStageLayout({ width: 119, height: 64, hasRailContent: true });
    expect(layout.profile).toBe('standard');
    expect(layout.mode).toBe('stack');
    expect(layout.stage).toEqual({ x: 0, y: 7, width: 119, height: STAGE_MAX_HEIGHT });
    expect(layout.rail).toBeUndefined();
  });

  it('narrows the stage between the rail threshold and the full bundle width', () => {
    const layout = resolveStageLayout({ width: 127, height: 64, hasRailContent: true });
    expect(layout.mode).toBe('rail');
    expect(layout.stage.width).toBe(89); // 127 - (2 + 36)
    expect(layout.bundleWidth).toBe(127);
    expect(layout.stage.x).toBe(0);
    expect(layout.rail).toMatchObject({ x: 91, width: RAIL_WIDTH });
  });

  it('restores the capped stage width once the full bundle fits at 128 columns', () => {
    const layout = resolveStageLayout({ width: 128, height: 64, hasRailContent: true });
    expect(layout.mode).toBe('rail');
    expect(layout.stage.width).toBe(STAGE_MAX_WIDTH);
    expect(layout.bundleWidth).toBe(STAGE_MAX_WIDTH + STAGE_RAIL_GAP + RAIL_WIDTH);
    expect(layout.stage.x).toBe(0);
    expect(layout.rail).toMatchObject({
      x: STAGE_MAX_WIDTH + STAGE_RAIL_GAP,
      width: RAIL_WIDTH,
    });
  });

  it('centers the full stage+rail bundle on ultrawide terminals', () => {
    const bundle = STAGE_MAX_WIDTH + STAGE_RAIL_GAP + RAIL_WIDTH;
    const layout = resolveStageLayout({ width: 160, height: 64, hasRailContent: true });
    expect(layout.profile).toBe('ultrawide');
    expect(layout.mode).toBe('rail');
    expect(layout.stage.width).toBe(STAGE_MAX_WIDTH);
    expect(layout.stage.x).toBe(Math.floor((160 - bundle) / 2));
    expect(layout.rail?.width).toBe(RAIL_WIDTH);
  });

  it('keeps the centered stack at the threshold when rail content is absent', () => {
    const layout = resolveStageLayout({ width: 120, height: 64, hasRailContent: false });
    expect(layout.mode).toBe('stack');
    expect(layout.stage.width).toBe(STAGE_MAX_WIDTH);
    expect(layout.stage.x).toBe(Math.floor((120 - STAGE_MAX_WIDTH) / 2));
    expect(layout.rail).toBeUndefined();
  });

  it('keeps tiny terminals full-bleed even when short and wide', () => {
    const layout = resolveStageLayout({ width: 160, height: 12, hasRailContent: true });
    expect(layout.profile).toBe('tiny');
    expect(layout.mode).toBe('stack');
    expect(layout.stage).toEqual({ x: 0, y: 0, width: 160, height: 12 });
  });

  it('centers vertically on tall compact terminals without narrowing width', () => {
    const layout = resolveStageLayout({ width: 80, height: 80, hasRailContent: false });
    expect(layout.profile).toBe('compact');
    expect(layout.stage).toEqual({
      x: 0,
      y: Math.floor((80 - STAGE_MAX_HEIGHT) / 2),
      width: 80,
      height: STAGE_MAX_HEIGHT,
    });
  });

  it('places stage inside the workspace center band instead of assuming flush docks', () => {
    const ws = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 200, height: 60 },
    });
    const stage = resolveStageLayout({
      width: 200,
      height: 60,
      hasRailContent: false,
      workspaceCenter: ws.center,
    });
    expect(stage.stage.x).toBeGreaterThanOrEqual(ws.center.x);
    expect(stage.stage.x + stage.stage.width).toBeLessThanOrEqual(
      ws.center.x + ws.center.width,
    );
    expect(stage.stage.y).toBeGreaterThanOrEqual(ws.center.y);
    expect(stage.stage.y + stage.stage.height).toBeLessThanOrEqual(
      ws.center.y + ws.center.height,
    );
    // The workspace center already excludes docks; resolveStageLayout must
    // not additionally reserve leftDock/rightDock bands in this path.
    expect(stage.leftDock).toBeUndefined();
    expect(stage.rightDock).toBeUndefined();
  });

  it('full-bleeds edge-to-edge inside the workspace center (bento shell)', () => {
    const ws = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 200, height: 60 },
    });
    const stage = resolveStageLayout({
      width: 200,
      height: 60,
      hasRailContent: false,
      workspaceCenter: ws.center,
      fullBleed: true,
    });
    expect(stage.stage).toEqual({
      x: ws.center.x,
      y: ws.center.y,
      width: ws.center.width,
      height: ws.center.height,
    });
    expect(stage.mode).toBe('stack');
    expect(stage.rail).toBeUndefined();
  });

  it('opens a Context rail inside a dock-shrunk workspace center when content fits', () => {
    const ws = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 220, height: 50 },
    });
    // Center band is dock-shrunk (~88 cols) — still enough for transcript+rail.
    expect(ws.center.width).toBeGreaterThanOrEqual(STAGE_RAIL_GAP + RAIL_WIDTH + 40);
    const stage = resolveStageLayout({
      width: 220,
      height: 50,
      hasRailContent: true,
      workspaceCenter: ws.center,
      fullBleed: true,
    });
    expect(stage.mode).toBe('rail');
    expect(stage.rail?.width).toBe(RAIL_WIDTH);
    expect(stage.stage.x).toBeGreaterThanOrEqual(ws.center.x);
    expect((stage.rail?.x ?? 0) + (stage.rail?.width ?? 0)).toBeLessThanOrEqual(
      ws.center.x + ws.center.width,
    );
  });

  it('opens a compact Context rail when the docked center is too tight for the full rail', () => {
    const ws = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 160, height: 48 },
    });
    expect(ws.center.width).toBeLessThan(STAGE_RAIL_GAP + RAIL_WIDTH + 40);
    expect(ws.center.width).toBeGreaterThanOrEqual(STAGE_RAIL_GAP + COMPACT_RAIL_WIDTH + 32);
    const stage = resolveStageLayout({
      width: 160,
      height: 48,
      hasRailContent: true,
      workspaceCenter: ws.center,
      fullBleed: true,
    });
    expect(stage.mode).toBe('rail');
    expect(stage.rail?.width).toBe(COMPACT_RAIL_WIDTH);
  });
});
