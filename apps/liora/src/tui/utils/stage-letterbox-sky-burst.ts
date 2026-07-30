import { mixHexColor } from '#/tui/renderer';
import {
  clamp,
  insideHole,
  type StageHole,
} from '#/tui/utils/stage-letterbox-sky-geometry';
import { resolveDebrisShardParams, type MeteorSize } from '#/tui/utils/stage-letterbox-sky-meteor';

const FLASH_CORE = ['✹', '◈', '⬤', '✦'] as const;
const RING_GLYPHS = ['░', '▒', '▓', '✦', '˚'] as const;
const DEBRIS_GLYPHS = ['✦', '*', '+', '˚', '·', '✧'] as const;

export function snapImpactToLetterbox(
  ix: number,
  iy: number,
  hole: StageHole,
  cols: number,
  rows: number,
): { x: number; y: number } {
  let x = clamp(ix, 0, cols - 1);
  let y = clamp(iy, 0, rows - 1);
  if (x >= hole.x0 && x < hole.x1 && y >= hole.y0 && y < hole.y1) {
    const dl = x - hole.x0 + 1;
    const dr = hole.x1 - x;
    const dt = y - hole.y0 + 1;
    const db = hole.y1 - y;
    const min = Math.min(dl, dr, dt, db);
    if (min === dl) x = hole.x0 - 1;
    else if (min === dr) x = hole.x1;
    else if (min === dt) y = hole.y0 - 1;
    else y = hole.y1;
  }
  return { x: clamp(x, 0, cols - 1), y: clamp(y, 0, rows - 1) };
}

export function paintRimMegaBurst(input: {
  readonly put: (x: number, y: number, char: string, fg: string, bold?: boolean) => void;
  readonly ix: number;
  readonly iy: number;
  readonly age: number;
  readonly life: number;
  readonly seed: number;
  readonly size: MeteorSize;
  readonly burstScale: number;
  readonly debrisCount: number;
  readonly hole: StageHole;
  readonly premium: boolean;
  readonly glow: string;
  readonly primary: string;
  readonly particle: string;
  readonly muted: string;
}): void {
  const {
    put,
    ix,
    iy,
    age,
    life,
    seed,
    size,
    burstScale,
    debrisCount,
    hole,
    premium,
    glow,
    primary,
    particle,
    muted,
  } = input;
  if (age < 0 || age > life) return;
  const t = age / life;
  const scale = burstScale;
  const coreFg = mixHexColor(glow, primary, 0.55);

  // 1) Flash core — L fills a bigger cross; S is a single hot cell.
  if (t < 0.18) {
    const glyph = FLASH_CORE[Math.min(FLASH_CORE.length - 1, Math.floor(t * 20))] ?? '✹';
    put(ix, iy, glyph, coreFg, true);
    if (size !== 's') {
      const arm = size === 'l' ? 2 : 1;
      for (let a = 1; a <= arm; a++) {
        put(ix + a, iy, '✦', coreFg, true);
        put(ix - a, iy, '✦', coreFg, true);
        put(ix, iy + a, '✧', mixHexColor(glow, primary, 0.35), true);
        put(ix, iy - a, '✧', mixHexColor(glow, primary, 0.35), true);
      }
    }
  }

  // 2) Expanding shock ring
  if (t < 0.6) {
    const r = (0.8 + t * 5.5) * scale;
    const ringSteps = Math.max(8, Math.floor(12 * scale + 4));
    for (let i = 0; i < ringSteps; i++) {
      const ang = (i / ringSteps) * Math.PI * 2 + seed * 0.01;
      const x = Math.round(ix + Math.cos(ang) * r);
      const y = Math.round(iy + Math.sin(ang) * r * 0.55);
      if (insideHole(x, y, hole)) continue;
      const glyph = RING_GLYPHS[(seed + i) % RING_GLYPHS.length] ?? '░';
      const fg =
        t < 0.25
          ? mixHexColor(glow, primary, 0.4)
          : t < 0.45
            ? mixHexColor(particle, glow, 0.5)
            : muted;
      put(x, y, glyph, fg, t < 0.3 && premium);
    }
  }

  // 3) Zero-g radial debris — full 360° long streaks (letterbox-clipped only).
  // Terminal cells are taller than wide; 0.62 y scale keeps the fan circular.
  const cellY = 0.62;
  for (let i = 0; i < debrisCount; i++) {
    const shard = resolveDebrisShardParams(
      size,
      premium,
      seed,
      i,
      debrisCount,
      scale,
    );
    const birthTick = shard.birthFrac * life;
    const flight = age - birthTick;
    if (flight < 0) continue;
    const localT = flight / Math.max(0.01, life - birthTick);
    if (localT > 1) continue;
    // Late fade: thin the outer cloud without a "drop to the floor" feel.
    if (localT > 0.9 && (i + seed) % 4 !== 0) continue;

    const vx = Math.cos(shard.ang) * shard.speed;
    const vy = Math.sin(shard.ang) * shard.speed * cellY;
    const headX = ix + vx * flight;
    const headY = iy + vy * flight;

    const headFg =
      localT < 0.25
        ? mixHexColor(glow, primary, 0.5)
        : localT < 0.55
          ? mixHexColor(particle, glow, 0.45)
          : muted;
    const midFg = mixHexColor(particle, muted, 0.35);
    const headGlyph = DEBRIS_GLYPHS[(seed + i) % DEBRIS_GLYPHS.length] ?? '*';
    const streakLen = shard.streakLen;

    for (let s = 0; s <= streakLen; s++) {
      const x = Math.round(headX - vx * s * 0.85);
      const y = Math.round(headY - vy * s * 0.85);
      if (insideHole(x, y, hole)) continue;
      const along = s / Math.max(1, streakLen);
      if (s === 0) {
        put(x, y, headGlyph, headFg, localT < 0.3 && premium && size !== 's');
      } else if (along < 0.4) {
        put(x, y, '*', midFg, localT < 0.2 && premium);
      } else if (along < 0.7) {
        put(x, y, '·', muted);
      } else {
        put(x, y, '˚', muted);
      }
    }
  }

  // 4) Afterglow dust near impact
  if (t > 0.45) {
    const fade = (t - 0.45) / 0.55;
    const dust = Math.max(3, Math.floor(4 * scale));
    for (let i = 0; i < dust; i++) {
      const ox = ((seed + i * 13) % 7) - 3;
      const oy = ((seed + i * 17) % 5) - 2;
      const x = ix + ox;
      const y = iy + oy;
      if (insideHole(x, y, hole)) continue;
      if (fade > 0.85 && i % 2 === 0) continue;
      put(x, y, '·', muted, false);
    }
  }
}
