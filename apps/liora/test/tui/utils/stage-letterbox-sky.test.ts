import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import {
  letterboxArea,
  paintStageLetterboxSky,
  pointInLetterboxBands,
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

  it('keeps painted cells inside letterbox bands only', () => {
    const bands = ultrawideBands();
    expect(letterboxArea(bands)).toBeGreaterThan(24);
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
      expect(pointInLetterboxBands(bands, c.x, c.y)).toBe(true);
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
    const gutters = resolveLetterboxSideGutters(bands, 200);
    const inSideGutter = (x: number) => gutters.some((g) => x >= g.x0 && x < g.x1);
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
    // Side gutters carry shooting stars; top/bottom dust should stay bit-identical
    // inside one twinkle bucket.
    const starSig = (cells: typeof a) =>
      cells
        .filter((c) => !inSideGutter(c.x))
        .map((c) => `${c.x},${c.y},${c.char},${c.fg}`)
        .sort()
        .join('|');
    expect(starSig(a)).toBe(starSig(b));
  });

  it('freezes shooting stars but can keep static star dust', () => {
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
    // Freeze pins twinkle clock to a coarse bucket — identical paints.
    expect(a).toEqual(b);
    expect(a.every((c) => c.char !== '◆')).toBe(true);
  });

  it('moves shooting-star heads across time when not frozen', () => {
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
    const heads = (cells: typeof a) =>
      cells
        .filter((c) => c.char === '◆')
        .map((c) => `${c.x},${c.y}`)
        .sort()
        .join('|');
    // At least one frame in the window should show a shooting star; if both empty, skip strictness.
    if (heads(a).length > 0 || heads(b).length > 0) {
      expect(heads(a)).not.toBe(heads(b));
    } else {
      // Still expect starfield motion/twinkle difference in the full paint set.
      const sig = (cells: typeof a) => cells.map((c) => `${c.x},${c.y},${c.fg}`).join('|');
      expect(sig(a)).not.toBe(sig(b));
    }
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

  it('lets shooting-star heads reach the bottom row inside side gutters', () => {
    const bands = ultrawideBands();
    const gutters = resolveLetterboxSideGutters(bands, 200);
    expect(gutters.length).toBeGreaterThan(0);
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'ambient' as const,
    };
    let maxHeadY = -1;
    let sawBottomHead = false;
    for (let t = 0; t < 8_000; t += 40) {
      const cells = paintStageLetterboxSky({
        bands,
        cols: 200,
        rows: 80,
        nowMs: 50_000 + t,
        appearance,
        freeze: false,
      });
      for (const c of cells) {
        if (c.char !== '◆') continue;
        maxHeadY = Math.max(maxHeadY, c.y);
        const inGutter = gutters.some((g) => c.x >= g.x0 && c.x < g.x1);
        expect(inGutter).toBe(true);
        if (c.y >= 79) sawBottomHead = true;
      }
    }
    expect(maxHeadY).toBeGreaterThanOrEqual(79);
    expect(sawBottomHead).toBe(true);
  });
});
