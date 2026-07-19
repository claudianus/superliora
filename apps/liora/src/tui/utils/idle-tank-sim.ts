export type IdleFishMode = 'wander' | 'seek';

export interface IdleFish {
  id: number;
  kind: 'large' | 'compact' | 'tiny';
  color: 'gold' | 'sky' | 'teal' | 'soft';
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

export interface IdleTankSnapshot {
  readonly fish: readonly IdleFish[];
  readonly food: readonly IdleFood[];
}

export interface IdleTankSim {
  width: number;
  storyRows: number;
  premium: boolean;
  fish: IdleFish[];
  food: IdleFood[];
  nextFishId: number;
  nextFoodId: number;
  lastTickMs: number;
  lastAutoSpawnMs: number;
}

export const IDLE_FOOD_CAP = 8;
export const IDLE_AUTO_SPAWN_MS = 2_800;
export const IDLE_EAT_RADIUS = 1.6;
export const IDLE_SEEK_RADIUS = 22;

const IDLE_EAT_COOLDOWN_MS = 900;
const FISH_WANDER_SPEED = 0.012;
const FISH_SEEK_SPEED = 0.022;
const FISH_BOB_AMPLITUDE = 0.35;
const FISH_BOB_PERIOD_MS = 4_200;

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
  if (premium) return width >= 72 ? 4 : 3;
  return width >= 50 ? 3 : 2;
}

function buildInitialFish(
  width: number,
  storyRows: number,
  premium: boolean,
  nowMs: number,
  nextFishId: number,
): { fish: IdleFish[]; nextFishId: number } {
  const count = fishCount(width, premium);
  const colors: FishColor[] = ['gold', 'sky', 'teal', 'soft'];
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

function moveToward(fish: IdleFish, tx: number, ty: number, dt: number, speed: number): void {
  const dx = tx - fish.x;
  const dy = ty - fish.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const step = speed * dt;
  fish.x += (dx / len) * step;
  fish.y += (dy / len) * step;
}

function tickFish(sim: IdleTankSim, fish: IdleFish, nowMs: number, dt: number): void {
  const floor = floorY(sim.storyRows);

  if (nowMs < fish.cooldownUntilMs) {
    fish.mode = 'wander';
    fish.targetFoodId = null;
    return;
  }

  const target = nearestFood(sim, fish);
  if (target) {
    fish.mode = 'seek';
    fish.targetFoodId = target.id;
    moveToward(fish, target.x, target.y, dt, FISH_SEEK_SPEED);

    if (dist(fish.x, fish.y, target.x, target.y) <= IDLE_EAT_RADIUS) {
      sim.food = sim.food.filter((f) => f.id !== target.id);
      fish.mode = 'wander';
      fish.targetFoodId = null;
      fish.cooldownUntilMs = nowMs + IDLE_EAT_COOLDOWN_MS;
      return;
    }
  } else {
    fish.mode = 'wander';
    fish.targetFoodId = null;
    fish.x += fish.vx * dt;
    const phase = (fish.seed % 1_000) / 1_000;
    const bob = Math.sin(nowMs / FISH_BOB_PERIOD_MS + phase * Math.PI * 2) * FISH_BOB_AMPLITUDE;
    const band = [0.22, 0.38, 0.3, 0.48][fish.id % 4] ?? 0.34;
    fish.y = clamp(Math.floor(band * floor + bob), 1, floor - 1);

    if (fish.x <= 1 || fish.x >= sim.width - 2) {
      fish.goesRight = !fish.goesRight;
      fish.vx = Math.abs(fish.vx) * (fish.goesRight ? 1 : -1);
      fish.x = clamp(fish.x, 1, Math.max(1, sim.width - 2));
    }
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
    nextFishId,
    nextFoodId: 1,
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
  return true;
}

export function snapshotIdleTankSim(sim: IdleTankSim): IdleTankSnapshot {
  return {
    fish: sim.fish.map((f) => ({ ...f })),
    food: sim.food.map((f) => ({ ...f })),
  };
}
