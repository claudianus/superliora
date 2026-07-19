import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  STAGE_FRAME_ARM_MIN,
  STAGE_FRAME_ARM_TARGET,
  STAGE_FRAME_BREATHE_MS,
  STAGE_FRAME_MARGIN,
  createStageFrameOverlayRegion,
  noteStageFrameBundle,
  paintStageFrameCells,
  resetStageFrameEntranceForTests,
  stageFrameArmLength,
  stageFrameBreathePhase,
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
    expect(stageFrameVisible({ x: 2, y: 10, width: 108, height: 56 }, 200, 80)).toBe(false);
    expect(stageFrameVisible({ x: 10, y: 2, width: 108, height: 56 }, 200, 80)).toBe(false);
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
  it('uses short target arms when sides are long enough', () => {
    expect(stageFrameArmLength({ x: 20, y: 10, width: 108, height: 56 })).toBe(STAGE_FRAME_ARM_TARGET);
  });

  it('clamps when opposite arms would meet', () => {
    // target 3+3+2=8, min 2+2+2=6 → width 7 uses min
    expect(stageFrameArmLength({ x: 20, y: 10, width: 7, height: 56 })).toBe(STAGE_FRAME_ARM_MIN);
  });
});

describe('stageFrameStrokeCells', () => {
  it('places short L corners outside the bundle by gap 2 with no bloom', () => {
    const bundle = { x: 20, y: 12, width: 108, height: 56 };
    const cells = stageFrameStrokeCells(bundle, 3);
    expect(cells.every((c) => c.kind === 'stroke')).toBe(true);
    expect(cells.some((c) => c.char === '╭' && c.x === 18 && c.y === 10 && c.corner)).toBe(true);
    expect(cells.filter((c) => c.corner)).toHaveLength(4);
    // arm length 3 → corner + 2 horizontal + 2 vertical per corner = 5 cells × 4
    expect(cells).toHaveLength(20);
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

describe('stageFrame entrance + breathe', () => {
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
    expect(stageFrameEntranceArmLength(3, 0)).toBe(0);
    expect(stageFrameEntranceArmLength(3, 0.5)).toBeGreaterThan(0);
    expect(stageFrameEntranceArmLength(3, 1)).toBe(3);
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
      nowMs: 10_000,
      appearance: {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'subtle',
        particles: 'ambient',
      },
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

  it('paints stroke-only cells (no bloom twins)', () => {
    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const cells = paintStageFrameCells({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: 10_000,
      appearance: {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'subtle',
        particles: 'ambient',
      },
    });
    const fullArm = stageFrameArmLength(bundle);
    const strokes = stageFrameStrokeCells(bundle, fullArm);
    expect(cells.length).toBe(strokes.length);
  });

  it('keeps paint frozen when freezeChase is true', () => {
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
      nowMs: settled + STAGE_FRAME_BREATHE_MS / 4,
      appearance,
      freezeChase: true,
    });
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it('breathes corner luminance across time when motion is allowed', () => {
    expect(stageFrameBreathePhase(0)).toBeCloseTo(0, 5);
    expect(stageFrameBreathePhase(STAGE_FRAME_BREATHE_MS / 2)).toBeCloseTo(1, 5);

    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'subtle' as const,
      particles: 'ambient' as const,
    };
    const a = paintStageFrameCells({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: 10_000,
      appearance,
      freezeChase: false,
    });
    const b = paintStageFrameCells({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: 10_000 + STAGE_FRAME_BREATHE_MS / 2,
      appearance,
      freezeChase: false,
    });
    const cornerFg = (cells: typeof a) =>
      cells
        .filter((c) => c.char === '╭' || c.char === '╮' || c.char === '╰' || c.char === '╯')
        .map((c) => c.fg)
        .join('|');
    expect(cornerFg(a)).not.toBe(cornerFg(b));
  });

  it('builds a non-clearing full-viewport overlay with sparse cells', () => {
    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const region = createStageFrameOverlayRegion({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: 10_000,
      appearance: {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'subtle',
        particles: 'ambient',
      },
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
    expect(painted.every((c) => '╭╮╰╯─│'.includes(c.char))).toBe(true);
  });
});
