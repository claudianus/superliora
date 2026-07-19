import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  STAGE_FRAME_ARM_MIN,
  STAGE_FRAME_ARM_TARGET,
  STAGE_FRAME_CHASE_MS_PER_CELL,
  STAGE_FRAME_MARGIN,
  createStageFrameOverlayRegion,
  noteStageFrameBundle,
  paintStageFrameCells,
  resetStageFrameEntranceForTests,
  stageFrameArmLength,
  stageFrameBundleKey,
  stageFrameBundleRect,
  stageFrameEntranceArmLength,
  stageFrameEntranceProgress,
  stageFrameEntranceStartedAtMs,
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
import {
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import { resetTUIInputInteractionForTests } from '#/tui/utils/input-interaction';

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

describe('stageFrame entrance + chase', () => {
  const previous = {
    TERM: process.env['TERM'],
    CI: process.env['CI'],
    NO_COLOR: process.env['NO_COLOR'],
    SSH_TTY: process.env['SSH_TTY'],
    SSH_CONNECTION: process.env['SSH_CONNECTION'],
    SSH_CLIENT: process.env['SSH_CLIENT'],
  };

  beforeEach(() => {
    process.env['TERM'] = 'xterm-256color';
    delete process.env['CI'];
    delete process.env['NO_COLOR'];
    delete process.env['SSH_TTY'];
    delete process.env['SSH_CONNECTION'];
    delete process.env['SSH_CLIENT'];
    setAppearanceRenderHealth('healthy');
    setAppearanceRenderQuality('full');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    resetStageFrameEntranceForTests();
    resetTUIInputInteractionForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('snaps progress to 1 when ambient is off', () => {
    expect(stageFrameEntranceProgress(0, 50, true)).toBe(1);
  });

  it('grows arm length with entrance progress', () => {
    expect(stageFrameEntranceArmLength(5, 0)).toBe(0);
    expect(stageFrameEntranceArmLength(5, 0.5)).toBeGreaterThan(0);
    expect(stageFrameEntranceArmLength(5, 1)).toBe(5);
  });

  it('resets entrance when bundle key changes', () => {
    noteStageFrameBundle('a', 1000);
    noteStageFrameBundle('b', 1500);
    expect(stageFrameEntranceStartedAtMs()).toBe(1500);
    expect(stageFrameEntranceProgress(stageFrameEntranceStartedAtMs(), 1500, false)).toBe(0);
  });

  it('paint returns cells only outside the bundle', () => {
    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const cells = paintStageFrameCells({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: 10_000, // settled
      appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, particles: 'subtle' },
      freezeChase: false,
    });
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      const inside =
        c.x >= bundle.x &&
        c.x < bundle.x + bundle.width &&
        c.y >= bundle.y &&
        c.y < bundle.y + bundle.height;
      expect(inside).toBe(false);
    }
  });

  it('omits bloom when ambient profile is off', () => {
    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const cells = paintStageFrameCells({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: 10_000,
      appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off', particles: 'off' },
    });
    const fullArm = stageFrameArmLength(bundle);
    const strokeOnly = stageFrameStrokeCells(bundle, fullArm).filter((c) => c.kind === 'stroke');
    expect(cells.length).toBe(strokeOnly.length);
  });

  it('paints bloom cells when subtle ambient is allowed', () => {
    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'subtle' as const,
      particles: 'ambient' as const,
    };
    const cells = paintStageFrameCells({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: 10_000,
      appearance,
      freezeChase: false,
    });
    const fullArm = stageFrameArmLength(bundle);
    const strokeOnly = stageFrameStrokeCells(bundle, fullArm).filter((c) => c.kind === 'stroke');
    expect(cells.length).toBeGreaterThan(strokeOnly.length);
  });

  it('keeps chase head frozen when freezeChase is true', () => {
    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'subtle' as const,
      particles: 'ambient' as const,
    };
    const settled = 10_000;
    const a = paintStageFrameCells({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: settled,
      appearance,
      freezeChase: true,
    });
    const b = paintStageFrameCells({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: settled + STAGE_FRAME_CHASE_MS_PER_CELL * 3,
      appearance,
      freezeChase: true,
    });
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('advances chase styling across settled nowMs when freezeChase is false', () => {
    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'subtle' as const,
      particles: 'ambient' as const,
    };
    const settled = 10_000;
    const a = paintStageFrameCells({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: settled,
      appearance,
      freezeChase: false,
    });
    const b = paintStageFrameCells({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: settled + STAGE_FRAME_CHASE_MS_PER_CELL,
      appearance,
      freezeChase: false,
    });
    expect(a.length).toBe(b.length);
    const signature = (cells: typeof a) =>
      cells.map((c) => `${c.x},${c.y},${c.fg},${c.bold === true ? 1 : 0}`).join('|');
    expect(signature(a)).not.toBe(signature(b));
  });

  it('builds a non-clearing full-viewport overlay with sparse cells', () => {
    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const region = createStageFrameOverlayRegion({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: 10_000,
      appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, particles: 'subtle' },
    });
    expect(region).toBeDefined();
    expect(region!.clear).toBe(false);
    expect(region!.id).toBe('stageFrame');
    expect(region!.rect).toEqual({ x: 0, y: 0, width: 200, height: 80 });
    const lines = region!.content as readonly (readonly { char: string }[])[];
    const painted = lines.flatMap((row, y) =>
      Object.entries(row).map(([x, cell]) => ({ x: Number(x), y, char: cell.char })),
    );
    expect(painted.length).toBeGreaterThan(0);
  });
});
