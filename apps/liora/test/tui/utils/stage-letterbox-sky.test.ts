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
  resolveLetterboxSideGutters,
  resolveStageHoleFromBands,
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

  const premiumAmbient = {
    ...DEFAULT_APPEARANCE_PREFERENCES,
    profile: 'premium' as const,
    particles: 'ambient' as const,
  };

  it('keeps painted cells inside letterbox bands only', () => {
    const bands = ultrawideBands();
    expect(letterboxArea(bands)).toBeGreaterThan(24);
    const cells = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 12_000,
      appearance: premiumAmbient,
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
    const appearance = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
    };
    // Freeze showers so only the quantized starfield is compared. Twinkle uses
    // a coarse frozen bucket; +40ms must be bit-identical.
    const a = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 12_000,
      appearance,
      freeze: true,
    });
    const b = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 12_000 + 40,
      appearance,
      freeze: true,
    });
    expect(a.length).toBeGreaterThan(8);
    expect(a).toEqual(b);
  });

  it('freezes shooting stars but can keep static star dust', () => {
    const bands = ultrawideBands();
    const a = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 20_000,
      appearance: premiumAmbient,
      freeze: true,
    });
    const b = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 20_000 + 500,
      appearance: premiumAmbient,
      freeze: true,
    });
    expect(a).toEqual(b);
    expect(a.every((c) => c.char !== '◆' && c.char !== '◈' && c.char !== '⬤')).toBe(true);
  });

  it('moves shooting-star heads across time when not frozen', () => {
    const bands = ultrawideBands();
    const a = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 30_000,
      appearance: premiumAmbient,
      freeze: false,
    });
    const b = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 30_000 + 400,
      appearance: premiumAmbient,
      freeze: false,
    });
    const heads = (cells: typeof a) =>
      cells
        .filter((c) => c.char === '◆' || c.char === '◈' || c.char === '⬤')
        .map((c) => `${c.x},${c.y}`)
        .sort()
        .join('|');
    if (heads(a).length > 0 || heads(b).length > 0) {
      expect(heads(a)).not.toBe(heads(b));
    } else {
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

  it('resolves a stage hole surrounded by letterbox bands', () => {
    const bands = ultrawideBands();
    const hole = resolveStageHoleFromBands(bands, 200, 80);
    expect(hole).toBeDefined();
    expect(hole!.x1).toBeGreaterThan(hole!.x0);
    expect(hole!.y1).toBeGreaterThan(hole!.y0);
    expect(pointInLetterboxBands(bands, hole!.x0, hole!.y0)).toBe(false);
  });

  it('shows meteor heads inbound from top, bottom, and side gutters', () => {
    const bands = ultrawideBands();
    const hole = resolveStageHoleFromBands(bands, 200, 80)!;
    let sawTop = false;
    let sawBottom = false;
    let sawSide = false;
    for (let t = 0; t < 12_000; t += 30) {
      const cells = paintStageLetterboxSky({
        bands,
        cols: 200,
        rows: 80,
        nowMs: 50_000 + t,
        appearance: premiumAmbient,
        freeze: false,
      });
      for (const c of cells) {
        if (c.char !== '◆' && c.char !== '◈' && c.char !== '⬤') continue;
        if (c.y < hole.y0) sawTop = true;
        if (c.y >= hole.y1) sawBottom = true;
        if (c.x < hole.x0 || c.x >= hole.x1) sawSide = true;
      }
      if (sawTop && sawBottom && sawSide) break;
    }
    expect(sawTop).toBe(true);
    expect(sawBottom).toBe(true);
    expect(sawSide).toBe(true);
  });

  it('uses diagonal trail glyphs on angled inbound paths', () => {
    const bands = ultrawideBands();
    let sawDiag = false;
    for (let t = 0; t < 8_000; t += 40) {
      const cells = paintStageLetterboxSky({
        bands,
        cols: 200,
        rows: 80,
        nowMs: 70_000 + t,
        appearance: premiumAmbient,
        freeze: false,
      });
      for (const c of cells) {
        if (c.char === '╲' || c.char === '╱') sawDiag = true;
      }
      if (sawDiag) break;
    }
    expect(sawDiag).toBe(true);
  });

  it('detonates mega bursts with shock-ring and debris glyphs on the rim', () => {
    const bands = ultrawideBands();
    const hole = resolveStageHoleFromBands(bands, 200, 80)!;
    let sawFlash = false;
    let sawRing = false;
    let sawDebris = false;
    let nearRim = false;
    for (let t = 0; t < 14_000; t += 25) {
      const cells = paintStageLetterboxSky({
        bands,
        cols: 200,
        rows: 80,
        nowMs: 90_000 + t,
        appearance: premiumAmbient,
        freeze: false,
      });
      for (const c of cells) {
        if (c.char === '✹' || c.char === '⬤') sawFlash = true;
        if (c.char === '░' || c.char === '▒' || c.char === '▓') sawRing = true;
        if (c.char === '*' || c.char === '+' || c.char === '✧') sawDebris = true;
        const pad = 3;
        const onRim =
          (Math.abs(c.x - hole.x0) <= pad ||
            Math.abs(c.x - (hole.x1 - 1)) <= pad ||
            Math.abs(c.y - hole.y0) <= pad ||
            Math.abs(c.y - (hole.y1 - 1)) <= pad) &&
          pointInLetterboxBands(bands, c.x, c.y);
        if (onRim && (c.char === '✹' || c.char === '░' || c.char === '✦')) nearRim = true;
      }
      if (sawFlash && sawRing && sawDebris && nearRim) break;
    }
    expect(sawFlash).toBe(true);
    expect(sawRing).toBe(true);
    expect(sawDebris).toBe(true);
    expect(nearRim).toBe(true);
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
