export type IdleFishMode = 'wander' | 'seek';

export interface IdleFish {
  id: number;
  kind: 'large' | 'compact' | 'tiny';
  color: 'gold' | 'sky' | 'teal' | 'soft' | 'rose';
  x: number;
  y: number;
  vx: number;
  mode: IdleFishMode;
  targetFoodId: number | null;
  cooldownUntilMs: number;
  goesRight: boolean;
  seed: number;
}

export interface IdleFood {
  id: number;
  x: number;
  y: number;
  vy: number;
}

/** Short-lived tank FX: feed bursts, turn wakes, eat sparks, bed sand. */
export type IdleTankFxKind = 'bubble' | 'sand' | 'spark';

export interface IdleTankFx {
  id: number;
  kind: IdleTankFxKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining lifetime (ms). */
  life: number;
  maxLife: number;
  seed: number;
}

export interface IdleTankSnapshot {
  readonly fish: readonly IdleFish[];
  readonly food: readonly IdleFood[];
  readonly fx: readonly IdleTankFx[];
}

export interface IdleTankSim {
  width: number;
  storyRows: number;
  premium: boolean;
  fish: IdleFish[];
  food: IdleFood[];
  fx: IdleTankFx[];
  nextFishId: number;
  nextFoodId: number;
  nextFxId: number;
  lastTickMs: number;
  lastAutoSpawnMs: number;
}

export const IDLE_FOOD_CAP = 8;
export const IDLE_AUTO_SPAWN_MS = 2_800;
export const IDLE_EAT_RADIUS = 1.6;
export const IDLE_SEEK_RADIUS = 22;
export const IDLE_FX_CAP_PREMIUM = 48;
export const IDLE_FX_CAP_SUBTLE = 18;

const FISH_WANDER_SPEED = 0.012;
const FISH_SEEK_SPEED = 0.022;
const FISH_BOB_AMPLITUDE = 0.35;
const FISH_BOB_PERIOD_MS = 4_200;
/** Wander lane ease time-constant (ms). Hard y snaps looked like despawn/respawn. */
const FISH_LANE_EASE_MS = 520;

type FishColor = IdleFish['color'];

function hash2(a: number, b: number): number {
  let x = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return (x ^ (x >>> 16)) >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

function floorY(storyRows: number): number {
  return Math.max(1, storyRows - 2);
}

function fishCount(width: number, premium: boolean): number {
  if (premium) return width >= 72 ? 3 : 2;
  return width >= 50 ? 2 : 1;
}

function buildInitialFish(
  width: number,
  storyRows: number,
  premium: boolean,
  nowMs: number,
  nextFishId: number,
): { fish: IdleFish[]; nextFishId: number } {
  const count = fishCount(width, premium);
  const colors: FishColor[] = ['gold', 'rose', 'sky', 'teal', 'soft'];
  const bands = [0.22, 0.38, 0.3, 0.48] as const;
  const floor = floorY(storyRows);
  const fish: IdleFish[] = [];
  let id = nextFishId;

  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 47 + 11, 203);
    const kind: IdleFish['kind'] =
      i === 0 && storyRows >= 7 ? 'large' : i === 1 && storyRows >= 6 ? 'compact' : 'tiny';
    const goesRight = i % 2 === 0;
    const phase = (i * 0.23 + (seed % 200) / 1_000) % 1;
    const speed = 0.28 + (seed % 26) / 110 + (i === 0 ? 0.06 : 0);
    const x = clamp(Math.floor(phase * Math.max(1, width - 4)) + 2, 1, Math.max(1, width - 2));
    const bob = Math.sin(nowMs / FISH_BOB_PERIOD_MS + phase * Math.PI * 2) * FISH_BOB_AMPLITUDE;
    const y = clamp(Math.floor((bands[i] ?? 0.34) * floor + bob), 1, floor - 1);

    fish.push({
      id: id++,
      kind,
      color: colors[i % colors.length]!,
      x,
      y,
      vx: goesRight ? speed * FISH_WANDER_SPEED : -speed * FISH_WANDER_SPEED,
      mode: 'wander',
      targetFoodId: null,
      cooldownUntilMs: 0,
      goesRight,
      seed,
    });
  }

  return { fish, nextFishId: id };
}

function spawnAutoFood(sim: IdleTankSim, nowMs: number): void {
  if (sim.food.length >= IDLE_FOOD_CAP) return;
  const seed = hash2(sim.nextFoodId * 31, Math.floor(nowMs / 100));
  const x = clamp(1 + (seed % Math.max(1, sim.width - 2)), 1, Math.max(1, sim.width - 2));
  const vy = 0.004 + (seed % 5) * 0.001;
  sim.food.push({
    id: sim.nextFoodId++,
    x,
    y: 1,
    vy,
  });
  sim.lastAutoSpawnMs = nowMs;
}

function isFoodLocked(sim: IdleTankSim, foodId: number, eaterId: number): boolean {
  return sim.fish.some((f) => f.id !== eaterId && f.targetFoodId === foodId);
}

function nearestFood(sim: IdleTankSim, fish: IdleFish): IdleFood | null {
  let best: IdleFood | null = null;
  let bestDist = Infinity;
  for (const food of sim.food) {
    if (isFoodLocked(sim, food.id, fish.id)) continue;
    const d = dist(fish.x, fish.y, food.x, food.y);
    if (d <= IDLE_SEEK_RADIUS && d < bestDist) {
      bestDist = d;
      best = food;
    }
  }
  return best;
}

function fxCap(sim: IdleTankSim): number {
  return sim.premium ? IDLE_FX_CAP_PREMIUM : IDLE_FX_CAP_SUBTLE;
}

function pushFx(sim: IdleTankSim, fx: Omit<IdleTankFx, 'id'>): void {
  const cap = fxCap(sim);
  if (sim.fx.length >= cap) {
    // Drop the shortest-lived particle first so bursts stay readable.
    let dropAt = 0;
    let shortest = sim.fx[0]?.life ?? 0;
    for (let i = 1; i < sim.fx.length; i++) {
      const life = sim.fx[i]!.life;
      if (life < shortest) {
        shortest = life;
        dropAt = i;
      }
    }
    sim.fx.splice(dropAt, 1);
  }
  sim.fx.push({ ...fx, id: sim.nextFxId++ });
}

function spawnBubble(sim: IdleTankSim, x: number, y: number, seed: number, vigor = 1): void {
  const floor = floorY(sim.storyRows);
  const wobble = ((seed % 7) - 3) * 0.0012 * vigor;
  pushFx(sim, {
    kind: 'bubble',
    x: clamp(x + ((seed % 5) - 2) * 0.35, 0, Math.max(0, sim.width - 1)),
    y: clamp(y + ((seed % 3) - 1) * 0.25, 1, floor - 1),
    vx: wobble,
    vy: -(0.006 + (seed % 5) * 0.0012) * vigor,
    life: 420 + (seed % 280),
    maxLife: 420 + (seed % 280),
    seed,
  });
}

function spawnFoodBurst(sim: IdleTankSim, x: number, y: number): void {
  const count = sim.premium ? 7 : 3;
  for (let i = 0; i < count; i++) {
    const seed = hash2(sim.nextFxId + i, Math.floor(x * 17 + y * 13));
    spawnBubble(sim, x, y, seed, sim.premium ? 1.15 : 0.85);
  }
}

function spawnTurnWake(sim: IdleTankSim, fish: IdleFish): void {
  const count = sim.premium ? 4 : 2;
  const behind = fish.goesRight ? -1.1 : 1.1;
  for (let i = 0; i < count; i++) {
    const seed = hash2(fish.id * 97 + i, fish.seed + sim.nextFxId);
    spawnBubble(sim, fish.x + behind * (0.6 + i * 0.35), fish.y, seed, 1.05);
  }
  if (sim.premium && fish.y >= floorY(sim.storyRows) - 2.5) {
    spawnSandScatter(sim, fish.x, fish.y + 0.6, 3);
  }
}

function spawnAccelWake(sim: IdleTankSim, fish: IdleFish): void {
  const count = sim.premium ? 3 : 1;
  const behind = fish.goesRight ? -0.9 : 0.9;
  for (let i = 0; i < count; i++) {
    const seed = hash2(fish.id * 53 + i * 11, Math.floor(fish.x * 9));
    spawnBubble(sim, fish.x + behind, fish.y + (i - 1) * 0.2, seed, 1.2);
  }
}

function spawnEatSpark(sim: IdleTankSim, x: number, y: number): void {
  const count = sim.premium ? 5 : 2;
  for (let i = 0; i < count; i++) {
    const seed = hash2(sim.nextFxId + i * 19, Math.floor(x * 23 + y));
    const angle = ((seed % 360) / 360) * Math.PI * 2;
    const speed = 0.004 + (seed % 4) * 0.001;
    pushFx(sim, {
      kind: 'spark',
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.003,
      life: 360 + (seed % 220),
      maxLife: 360 + (seed % 220),
      seed,
    });
  }
  // Small joy bubbles with the spark ring.
  const bubbles = sim.premium ? 3 : 1;
  for (let i = 0; i < bubbles; i++) {
    spawnBubble(sim, x, y, hash2(i + 3, sim.nextFxId), 0.9);
  }
}

function spawnSandScatter(sim: IdleTankSim, x: number, y: number, count: number): void {
  if (!sim.premium) return;
  const floor = floorY(sim.storyRows);
  for (let i = 0; i < count; i++) {
    const seed = hash2(sim.nextFxId + i * 7, Math.floor(x * 31));
    pushFx(sim, {
      kind: 'sand',
      x: clamp(x + ((seed % 5) - 2) * 0.45, 0, Math.max(0, sim.width - 1)),
      y: clamp(y, 1, floor),
      vx: ((seed % 7) - 3) * 0.0015,
      vy: 0.003 + (seed % 3) * 0.0008,
      life: 280 + (seed % 180),
      maxLife: 280 + (seed % 180),
      seed,
    });
  }
}

function faceTravel(sim: IdleTankSim, fish: IdleFish, dx: number): void {
  if (Math.abs(dx) < 1e-6) return;
  const wasRight = fish.goesRight;
  fish.goesRight = dx > 0;
  const speed = Math.abs(fish.vx) > 1e-9 ? Math.abs(fish.vx) : FISH_WANDER_SPEED;
  fish.vx = speed * (fish.goesRight ? 1 : -1);
  if (wasRight !== fish.goesRight) {
    spawnTurnWake(sim, fish);
  }
}

function moveToward(
  sim: IdleTankSim,
  fish: IdleFish,
  tx: number,
  ty: number,
  dt: number,
  speed: number,
): void {
  const dx = tx - fish.x;
  const dy = ty - fish.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  faceTravel(sim, fish, dx);
  const step = speed * dt;
  fish.x += (dx / len) * step;
  fish.y += (dy / len) * step;
}

function wanderFish(sim: IdleTankSim, fish: IdleFish, nowMs: number, dt: number, floor: number): void {
  fish.mode = 'wander';
  fish.targetFoodId = null;
  fish.x += fish.vx * dt;
  faceTravel(sim, fish, fish.vx);
  const phase = (fish.seed % 1_000) / 1_000;
  const bob = Math.sin(nowMs / FISH_BOB_PERIOD_MS + phase * Math.PI * 2) * FISH_BOB_AMPLITUDE;
  const band = [0.22, 0.38, 0.3, 0.48][fish.id % 4] ?? 0.34;
  const targetY = band * floor + bob;
  // Ease back to the swim lane — never hard-assign y (that teleported after seek/eat).
  const ease = 1 - Math.exp(-Math.max(0, dt) / FISH_LANE_EASE_MS);
  fish.y = clamp(fish.y + (targetY - fish.y) * ease, 1, floor - 1);

  if (fish.x <= 1 || fish.x >= sim.width - 2) {
    fish.goesRight = !fish.goesRight;
    fish.vx = Math.abs(fish.vx) * (fish.goesRight ? 1 : -1);
    fish.x = clamp(fish.x, 1, Math.max(1, sim.width - 2));
    spawnTurnWake(sim, fish);
  }
}

function tickFish(sim: IdleTankSim, fish: IdleFish, nowMs: number, dt: number): void {
  const floor = floorY(sim.storyRows);
  // No post-eat freeze; keep swimming. Field retained for snapshot compat.
  fish.cooldownUntilMs = 0;

  const prevMode = fish.mode;
  const target = nearestFood(sim, fish);
  if (target) {
    if (prevMode !== 'seek') {
      spawnAccelWake(sim, fish);
    }
    fish.mode = 'seek';
    fish.targetFoodId = target.id;
    moveToward(sim, fish, target.x, target.y, dt, FISH_SEEK_SPEED);

    if (dist(fish.x, fish.y, target.x, target.y) <= IDLE_EAT_RADIUS) {
      spawnEatSpark(sim, target.x, target.y);
      if (target.y >= floor - 1.5) {
        spawnSandScatter(sim, target.x, floor - 0.2, sim.premium ? 4 : 0);
      }
      sim.food = sim.food.filter((f) => f.id !== target.id);
      wanderFish(sim, fish, nowMs, dt, floor);
    }
  } else {
    wanderFish(sim, fish, nowMs, dt, floor);
  }

  fish.x = clamp(fish.x, 0, Math.max(0, sim.width - 1));
  fish.y = clamp(fish.y, 1, floor - 1);
}

function tickFood(sim: IdleTankSim, dt: number): void {
  const floor = floorY(sim.storyRows);
  for (const food of sim.food) {
    food.y += food.vy * dt;
    if (food.y >= floor) {
      food.y = floor;
    }
  }
}

function tickFx(sim: IdleTankSim, dt: number): void {
  if (sim.fx.length === 0 || dt <= 0) return;
  const floor = floorY(sim.storyRows);
  const maxX = Math.max(0, sim.width - 1);
  const next: IdleTankFx[] = [];
  for (const fx of sim.fx) {
    fx.life -= dt;
    if (fx.life <= 0) continue;
    const age = 1 - fx.life / fx.maxLife;
    if (fx.kind === 'bubble') {
      fx.x += fx.vx * dt + Math.sin(age * Math.PI * 2 + fx.seed) * 0.0014 * dt;
      fx.y += fx.vy * dt;
    } else if (fx.kind === 'sand') {
      fx.x += fx.vx * dt;
      fx.y += fx.vy * dt;
      fx.vx *= 0.98;
    } else {
      fx.x += fx.vx * dt;
      fx.y += fx.vy * dt;
      fx.vy += 0.00002 * dt;
    }
    fx.x = clamp(fx.x, 0, maxX);
    fx.y = clamp(fx.y, 0.2, floor);
    if (fx.kind === 'sand' && fx.y >= floor - 0.05 && age > 0.55) continue;
    if (fx.kind === 'bubble' && fx.y <= 0.4) continue;
    next.push(fx);
  }
  sim.fx = next;
}

export function createIdleTankSim(
  width: number,
  storyRows: number,
  nowMs: number,
  options?: { premium?: boolean },
): IdleTankSim {
  const premium = options?.premium ?? false;
  const { fish, nextFishId } = buildInitialFish(width, storyRows, premium, nowMs, 1);
  return {
    width,
    storyRows,
    premium,
    fish,
    food: [],
    fx: [],
    nextFishId,
    nextFoodId: 1,
    nextFxId: 1,
    lastTickMs: nowMs,
    lastAutoSpawnMs: nowMs,
  };
}

export function resizeIdleTankSim(sim: IdleTankSim, width: number, storyRows: number): void {
  sim.width = width;
  sim.storyRows = storyRows;
  const floor = floorY(storyRows);
  for (const fish of sim.fish) {
    fish.x = clamp(fish.x, 0, Math.max(0, width - 1));
    fish.y = clamp(fish.y, 1, Math.max(1, floor - 1));
  }
  for (const food of sim.food) {
    food.x = clamp(food.x, 1, Math.max(1, width - 2));
    food.y = clamp(food.y, 1, floor);
  }
  for (const fx of sim.fx) {
    fx.x = clamp(fx.x, 0, Math.max(0, width - 1));
    fx.y = clamp(fx.y, 0.2, floor);
  }
}

export function tickIdleTankSim(sim: IdleTankSim, nowMs: number): void {
  const dt = clamp(nowMs - sim.lastTickMs, 0, 100);
  sim.lastTickMs = nowMs;

  if (dt <= 0) return;

  tickFood(sim, dt);

  if (nowMs - sim.lastAutoSpawnMs >= IDLE_AUTO_SPAWN_MS && sim.food.length < IDLE_FOOD_CAP) {
    spawnAutoFood(sim, nowMs);
  }

  for (const fish of sim.fish) {
    tickFish(sim, fish, nowMs, dt);
  }

  tickFx(sim, dt);
}

export function dropFood(sim: IdleTankSim, x: number, y?: number): boolean {
  if (sim.food.length >= IDLE_FOOD_CAP) return false;
  const floor = floorY(sim.storyRows);
  const seed = hash2(sim.nextFoodId * 17, Math.floor(x * 13));
  const clampedX = clamp(x, 1, Math.max(1, sim.width - 2));
  const clampedY = clamp(y ?? 1, 1, floor);
  const vy = 0.004 + (seed % 5) * 0.001;
  sim.food.push({
    id: sim.nextFoodId++,
    x: clampedX,
    y: clampedY,
    vy,
  });
  spawnFoodBurst(sim, clampedX, clampedY);
  return true;
}

export function snapshotIdleTankSim(sim: IdleTankSim): IdleTankSnapshot {
  return {
    fish: sim.fish.map((f) => ({ ...f })),
    food: sim.food.map((f) => ({ ...f })),
    fx: sim.fx.map((f) => ({ ...f })),
  };
}
