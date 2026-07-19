import { describe, expect, it } from 'vitest';
import {
  createIdleTankSim,
  dropFood,
  snapshotIdleTankSim,
  tickIdleTankSim,
} from '#/tui/utils/idle-tank-sim';

describe('idle-tank-sim', () => {
  it('caps auto-spawned food', () => {
    const sim = createIdleTankSim(80, 14, 0, { premium: true });
    // Empty school so food is not eaten as fast as it spawns.
    sim.fish = [];
    for (let t = 0; t < 60_000; t += 500) tickIdleTankSim(sim, t);
    expect(snapshotIdleTankSim(sim).food.length).toBeLessThanOrEqual(8);
    expect(snapshotIdleTankSim(sim).food.length).toBeGreaterThan(0);
  });

  it('does not teleport vertically when leaving a seek dive', () => {
    const sim = createIdleTankSim(60, 12, 0, { premium: true });
    const fish = sim.fish[0]!;
    // Simulate finishing a deep seek near the bed, then one wander tick.
    fish.x = 20;
    fish.y = 8;
    fish.mode = 'seek';
    fish.targetFoodId = null;
    fish.cooldownUntilMs = 0;
    const yBefore = fish.y;
    tickIdleTankSim(sim, 40); // dt=40 from lastTick 0
    const after = snapshotIdleTankSim(sim).fish.find((f) => f.id === fish.id)!;
    expect(Math.abs(after.y - yBefore)).toBeLessThan(1.5);
  });

  it('keeps swimming after eating (no freeze cooldown)', () => {
    const sim = createIdleTankSim(60, 12, 0, { premium: true });
    const fish = sim.fish[0]!;
    fish.x = 20;
    fish.y = 5;
    fish.vx = 0.01;
    fish.goesRight = true;
    expect(dropFood(sim, 20, 5)).toBe(true);
    // Prevent auto-spawn from refilling during this assertion.
    sim.lastAutoSpawnMs = Number.POSITIVE_INFINITY;
    for (let t = 50; t <= 3_000; t += 50) tickIdleTankSim(sim, t);
    const after = snapshotIdleTankSim(sim).fish.find((f) => f.id === fish.id)!;
    expect(snapshotIdleTankSim(sim).food.length).toBe(0);
    expect(after.mode).toBe('wander');
    expect(after.cooldownUntilMs).toBe(0);
    expect(Math.abs(after.x - 20)).toBeGreaterThan(0.5);
  });

  it('dropFood clamps and respects cap', () => {
    const sim = createIdleTankSim(40, 12, 0);
    expect(dropFood(sim, -3)).toBe(true);
    expect(snapshotIdleTankSim(sim).food[0]!.x).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < 20; i++) dropFood(sim, 10 + i);
    expect(snapshotIdleTankSim(sim).food.length).toBeLessThanOrEqual(8);
  });

  it('fish seek and eat nearby food', () => {
    const sim = createIdleTankSim(60, 12, 0, { premium: true });
    const snap0 = snapshotIdleTankSim(sim);
    const fish = snap0.fish[0]!;
    expect(dropFood(sim, Math.round(fish.x), Math.round(fish.y))).toBe(true);
    for (let t = 50; t <= 8_000; t += 50) tickIdleTankSim(sim, t);
    const snap = snapshotIdleTankSim(sim);
    expect(snap.food.length).toBe(0);
    expect(snap.fish.some((f) => f.mode === 'wander' || f.mode === 'seek')).toBe(true);
  });

  it('faces the direction of travel while seeking food', () => {
    const sim = createIdleTankSim(60, 12, 0, { premium: true });
    const fish = sim.fish[0]!;
    fish.x = 30;
    fish.y = 5;
    fish.goesRight = true;
    fish.vx = Math.abs(fish.vx);
    fish.cooldownUntilMs = 0;
    expect(dropFood(sim, 12, 5)).toBe(true);
    tickIdleTankSim(sim, 100);
    const seeking = snapshotIdleTankSim(sim).fish.find((f) => f.id === fish.id)!;
    expect(seeking.mode).toBe('seek');
    expect(seeking.goesRight).toBe(false);
    expect(seeking.vx).toBeLessThan(0);

    sim.food = [];
    seeking.x = 12;
    seeking.y = 5;
    seeking.goesRight = false;
    seeking.vx = -Math.abs(seeking.vx);
    seeking.cooldownUntilMs = 0;
    expect(dropFood(sim, 30, 5)).toBe(true);
    tickIdleTankSim(sim, 200);
    const seekingRight = snapshotIdleTankSim(sim).fish.find((f) => f.id === fish.id)!;
    expect(seekingRight.goesRight).toBe(true);
    expect(seekingRight.vx).toBeGreaterThan(0);
  });

  it('keeps a small premium school', () => {
    const wide = createIdleTankSim(80, 14, 0, { premium: true });
    expect(snapshotIdleTankSim(wide).fish.length).toBeLessThanOrEqual(3);
    const mid = createIdleTankSim(60, 12, 0, { premium: true });
    expect(snapshotIdleTankSim(mid).fish.length).toBeLessThanOrEqual(2);
  });
});
