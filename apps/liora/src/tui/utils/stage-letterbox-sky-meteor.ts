import { hash2 } from '#/tui/utils/night-sky';
import {
  clamp,
  insideHole,
  type StageHole,
} from '#/tui/utils/stage-letterbox-sky-geometry';

/** Distinct from star glyphs so freeze tests can tell showers apart. */
export const HEAD_S = '◆';
export const HEAD_M = '◈';
export const HEAD_L = '⬤';
export const SHOOTING_TAIL = '·';

export type MeteorSize = 's' | 'm' | 'l';
export type SpawnSector = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const SECTORS: readonly SpawnSector[] = ['n', 'e', 's', 'w', 'nw', 'ne', 'sw', 'se'];

/** Triple-click easter egg: planet-scale inbound meteor. */
const EASTER_CLICK_WINDOW_MS = 650;

type ApocalypseState = {
  readonly seed: number;
  readonly sector: SpawnSector;
  /** Latched on first paint so the strike starts immediately. */
  startPhase: number | undefined;
};

let easterClickMs: number[] = [];
let apocalypse: ApocalypseState | undefined;

/** Test helper — clear easter-egg / apocalypse state. */
export function resetMeteorEasterEggForTests(): void {
  easterClickMs = [];
  apocalypse = undefined;
}

/**
 * Record a left-click. Three presses within {@link EASTER_CLICK_WINDOW_MS}
 * arm one planet-collision meteor. Returns true when armed.
 */
export function noteMeteorEasterEggClick(nowMs: number): boolean {
  const now = Math.floor(nowMs);
  easterClickMs.push(now);
  easterClickMs = easterClickMs.filter((t) => now - t <= EASTER_CLICK_WINDOW_MS);
  if (easterClickMs.length < 3) return false;
  easterClickMs = [];
  return armApocalypseMeteor(nowMs);
}

/** Arm one planet-collision meteor; returns false if a strike is already active. */
function armApocalypseMeteor(nowMs: number): boolean {
  if (apocalypse !== undefined) return false;
  const now = Math.floor(nowMs);
  const seed = hash2(now ^ 0x5f3759df, 9091);
  apocalypse = {
    seed,
    startPhase: undefined,
    sector: SECTORS[seed % SECTORS.length]!,
  };
  return true;
}

/**
 * Arm one planet-collision meteor as a goal-completion celebration. Driven by a
 * success event rather than the triple-click easter egg; the strike fires the
 * next time the letterbox stage sky paints. Returns false if already in flight.
 */
export function noteGoalCompletionMeteorBurst(nowMs: number): boolean {
  return armApocalypseMeteor(nowMs);
}

export const APOCALYPSE_FLIGHT_TICKS = 28;
export const APOCALYPSE_BURST_TICKS = 36;

export function getApocalypseState(): ApocalypseState | undefined {
  return apocalypse;
}

export function clearApocalypseState(): void {
  apocalypse = undefined;
}

export function latchApocalypsePhase(phase: number): void {
  if (apocalypse !== undefined && apocalypse.startPhase === undefined) {
    apocalypse.startPhase = phase;
  }
}

export function positiveModulo(n: number, m: number): number {
  if (m <= 0) return 0;
  return ((n % m) + m) % m;
}

export function midGlyphForVelocity(dx: number, dy: number): string {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 0.08) return '│';
  if (ay < 0.08) return '─';
  return dx * dy >= 0 ? '╲' : '╱';
}

export function headForSize(size: MeteorSize): string {
  if (size === 'l') return HEAD_L;
  if (size === 'm') return HEAD_M;
  return HEAD_S;
}

/** Deterministic 0..1 from hash pair. */
function hash01(a: number, b: number): number {
  return (hash2(a, b) % 10_000) / 10_000;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function pickSize(premium: boolean, h: number, m: number): MeteorSize {
  const roll = hash2(h, m + 41) % 100;
  // Chaotic skew: more rare heavies, but when they land they read huge.
  if (premium) {
    if (roll < 16) return 'l';
    if (roll < 52) return 'm';
    return 's';
  }
  if (roll < 8) return 'l';
  if (roll < 42) return 'm';
  return 's';
}

/**
 * Non-overlapping class envelopes + within-class chaos.
 * Occasional L spikes push speed/burst past the normal L ceiling.
 */
export interface MeteorMotionParams {
  readonly size: MeteorSize;
  readonly speed: number;
  readonly trailLen: number;
  readonly explodeTicks: number;
  readonly burstScale: number;
  readonly debrisCount: number;
}

export function resolveMeteorMotionParams(
  size: MeteorSize,
  premium: boolean,
  h: number,
  m: number,
): MeteorMotionParams {
  const u = (salt: number) => hash01(h + salt, m * 17 + salt);
  const spike = size === 'l' && u(3) < (premium ? 0.22 : 0.12);
  const speed = (() => {
    if (size === 's') return lerp(0.42, 0.72, u(11)) * (premium ? 1 : 0.9);
    if (size === 'm') return lerp(0.95, 1.35, u(11)) * (premium ? 1 : 0.92);
    const base = lerp(1.55, 2.05, u(11));
    return (spike ? base * lerp(1.25, 1.55, u(12)) : base) * (premium ? 1 : 0.94);
  })();
  const trailLen = (() => {
    if (size === 's') return Math.round(lerp(4, 7, u(21)));
    if (size === 'm') return Math.round(lerp(10, 14, u(21)));
    return Math.round(lerp(16, spike ? 24 : 20, u(21)));
  })();
  const explodeTicks = (() => {
    if (size === 's') return Math.round(lerp(10, 14, u(31)));
    if (size === 'm') return Math.round(lerp(20, 26, u(31)));
    return Math.round(lerp(32, spike ? 48 : 40, u(31)));
  })();
  const burstScale = (() => {
    if (size === 's') return lerp(0.5, 0.8, u(41));
    if (size === 'm') return lerp(1.15, 1.55, u(41));
    return spike ? lerp(2.6, 3.4, u(41)) : lerp(1.95, 2.5, u(41));
  })();
  const debrisCount = (() => {
    const mul = premium ? 1 : 0.72;
    if (size === 's') return Math.floor(lerp(6, 11, u(51)) * mul);
    if (size === 'm') return Math.floor(lerp(20, 30, u(51)) * mul);
    return Math.floor(lerp(40, spike ? 64 : 54, u(51)) * mul);
  })();
  return { size, speed, trailLen, explodeTicks, burstScale, debrisCount };
}

/**
 * Zero-g radial debris: full 360° launch with size-scaled speed / streak length.
 * No gravity — shards coast in straight lines (mild y aspect matches terminal cells).
 */
export interface DebrisShardParams {
  readonly ang: number;
  readonly speed: number;
  readonly streakLen: number;
  readonly birthFrac: number;
}

export function resolveDebrisShardParams(
  size: MeteorSize,
  premium: boolean,
  seed: number,
  i: number,
  debrisCount: number,
  burstScale: number,
): DebrisShardParams {
  const u = (salt: number) => hash01(seed + salt, i * 19 + salt);
  // Even spokes + chaos so every burst covers all directions.
  const spoke = (i / Math.max(1, debrisCount)) * Math.PI * 2;
  const jitter =
    (u(3) - 0.5) * (size === 's' ? 0.55 : size === 'm' ? 0.95 : 1.25);
  const ang = spoke + jitter;
  const speed = (() => {
    if (size === 's') return (0.28 + u(11) * 0.38) * burstScale;
    if (size === 'm') return (0.62 + u(11) * 0.55) * burstScale;
    const hyper = u(12) < (premium ? 0.28 : 0.16);
    const base = (0.95 + u(11) * 0.85) * burstScale;
    return hyper ? base * (1.35 + u(13) * 0.45) : base;
  })();
  const streakLen = (() => {
    if (size === 's') return premium ? 2 : 1;
    if (size === 'm') return Math.round(3 + u(21) * 1.5);
    return Math.round((premium ? 5 : 4) + u(21) * 2.5);
  })();
  const birthFrac = u(31) * (size === 's' ? 0.22 : size === 'm' ? 0.18 : 0.14);
  return { ang, speed, streakLen, birthFrac };
}

export function facingRimSide(sector: SpawnSector): 0 | 1 | 2 | 3 {
  if (sector === 'n' || sector === 'nw' || sector === 'ne') return 0;
  if (sector === 'e') return 1;
  if (sector === 's' || sector === 'sw' || sector === 'se') return 2;
  return 3;
}

export function rimPoint(
  hole: StageHole,
  side: 0 | 1 | 2 | 3,
  t: number,
): { x: number; y: number } {
  const tx = clamp(t, 0.05, 0.95);
  const xSpan = Math.max(0, hole.x1 - hole.x0 - 1);
  const ySpan = Math.max(0, hole.y1 - hole.y0 - 1);
  switch (side) {
    case 0:
      return { x: hole.x0 + tx * xSpan, y: hole.y0 - 0.55 };
    case 1:
      return { x: hole.x1 - 0.45, y: hole.y0 + tx * ySpan };
    case 2:
      return { x: hole.x0 + tx * xSpan, y: hole.y1 - 0.45 };
    case 3:
      return { x: hole.x0 - 0.55, y: hole.y0 + tx * ySpan };
  }
}

/** Spawn strictly outside the terminal (never inside the stage hole). */
export function spawnOutsideScreen(
  sector: SpawnSector,
  cols: number,
  rows: number,
  hole: StageHole,
  h: number,
  m: number,
): { x: number; y: number } {
  const t = hash01(h, m + 7);
  const depth = 3 + (hash2(h, m + 9) % 5);
  const midY = lerp(hole.y0 + 1, Math.max(hole.y0 + 1, hole.y1 - 2), hash01(h, m + 13));
  switch (sector) {
    case 'n':
      return { x: t * (cols - 1), y: -depth };
    case 's':
      return { x: t * (cols - 1), y: rows - 1 + depth };
    case 'w':
      return { x: -depth, y: midY };
    case 'e':
      return { x: cols - 1 + depth, y: midY };
    case 'nw':
      return { x: -depth, y: -depth };
    case 'ne':
      return { x: cols - 1 + depth, y: -depth };
    case 'sw':
      return { x: -depth, y: rows - 1 + depth };
    case 'se':
      return { x: cols - 1 + depth, y: rows - 1 + depth };
  }
}

/**
 * Screen-exterior spawn → facing rim only (never aim through the stage hole).
 * Angle variety comes from edge/rim position, not heading twist.
 */
export function spawnAndTarget(
  sector: SpawnSector,
  hole: StageHole,
  cols: number,
  rows: number,
  h: number,
  m: number,
): { startX: number; startY: number; impactX: number; impactY: number } {
  const start = spawnOutsideScreen(sector, cols, rows, hole, h, m);
  const side = facingRimSide(sector);
  const impact = rimPoint(hole, side, hash01(h, m + 29));
  return {
    startX: start.x,
    startY: start.y,
    impactX: impact.x,
    impactY: impact.y,
  };
}

export function meteorSectors(): readonly SpawnSector[] {
  return SECTORS;
}
