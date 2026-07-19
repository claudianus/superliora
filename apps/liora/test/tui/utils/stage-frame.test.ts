import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  STAGE_FRAME_CHASE_MS_PER_CELL,
  STAGE_FRAME_GAP,
  STAGE_FRAME_HALO,
  STAGE_FRAME_MARGIN,
  createStageFrameOverlayRegions,
  noteStageFrameBundle,
  paintStageFrameCells,
  resetStageFrameEntranceForTests,
  resolveLetterboxCanvasBg,
  stageFrameBundleKey,
  stageFrameBundleRect,
  stageFrameEntranceProgress,
  stageFrameEntranceStartedAtMs,
  stageFrameHaloCells,
  stageFrameLetterboxBands,
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
import {
  noteTUIInputInteraction,
  resetTUIInputInteractionForTests,
} from '#/tui/utils/input-interaction';
import { currentTheme } from '#/tui/theme';
import { mixHexColor } from '#/tui/renderer';

describe('stageFrameVisible', () => {
  it('hides when any margin is below STAGE_FRAME_MARGIN', () => {
    expect(stageFrameVisible({ x: 1, y: 10, width: 108, height: 56 }, 200, 80)).toBe(false);
    expect(stageFrameVisible({ x: 10, y: 1, width: 108, height: 56 }, 200, 80)).toBe(false);
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

describe('stageFrameStrokeCells', () => {
  it('draws a closed rounded rectangle around the bundle', () => {
    const bundle = { x: 20, y: 12, width: 40, height: 20 };
    const cells = stageFrameStrokeCells(bundle);
    const left = bundle.x - STAGE_FRAME_GAP;
    const right = bundle.x + bundle.width + STAGE_FRAME_GAP - 1;
    const top = bundle.y - STAGE_FRAME_GAP;
    const bottom = bundle.y + bundle.height + STAGE_FRAME_GAP - 1;

    expect(cells.some((c) => c.char === '╭' && c.x === left && c.y === top)).toBe(true);
    expect(cells.some((c) => c.char === '╮' && c.x === right && c.y === top)).toBe(true);
    expect(cells.some((c) => c.char === '╯' && c.x === right && c.y === bottom)).toBe(true);
    expect(cells.some((c) => c.char === '╰' && c.x === left && c.y === bottom)).toBe(true);
    expect(cells.filter((c) => c.corner)).toHaveLength(4);

    const width = right - left + 1;
    const height = bottom - top + 1;
    // perimeter = 2*(w+h) - 4 (corners counted once)
    expect(cells).toHaveLength(2 * (width + height) - 4);
  });

  it('tracks rail bundle width, not stage-only width', () => {
    const layout = resolveStageLayout({ width: 200, height: 80, hasRailContent: true });
    const bundle = stageFrameBundleRect(layout);
    expect(bundle.width).toBe(STAGE_MAX_WIDTH + STAGE_RAIL_GAP + RAIL_WIDTH);
    const cells = stageFrameStrokeCells(bundle);
    const maxX = Math.max(...cells.map((c) => c.x));
    expect(maxX).toBe(bundle.x + bundle.width + STAGE_FRAME_GAP - 1);
  });
});

describe('stageFrameLetterboxBands', () => {
  it('covers only outside the frame ring and outer halo', () => {
    const bundle = { x: 5, y: 5, width: 10, height: 6 };
    const bands = stageFrameLetterboxBands(bundle, 24, 18);
    const inset = STAGE_FRAME_GAP + STAGE_FRAME_HALO;
    const left = bundle.x - inset;
    const right = bundle.x + bundle.width + inset - 1;
    const top = bundle.y - inset;
    const bottom = bundle.y + bundle.height + inset - 1;
    expect(bands.length).toBe(4);
    for (const band of bands) {
      for (let y = band.y; y < band.y + band.height; y++) {
        for (let x = band.x; x < band.x + band.width; x++) {
          const inside = x >= left && x <= right && y >= top && y <= bottom;
          expect(inside).toBe(false);
        }
      }
    }
  });

  it('does not overlap the outer halo row', () => {
    const bundle = { x: 40, y: 15, width: 90, height: 50 };
    const bands = stageFrameLetterboxBands(bundle, 200, 80);
    const haloTop = bundle.y - STAGE_FRAME_GAP - STAGE_FRAME_HALO;
    const topBand = bands.find((b) => b.y === 0);
    expect(topBand).toBeDefined();
    expect(topBand!.y + topBand!.height).toBe(haloTop);
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
    currentTheme.setCanvasBackgroundEnabled(true);
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

  it('resets entrance when bundle key changes', () => {
    noteStageFrameBundle('a', 1000);
    noteStageFrameBundle('b', 1500);
    expect(stageFrameEntranceStartedAtMs()).toBe(1500);
    expect(stageFrameEntranceProgress(stageFrameEntranceStartedAtMs(), 1500, false)).toBe(0);
  });

  it('paint keeps stroke and halo cells outside the bundle', () => {
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
    const painted = cells.filter((c) => c.char !== ' ');
    expect(painted.length).toBe(
      stageFrameStrokeCells(bundle).length + stageFrameHaloCells(bundle).length,
    );
    expect(STAGE_FRAME_HALO).toBe(1);
    expect(STAGE_FRAME_MARGIN).toBe(STAGE_FRAME_GAP + 1 + STAGE_FRAME_HALO);
    for (const c of painted) {
      const inside =
        c.x >= bundle.x &&
        c.x < bundle.x + bundle.width &&
        c.y >= bundle.y &&
        c.y < bundle.y + bundle.height;
      expect(inside).toBe(false);
    }
  });

  it('keeps chase moving during typing holdoff', () => {
    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'subtle' as const,
      particles: 'ambient' as const,
    };
    const settled = 10_000;
    noteTUIInputInteraction(settled);
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
    const strokeSig = (cells: typeof a) =>
      cells
        .filter((c) => c.char !== ' ')
        .map((c) => `${c.x},${c.y},${c.fg}`)
        .join('|');
    expect(strokeSig(a)).not.toBe(strokeSig(b));
  });

  it('darkens letterbox canvas relative to stage canvas', () => {
    currentTheme.setCanvasBackgroundEnabled(true);
    const canvasBg = currentTheme.canvasBackgroundCell()?.style.bg;
    expect(canvasBg).toBeDefined();
    const letterbox = resolveLetterboxCanvasBg();
    expect(letterbox).toBeDefined();
    expect(letterbox).not.toBe(canvasBg);
    expect(letterbox).toBe(mixHexColor(canvasBg!, currentTheme.color('surfaceSunken'), 0.32));
  });

  it('keeps chase frozen when freezeChase is true', () => {
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
    const strokeSig = (cells: typeof a) =>
      cells
        .filter((c) => c.char !== ' ')
        .map((c) => `${c.x},${c.y},${c.fg},${c.bold === true ? 1 : 0}`)
        .join('|');
    expect(strokeSig(a)).toBe(strokeSig(b));
  });

  it('advances chase along the full perimeter when motion is allowed', () => {
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
    const strokeSig = (cells: typeof a) =>
      cells
        .filter((c) => c.char !== ' ')
        .map((c) => `${c.x},${c.y},${c.fg}`)
        .join('|');
    expect(strokeSig(a)).not.toBe(strokeSig(b));
  });

  it('builds letterbox fill bands plus a stroke overlay', () => {
    const bundle = { x: 40, y: 12, width: 108, height: 56 };
    noteStageFrameBundle(stageFrameBundleKey(bundle), 0);
    const regions = createStageFrameOverlayRegions({
      bundle,
      cols: 200,
      rows: 80,
      nowMs: 10_000,
      appearance: {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'subtle',
        particles: 'ambient',
        canvasBackground: true,
      },
    });
    expect(regions.some((r) => r.id?.startsWith('stageFrameLetterbox'))).toBe(true);
    const letterbox = regions.find((r) => r.id?.startsWith('stageFrameLetterbox'));
    expect(letterbox?.background?.style?.bg).toBe(resolveLetterboxCanvasBg());
    expect(letterbox?.clear).toBe(false);
    const letterboxLines = letterbox?.content as readonly (readonly unknown[])[];
    expect(letterboxLines[0]?.length).toBe(letterbox?.rect.width);
    const strokeRegions = regions.filter((r) => r.id?.startsWith('stageFrame:'));
    expect(strokeRegions.length).toBeGreaterThanOrEqual(4);
    expect(strokeRegions.every((r) => r.clear === false)).toBe(true);
    // Rim bands must not cover the stage interior (bundle).
    for (const stroke of strokeRegions) {
      const coversInterior =
        stroke.rect.x < bundle.x + bundle.width &&
        stroke.rect.x + stroke.rect.width > bundle.x &&
        stroke.rect.y < bundle.y + bundle.height &&
        stroke.rect.y + stroke.rect.height > bundle.y &&
        stroke.rect.width > STAGE_FRAME_GAP + STAGE_FRAME_HALO &&
        stroke.rect.height > STAGE_FRAME_GAP + STAGE_FRAME_HALO;
      // Side rims are thin; full interior coverage would be a wipe hazard.
      if (stroke.rect.width > STAGE_FRAME_GAP + STAGE_FRAME_HALO + 2) {
        // top/bottom bands: height is ring only
        expect(stroke.rect.height).toBe(STAGE_FRAME_GAP + STAGE_FRAME_HALO);
      } else {
        expect(coversInterior ? stroke.rect.width : 0).toBeLessThanOrEqual(
          STAGE_FRAME_GAP + STAGE_FRAME_HALO,
        );
      }
      const lines = stroke.content as readonly (readonly { char: string }[])[];
      expect(lines[0]?.length).toBe(stroke.rect.width);
    }
    const painted = strokeRegions.flatMap((stroke) => {
      const lines = stroke.content as readonly (readonly { char: string }[])[];
      return lines.flatMap((row) => row.map((cell) => cell.char));
    });
    expect(painted).toContain('╭');
    expect(painted.filter((c) => c === '─').length).toBeGreaterThan(10);
  });
});
