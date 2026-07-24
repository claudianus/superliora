import { describe, expect, it } from 'vitest';
import { measureWorkspaceLayout } from '@harness-kit/tui-renderer';

import {
  resolveStageLayout,
  STAGE_MAX_HEIGHT,
  STAGE_MAX_WIDTH,
} from '#/tui/controllers/stage-layout';

describe('resolveStageLayout', () => {
  it('uses the full terminal size on compact terminals', () => {
    const layout = resolveStageLayout({ width: 80, height: 24 });
    expect(layout).toMatchObject({
      profile: 'compact',
      stage: { x: 0, y: 0, width: 80, height: 24 },
      bundleWidth: 80,
      bundleHeight: 24,
    });
  });

  it('centers a capped stage on ultrawide tall terminals', () => {
    const layout = resolveStageLayout({ width: 200, height: 80 });
    expect(layout.stage).toEqual({
      x: Math.floor((200 - STAGE_MAX_WIDTH) / 2),
      y: Math.floor((80 - STAGE_MAX_HEIGHT) / 2),
      width: STAGE_MAX_WIDTH,
      height: STAGE_MAX_HEIGHT,
    });
    expect(layout.bundleWidth).toBe(STAGE_MAX_WIDTH);
    expect(layout.bundleHeight).toBe(STAGE_MAX_HEIGHT);
  });

  it('keeps the centered reading column when panels have content (no side rail)', () => {
    // Situational panels always render in the vertical stack inside the stage
    // column — wide terminals no longer open a side rail beside the stage.
    const withPanels = resolveStageLayout({ width: 200, height: 80 });
    const bare = resolveStageLayout({ width: 200, height: 80 });
    expect(withPanels.stage).toEqual(bare.stage);
    expect(withPanels.bundleWidth).toBe(STAGE_MAX_WIDTH);
  });

  it('caps the stage width at the reading column on wide terminals', () => {
    const layout = resolveStageLayout({ width: 120, height: 64 });
    expect(layout.profile).toBe('wide');
    expect(layout.stage.width).toBe(STAGE_MAX_WIDTH);
    expect(layout.stage.x).toBe(Math.floor((120 - STAGE_MAX_WIDTH) / 2));
  });

  it('stays full-bleed one column below the wide profile threshold', () => {
    const layout = resolveStageLayout({ width: 119, height: 64 });
    expect(layout.profile).toBe('standard');
    expect(layout.stage).toEqual({
      x: 0,
      y: Math.floor((64 - STAGE_MAX_HEIGHT) / 2),
      width: 119,
      height: STAGE_MAX_HEIGHT,
    });
  });

  it('uses the full height when terminal rows exactly meet the reading cap', () => {
    const layout = resolveStageLayout({ width: 120, height: STAGE_MAX_HEIGHT });
    expect(layout.stage.y).toBe(0);
    expect(layout.stage.height).toBe(STAGE_MAX_HEIGHT);
  });

  it('lets tall / portrait terminals occupy the full height', () => {
    const layout = resolveStageLayout({ width: 50, height: 80 });
    expect(layout.profile).toBe('tiny');
    expect(layout.stage).toEqual({ x: 0, y: 0, width: 50, height: 80 });
  });

  it('fills the height on square terminals', () => {
    const layout = resolveStageLayout({ width: 80, height: 80 });
    expect(layout.profile).toBe('compact');
    expect(layout.stage).toEqual({ x: 0, y: 0, width: 80, height: 80 });
  });

  it('keeps tiny terminals full-bleed even when short and wide', () => {
    const layout = resolveStageLayout({ width: 160, height: 12 });
    expect(layout.profile).toBe('tiny');
    expect(layout.stage).toEqual({ x: 0, y: 0, width: 160, height: 12 });
  });

  it('places stage inside the workspace center band instead of assuming flush docks', () => {
    const ws = measureWorkspaceLayout({
      viewport: { x: 0, y: 0, width: 200, height: 60 },
    });
    const stage = resolveStageLayout({
      width: 200,
      height: 60,
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

  it('holds a user-chosen stage size and keeps it centered', () => {
    const layout = resolveStageLayout({
      width: 200,
      height: 80,
      userStageSize: { width: 130, height: 40 },
    });
    expect(layout.stage.width).toBe(130);
    expect(layout.stage.height).toBe(40);
    expect(layout.stage.x).toBe(Math.floor((200 - 130) / 2));
    expect(layout.stage.y).toBe(Math.floor((80 - 40) / 2));
  });

  it('applies the user size regardless of responsive profile', () => {
    // A "standard" terminal would normally stay full-bleed; an explicit user
    // size still wins (clamped to the available band) and centers.
    const layout = resolveStageLayout({
      width: 119,
      height: 64,
      userStageSize: { width: 70, height: 30 },
    });
    expect(layout.profile).toBe('standard');
    expect(layout.stage.width).toBe(70);
    expect(layout.stage.height).toBe(30);
    expect(layout.stage.x).toBe(Math.floor((119 - 70) / 2));
  });

  it('clamps an oversized user size to the available band', () => {
    const layout = resolveStageLayout({
      width: 80,
      height: 24,
      userStageSize: { width: 500, height: 500 },
    });
    expect(layout.stage.width).toBe(80);
    expect(layout.stage.height).toBe(24);
  });
});
