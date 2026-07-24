import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/utils/appearance-effects';
import {
  applySkyToLetterboxRegions,
  letterboxArea,
  facingRimSide,
  noteGoalCompletionMeteorBurst,
  noteMeteorEasterEggClick,
  paintStageLetterboxSky,
  pointInLetterboxBands,
  resetMeteorEasterEggForTests,
  resetLetterboxSkyRegionCacheForTests,
  resolveLetterboxSideGutters,
  resolveMeteorMotionParams,
  resolveStageHoleFromBands,
  spawnAndTarget,
  spawnOutsideScreen,
  resolveDebrisShardParams,
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
    resetMeteorEasterEggForTests();
    resetLetterboxSkyRegionCacheForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
  });

  afterEach(() => {
    resetMeteorEasterEggForTests();
    resetLetterboxSkyRegionCacheForTests();
    vi.useRealTimers();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function ultrawideBands() {
    const layout = resolveStageLayout({ width: 200, height: 80 });
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

  it('uses disjoint S/M/L speed and burst envelopes', () => {
    const sample = (size: 's' | 'm' | 'l') => {
      const speeds: number[] = [];
      const bursts: number[] = [];
      for (let i = 0; i < 80; i++) {
        const p = resolveMeteorMotionParams(size, true, i * 97 + 3, i);
        speeds.push(p.speed);
        bursts.push(p.burstScale);
      }
      return {
        minSpeed: Math.min(...speeds),
        maxSpeed: Math.max(...speeds),
        minBurst: Math.min(...bursts),
        maxBurst: Math.max(...bursts),
      };
    };
    const s = sample('s');
    const m = sample('m');
    const l = sample('l');
    expect(s.maxSpeed).toBeLessThan(m.minSpeed);
    expect(m.maxSpeed).toBeLessThan(l.minSpeed);
    expect(s.maxBurst).toBeLessThan(m.minBurst);
    expect(m.maxBurst).toBeLessThan(l.minBurst);
  });

  it('spawns outside the screen and aims only at the facing rim', () => {
    const bands = ultrawideBands();
    const hole = resolveStageHoleFromBands(bands, 200, 80)!;
    const sectors = ['n', 'e', 's', 'w', 'nw', 'ne', 'sw', 'se'] as const;
    for (const sector of sectors) {
      for (let i = 0; i < 24; i++) {
        const spawn = spawnOutsideScreen(sector, 200, 80, hole, i * 13 + 5, i);
        expect(
          spawn.x < 0 || spawn.x > 199 || spawn.y < 0 || spawn.y > 79,
          `${sector} spawn stays off-screen`,
        ).toBe(true);
        const path = spawnAndTarget(sector, hole, 200, 80, i * 13 + 5, i);
        const side = facingRimSide(sector);
        const nearFacing =
          side === 0
            ? path.impactY < hole.y0 + 1
            : side === 1
              ? path.impactX > hole.x1 - 2
              : side === 2
                ? path.impactY > hole.y1 - 2
                : path.impactX < hole.x0 + 1;
        expect(nearFacing).toBe(true);
        // Aim vector must not start inside the hole.
        expect(
          path.startX >= hole.x0 &&
            path.startX < hole.x1 &&
            path.startY >= hole.y0 &&
            path.startY < hole.y1,
        ).toBe(false);
      }
    }
  });

  it('never paints meteor heads inside the stage hole', () => {
    const bands = ultrawideBands();
    const hole = resolveStageHoleFromBands(bands, 200, 80)!;
    for (let t = 0; t < 10_000; t += 35) {
      const cells = paintStageLetterboxSky({
        bands,
        cols: 200,
        rows: 80,
        nowMs: 40_000 + t,
        appearance: premiumAmbient,
        freeze: false,
      });
      for (const c of cells) {
        if (c.char !== '◆' && c.char !== '◈' && c.char !== '⬤') continue;
        expect(
          c.x >= hole.x0 && c.x < hole.x1 && c.y >= hole.y0 && c.y < hole.y1,
        ).toBe(false);
      }
    }
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

  it('flings zero-g radial debris streaks through letterbox gutters', () => {
    const bands = ultrawideBands();
    const hole = resolveStageHoleFromBands(bands, 200, 80)!;
    const isDebris = (ch: string) =>
      ch === '*' || ch === '+' || ch === '✧' || ch === '✦' || ch === '˚';
    let sawTrail = false;
    let sawAbove = false;
    let sawBelow = false;
    let sawLeft = false;
    let sawRight = false;
    let maxDistFromImpactPad = 0;
    for (let t = 0; t < 16_000; t += 30) {
      const cells = paintStageLetterboxSky({
        bands,
        cols: 200,
        rows: 80,
        nowMs: 110_000 + t,
        appearance: premiumAmbient,
        freeze: false,
      });
      // Approximate impact as nearest rim cells carrying a flash/debris cluster.
      for (const c of cells) {
        if (!isDebris(c.char)) continue;
        expect(
          c.x >= hole.x0 && c.x < hole.x1 && c.y >= hole.y0 && c.y < hole.y1,
        ).toBe(false);
        if (c.char === '*' || c.char === '˚') sawTrail = true;
        if (c.y < hole.y0) sawAbove = true;
        if (c.y >= hole.y1) sawBelow = true;
        if (c.x < hole.x0) sawLeft = true;
        if (c.x >= hole.x1) sawRight = true;
        const midX = (hole.x0 + hole.x1) / 2;
        const midY = (hole.y0 + hole.y1) / 2;
        maxDistFromImpactPad = Math.max(
          maxDistFromImpactPad,
          Math.hypot(c.x - midX, c.y - midY),
        );
      }
    }
    expect(sawTrail).toBe(true);
    // Must fan in multiple cardinal gutters — not just "fall" downward.
    const directions = [sawAbove, sawBelow, sawLeft, sawRight].filter(Boolean).length;
    expect(directions).toBeGreaterThanOrEqual(3);
    expect(maxDistFromImpactPad).toBeGreaterThan(12);
  });

  it('keeps S/M/L debris speed and streak envelopes disjoint', () => {
    const sample = (size: 's' | 'm' | 'l') => {
      const speeds: number[] = [];
      const streaks: number[] = [];
      const angs: number[] = [];
      const count = size === 's' ? 10 : size === 'm' ? 24 : 48;
      const scale = size === 's' ? 0.65 : size === 'm' ? 1.3 : 2.2;
      for (let i = 0; i < 60; i++) {
        const p = resolveDebrisShardParams(size, true, i * 17 + 3, i, count, scale);
        speeds.push(p.speed);
        streaks.push(p.streakLen);
        angs.push(((p.ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
      }
      return {
        minSpeed: Math.min(...speeds),
        maxSpeed: Math.max(...speeds),
        minStreak: Math.min(...streaks),
        maxStreak: Math.max(...streaks),
        angSpan: Math.max(...angs) - Math.min(...angs),
      };
    };
    const s = sample('s');
    const m = sample('m');
    const l = sample('l');
    expect(s.maxSpeed).toBeLessThan(m.minSpeed);
    expect(m.maxSpeed).toBeLessThan(l.minSpeed);
    expect(s.maxStreak).toBeLessThanOrEqual(m.minStreak);
    expect(m.maxStreak).toBeLessThanOrEqual(l.minStreak);
    // Spokes cover most of a full circle.
    expect(s.angSpan).toBeGreaterThan(Math.PI);
    expect(l.angSpan).toBeGreaterThan(Math.PI * 1.5);
  });

  it('arms a planet-class meteor after three quick clicks', () => {
    const bands = ultrawideBands();
    expect(noteMeteorEasterEggClick(1_000)).toBe(false);
    expect(noteMeteorEasterEggClick(1_120)).toBe(false);
    expect(noteMeteorEasterEggClick(1_240)).toBe(true);
    let maxCells = 0;
    let sawBigHead = false;
    for (let t = 0; t < 4_000; t += 40) {
      const cells = paintStageLetterboxSky({
        bands,
        cols: 200,
        rows: 80,
        nowMs: 100_000 + t,
        appearance: premiumAmbient,
        freeze: false,
      });
      maxCells = Math.max(maxCells, cells.length);
      if (cells.some((c) => c.char === '⬤')) sawBigHead = true;
    }
    expect(sawBigHead).toBe(true);
    // Apocalypse debris + secondary flashes should dwarf a quiet ambient frame.
    const quiet = paintStageLetterboxSky({
      bands,
      cols: 200,
      rows: 80,
      nowMs: 200_000,
      appearance: premiumAmbient,
      freeze: true,
    });
    expect(maxCells).toBeGreaterThan(quiet.length + 40);
  });

  it('arms an apocalypse meteor on goal completion and blocks duplicate arming', () => {
    const bands = ultrawideBands();
    // First completion arms the burst.
    expect(noteGoalCompletionMeteorBurst(1_000)).toBe(true);
    // A second completion while the apocalypse is still armed is a no-op.
    expect(noteGoalCompletionMeteorBurst(1_120)).toBe(false);
    let sawBigHead = false;
    for (let t = 0; t < 4_000; t += 40) {
      const cells = paintStageLetterboxSky({
        bands,
        cols: 200,
        rows: 80,
        nowMs: 100_000 + t,
        appearance: premiumAmbient,
        freeze: false,
      });
      if (cells.some((c) => c.char === '⬤')) sawBigHead = true;
    }
    expect(sawBigHead).toBe(true);
    // After the burst resolves and state resets, a later completion re-arms.
    resetMeteorEasterEggForTests();
    expect(noteGoalCompletionMeteorBurst(200_000)).toBe(true);
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
