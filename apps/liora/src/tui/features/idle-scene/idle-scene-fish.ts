/**
 * Jewel Tank fish — glyph selection/tail animation, per-cell ornamental
 * shading, the curated ambient school, and the sim-snapshot (fish/food/fx)
 * painters used when the interactive physics sim is active.
 *
 * Split out of `idle-scene.ts`; no behavior change.
 */

import { mixHexColor } from '#/tui/renderer';

import { blitAt, hash2, putCell } from '#/tui/features/idle-scene/idle-scene-canvas';
import type { AquariumPalette } from '#/tui/features/idle-scene/idle-scene-palette';
import {
  FISH_COMPACT_LEFT,
  FISH_COMPACT_RIGHT,
  FISH_LARGE_LEFT,
  FISH_LARGE_RIGHT,
  FISH_SWIM_MS,
  FISH_TAIL_MS,
  FISH_TINY,
} from '#/tui/features/idle-scene/idle-scene-sprites';
import type { IdleFish, IdleTankFx, IdleTankSnapshot } from '#/tui/features/idle-scene/idle-tank-sim';

export function resolveFishGlyphRows(
  width: number,
  availableRows: number,
  elapsedMs = 0,
): readonly string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const rows = Math.max(0, Math.trunc(availableRows));
  const facingRight = Math.sin((elapsedMs / FISH_SWIM_MS) * Math.PI * 2) >= 0;
  let base: readonly string[];
  if (safeWidth >= 36 && rows >= FISH_LARGE_RIGHT.length) {
    base = facingRight ? FISH_LARGE_RIGHT : FISH_LARGE_LEFT;
  } else if (rows >= FISH_COMPACT_RIGHT.length) {
    base = facingRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
  } else {
    const compact = facingRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
    base = compact.slice(0, Math.max(1, Math.min(compact.length, rows)));
  }
  return applyFishTail(base, elapsedMs, facingRight);
}

/** Soft cheek / fin pulse — ≥4 frames, never a hard blink. Multi-row aware. */
export function applyFishTail(
  rows: readonly string[],
  elapsedMs: number,
  facingRight = true,
): string[] {
  if (rows.length === 0) return [];
  const frame = Math.floor(elapsedMs / FISH_TAIL_MS) % 4;
  const out = rows.map((line) => line);
  const bodyIdx = out.findIndex((line) => /[<>]/.test(line));
  if (bodyIdx < 0) return out;
  const line = out[bodyIdx];
  if (line === undefined) return out;

  // Clownfish — cheek / stripe pulse (fixed width).
  if (line.includes('═((º═>') || line.includes('<═º))═') || line.includes('═(º═>') || line.includes('═((º≈>')) {
    const cheeks = facingRight
      ? (['>═((º═>', '>═(º═> ', '>═((º═>', '>═((º≈>'] as const)
      : (['<═º))═<', '<═º)═< ', '<═º))═<', '<≈º))═<'] as const);
    out[bodyIdx] = cheeks[frame] ?? cheeks[0]!;
    // Animate dorsal/ventral fin rows with subtle wave.
    const finFrames = ['  /~\\  ', '  /~\\  ', '  /~~\\ ', '  /~\\  '] as const;
    const finFramesB = ['  \\~/  ', '  \\~~/ ', '  \\~/  ', '  \\~/  '] as const;
    if (bodyIdx > 0 && out[bodyIdx - 1] !== undefined && /[\\/]/.test(out[bodyIdx - 1]!)) {
      out[bodyIdx - 1] = finFrames[frame] ?? finFrames[0]!;
    }
    if (bodyIdx + 1 < out.length && out[bodyIdx + 1] !== undefined && /[\\/]/.test(out[bodyIdx + 1]!)) {
      out[bodyIdx + 1] = finFramesB[frame] ?? finFramesB[0]!;
    }
    return out;
  }

  // Betta flowing fins (2-row: crest + body).
  if (line.includes('∽((º') || line.includes('º))∽')) {
    const fins = facingRight
      ? (['∽((º≈', '∼((º≈', '∽((º∼', '≈((º∽'] as const)
      : (['≈º))∽', '∼º))∽', '∽º))∼', '∽º))≈'] as const);
    out[bodyIdx] = fins[frame] ?? fins[0]!;
    // Dorsal crest wave.
    const crestFrames = [' .~~. ', ' .~~. ', '  .~. ', ' .~~. '] as const;
    if (bodyIdx > 0 && out[bodyIdx - 1] !== undefined && /[.~]/.test(out[bodyIdx - 1]!)) {
      out[bodyIdx - 1] = crestFrames[frame] ?? crestFrames[0]!;
    }
    return out;
  }

  // Tiny neon tip flick.
  if (facingRight) {
    const tips = ['>', '◦', '>', '~'] as const;
    out[bodyIdx] = line.replace(/>\s*$/u, tips[frame] ?? '>');
  } else {
    const tips = ['<', '◦', '<', '~'] as const;
    out[bodyIdx] = line.replace(/^\s*</u, tips[frame] ?? '<');
  }
  return out;
}

/**
 * Per-cell ornamental shading — punchy bands, fin accents, specular highlight.
 * Clownfish / betta / neon lighting with bold jewel hues (not theme-muted).
 * Handles multi-row fish: fin rows (top/bottom) get translucent fin coloring.
 */
export function colorizeFishLine(
  line: string,
  kind: 'large' | 'compact' | 'tiny',
  color: 'gold' | 'sky' | 'teal' | 'soft' | 'rose',
  facingRight: boolean,
  palette: AquariumPalette,
  paint: (hex: string, text: string) => string,
  showAmbient: boolean,
  isFinRow = false,
): string {
  if (!showAmbient) return paint(palette.dim, line);

  const body =
    color === 'gold'
      ? palette.fishGold
      : color === 'sky'
        ? palette.fishSky
        : color === 'teal'
          ? palette.fishTeal
          : color === 'rose'
            ? palette.fishRose
            : palette.fishSoft;
  const hot =
    color === 'gold'
      ? mixHexColor(body, '#FFE08A', 0.55)
      : color === 'sky'
        ? mixHexColor(body, '#A5F3FC', 0.45)
        : color === 'rose'
          ? mixHexColor(body, '#FF8E98', 0.5)
          : mixHexColor(body, '#FFFFFF', 0.4);
  const stripe = color === 'gold' || color === 'teal' ? '#FFFFFF' : mixHexColor(body, '#FFFFFF', 0.85);
  const shade = mixHexColor(body, '#1A0A08', 0.42);
  const ink = '#0A0E14';
  const finAccent =
    color === 'gold'
      ? mixHexColor(body, '#FF2E9A', 0.25)
      : color === 'sky'
        ? '#FF2E9A'
        : color === 'rose'
          ? mixHexColor(body, '#FF8E98', 0.35)
          : mixHexColor(palette.plantAccent, '#FFFFFF', 0.2);
  const nose = mixHexColor(body, ink, 0.35);
  const rim = mixHexColor(hot, '#FFFFFF', 0.35);

  // Fin rows (dorsal/ventral) — translucent flowing fin color.
  if (isFinRow) {
    const finHex = mixHexColor(body, finAccent, 0.55);
    const finTip = mixHexColor(finHex, '#FFFFFF', 0.3);
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === ' ') { out += ' '; continue; }
      const isEdge = ch === '/' || ch === '\\';
      out += paint(isEdge ? finTip : finHex, ch);
    }
    return out;
  }

  let bodySeen = 0;
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === ' ') {
      out += ' ';
      continue;
    }

    let hex = body;
    if (ch === '═' || ch === '≡') {
      hex = stripe;
    } else if (ch === 'º' || ch === '◦') {
      // Eye: ink with a tiny catchlight feel via bright neighbor context.
      hex = ink;
    } else if (ch === '≈' || ch === '∽' || ch === '∼' || ch === '~') {
      hex = kind === 'compact' || kind === 'tiny' ? finAccent : shade;
    } else if (ch === '(' || ch === ')') {
      bodySeen += 1;
      hex = bodySeen <= 1 ? hot : bodySeen >= 3 ? shade : body;
    } else if (ch === '>' || ch === '<') {
      const atNose = facingRight ? i === line.length - 1 : i === 0;
      const atTail = facingRight ? i === 0 : i === line.length - 1;
      if (atNose) hex = nose;
      else if (atTail) hex = kind === 'compact' ? finAccent : shade;
      else hex = rim;
    } else if (ch === '.' && kind === 'compact') {
      // Betta crest dots.
      hex = finAccent;
    }

    out += paint(hex, ch);
  }
  return out;
}

type FishColor = 'gold' | 'sky' | 'teal' | 'soft' | 'rose';

interface FishActor {
  readonly kind: 'large' | 'compact' | 'tiny';
  readonly seed: number;
  readonly speed: number;
  readonly baseYRatio: number;
  readonly phase: number;
  readonly color: FishColor;
  readonly goesRight: boolean;
}

function buildSchool(width: number, storyRows: number, premium: boolean): FishActor[] {
  // Curated cast — lead + companions, never a crowd.
  const count = premium ? (width >= 72 ? 3 : 2) : width >= 50 ? 2 : 1;
  const colors: FishColor[] = ['gold', 'rose', 'sky', 'teal', 'soft'];
  // Staggered depth bands so the lead lane stays readable.
  const bands = [0.22, 0.38, 0.3, 0.48] as const;
  const school: FishActor[] = [];
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 47 + 11, 203);
    const kind: FishActor['kind'] =
      i === 0 && storyRows >= 7 ? 'large' : i === 1 && storyRows >= 6 ? 'compact' : 'tiny';
    school.push({
      kind,
      seed,
      speed: 0.28 + (seed % 26) / 110 + (i === 0 ? 0.06 : 0),
      baseYRatio: bands[i] ?? 0.34,
      phase: (i * 0.23 + (seed % 200) / 1_000) % 1,
      color: colors[i % colors.length]!,
      goesRight: i % 2 === 0,
    });
  }
  return school;
}

function glyphForSnapshotFish(fish: IdleFish, elapsedMs: number): readonly string[] {
  const t = elapsedMs + fish.seed;
  if (fish.kind === 'large') {
    const base = fish.goesRight ? FISH_LARGE_RIGHT : FISH_LARGE_LEFT;
    return applyFishTail(base, t, fish.goesRight);
  }
  if (fish.kind === 'compact') {
    const base = fish.goesRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
    return applyFishTail(base, t, fish.goesRight);
  }
  const pair = FISH_TINY[fish.seed % FISH_TINY.length] ?? FISH_TINY[0]!;
  return applyFishTail([fish.goesRight ? pair[0] : pair[1]], t, fish.goesRight);
}

export function paintFoodFromSnapshot(
  canvas: string[],
  width: number,
  paint: (hex: string, text: string) => string,
  palette: AquariumPalette,
  food: IdleTankSnapshot['food'],
): void {
  for (const pellet of food) {
    putCell(
      canvas,
      Math.trunc(pellet.y),
      Math.trunc(pellet.x),
      width,
      paint(palette.food, '*'),
      true,
    );
  }
}

export function paintFishFromSnapshot(
  canvas: string[],
  width: number,
  elapsedMs: number,
  showAmbient: boolean,
  paint: (hex: string, text: string) => string,
  palette: AquariumPalette,
  fish: IdleTankSnapshot['fish'],
): void {
  for (const actor of fish) {
    const glyphLines = glyphForSnapshotFish(actor, elapsedMs);
    const bodyIdx = glyphLines.findIndex((l) => /[<>]/.test(l));
    const lines = glyphLines.map((line, rowIdx) => {
      const isFin = bodyIdx >= 0 && rowIdx !== bodyIdx && !/[<>]/.test(line);
      return colorizeFishLine(line, actor.kind, actor.color, actor.goesRight, palette, paint, showAmbient, isFin);
    });
    blitAt(canvas, lines, Math.trunc(actor.y), Math.trunc(actor.x), width);
  }
}

function glyphForFx(fx: IdleTankFx): string {
  const lifeT = Math.max(0, Math.min(1, fx.life / Math.max(1, fx.maxLife)));
  if (fx.kind === 'bubble') {
    if (lifeT > 0.72) return '·';
    if (lifeT > 0.4) return 'o';
    return lifeT > 0.18 ? '°' : 'O';
  }
  if (fx.kind === 'sand') {
    return lifeT > 0.5 ? '˙' : '.';
  }
  // spark — eat celebration
  if (lifeT > 0.7) return '♥';
  if (lifeT > 0.4) return '✦';
  if (lifeT > 0.2) return '˚';
  return '·';
}

function colorForFx(fx: IdleTankFx, palette: AquariumPalette): string {
  const lifeT = Math.max(0, Math.min(1, fx.life / Math.max(1, fx.maxLife)));
  if (fx.kind === 'bubble') {
    return lifeT > 0.45
      ? mixHexColor(palette.bubble, palette.shaft, 0.35)
      : mixHexColor(palette.bubble, palette.water, 0.4);
  }
  if (fx.kind === 'sand') {
    return mixHexColor(palette.coral, palette.sand, 0.35 + (1 - lifeT) * 0.35);
  }
  return lifeT > 0.55
    ? mixHexColor(palette.food, palette.plantAccent, 0.45)
    : mixHexColor(palette.shaft, palette.food, 0.4);
}

export function paintFxFromSnapshot(
  canvas: string[],
  width: number,
  paint: (hex: string, text: string) => string,
  palette: AquariumPalette,
  fx: IdleTankSnapshot['fx'],
): void {
  for (const particle of fx) {
    putCell(
      canvas,
      Math.trunc(particle.y),
      Math.trunc(particle.x),
      width,
      paint(colorForFx(particle, palette), glyphForFx(particle)),
      true,
    );
  }
}

function glyphForActor(actor: FishActor, elapsedMs: number): readonly string[] {
  const t = elapsedMs + actor.seed;
  if (actor.kind === 'large') {
    const base = actor.goesRight ? FISH_LARGE_RIGHT : FISH_LARGE_LEFT;
    return applyFishTail(base, t, actor.goesRight);
  }
  if (actor.kind === 'compact') {
    const base = actor.goesRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
    return applyFishTail(base, t, actor.goesRight);
  }
  const pair = FISH_TINY[actor.seed % FISH_TINY.length] ?? FISH_TINY[0]!;
  const tip = applyFishTail([actor.goesRight ? pair[0] : pair[1]], t, actor.goesRight);
  return tip;
}

export function paintFishSchool(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  premium: boolean,
  showAmbient: boolean,
  paint: (hex: string, text: string) => string,
  palette: AquariumPalette,
): void {
  const school = buildSchool(width, storyRows, premium);
  const floor = Math.max(2, storyRows - 2);

  for (const actor of school) {
    const travel = elapsedMs * 0.001 * actor.speed * 5.6 + actor.phase * width * 2;
    const loop = Math.max(1, width + 16);
    const x = actor.goesRight
      ? Math.floor(travel % loop) - 8
      : width + 8 - Math.floor(travel % loop);
    const bob = Math.sin(elapsedMs / FISH_SWIM_MS + actor.phase * Math.PI * 2) * 0.95;
    const y = Math.max(1, Math.min(floor - 1, Math.floor(actor.baseYRatio * floor + bob)));
    const glyphLines = glyphForActor(actor, elapsedMs);
    const bodyIdx = glyphLines.findIndex((l) => /[<>]/.test(l));
    const lines = glyphLines.map((line, rowIdx) => {
      const isFin = bodyIdx >= 0 && rowIdx !== bodyIdx && !/[<>]/.test(line);
      return colorizeFishLine(line, actor.kind, actor.color, actor.goesRight, palette, paint, showAmbient, isFin);
    });
    blitAt(canvas, lines, y, x, width);
  }
}
