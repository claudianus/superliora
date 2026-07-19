import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import {
  applySkyToLetterboxRegions,
  letterboxArea,
  paintStageLetterboxSky,
  pointInLetterboxBands,
  resolveLetterboxCapBands,
  resolveLetterboxSideGutters,
} from '#/tui/utils/stage-letterbox-sky';
import { stageFrameBundleRect, stageFrameLetterboxBands } from '#/tui/utils/stage-frame';
import { resolveStageLayout } from '#/tui/controllers/stage-layout';

describe('stage letterbox night sky', () => {
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
  });

  afterEach(() => {
    vi.useRealTimers();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function ultrawideBands() {
    const layout = resolveStageLayout({ width: 200, height: 80, hasRailContent: false });
    const bundle = stageFrameBundleRect(layout);
    return stageFrameLetterboxBands(bundle, 200, 80);
  }

  it('keeps painted cells inside top/bottom letterbox caps only', () => {
    const bands = ultrawideBands();
    const caps = resolveLetterboxCapBands(bands, 200);
    // Side gutters share stage rows — stars must never land there (corner
    // columns on the top/bottom caps are fine; those Ys are outside the stage).
    const sideBands = bands.filter((b) => b.width < 200);
    expect(caps.length).toBeGreaterThan(0);
    expect(sideBands.length).toBeGreaterThan(0);
    expect(letterboxArea(caps)).toBeGreaterThan(24);
    const cells = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 12_000,
      appearance: {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
        particles: 'ambient',
      },
    });
    expect(cells.length).toBeGreaterThan(8);
    for (const c of cells) {
      expect(pointInLetterboxBands(caps, c.x, c.y)).toBe(true);
      expect(pointInLetterboxBands(sideBands, c.x, c.y)).toBe(false);
    }
  });

  it('returns no sky when ambient is off', () => {
    const bands = ultrawideBands();
    const cells = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 12_000,
      appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off', particles: 'off' },
    });
    expect(cells).toEqual([]);
  });

  it('keeps star twinkle stable within a 90ms premium bucket', () => {
    const bands = ultrawideBands();
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    const a = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 12_000,
      appearance,
      freeze: false,
    });
    const b = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 12_000 + 40,
      appearance,
      freeze: false,
    });
    const starSig = (cells: typeof a) =>
      cells
        .map((c) => `${c.x},${c.y},${c.char},${c.fg}`)
        .sort()
        .join('|');
    expect(starSig(a)).toBe(starSig(b));
  });

  it('freezes twinkle when freeze is set', () => {
    const bands = ultrawideBands();
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'ambient' as const,
    };
    const a = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 20_000,
      appearance,
      freeze: true,
    });
    const b = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 20_000 + 500,
      appearance,
      freeze: true,
    });
    expect(a).toEqual(b);
  });

  it('changes twinkle brightness across buckets when not frozen', () => {
    const bands = ultrawideBands();
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'ambient' as const,
    };
    const a = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 30_000,
      appearance,
      freeze: false,
    });
    const b = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 30_000 + 400,
      appearance,
      freeze: false,
    });
    const sig = (cells: typeof a) =>
      cells
        .map((c) => `${c.x},${c.y},${c.fg}`)
        .sort()
        .join('|');
    expect(sig(a)).not.toBe(sig(b));
  });

  it('resolves full-height side gutters on ultrawide letterbox', () => {
    const bands = ultrawideBands();
    const gutters = resolveLetterboxSideGutters(bands, 200);
    expect(gutters.length).toBe(2);
    expect(gutters[0]!.x0).toBe(0);
    expect(gutters[0]!.x1).toBeGreaterThan(0);
    expect(gutters[1]!.x1).toBe(200);
    expect(gutters[1]!.x0).toBeLessThan(200);
  });

  it('builds dense letterbox regions without clear so ambient ticks do not wipe bands', () => {
    const bands = ultrawideBands();
    const regions = applySkyToLetterboxRegions(
      bands,
      [{ x: bands[0]!.x, y: bands[0]!.y, char: '·', fg: '#fff' }],
      '#112233',
    );
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region.clear).toBe(false);
      const lines = region.content as readonly (readonly unknown[])[];
      expect(lines).toHaveLength(region.rect.height);
      expect(lines[0]).toHaveLength(region.rect.width);
    }
  });
});
