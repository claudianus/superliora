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
    for (let t = 0; t < 60_000; t += 500) tickIdleTankSim(sim, t);
    expect(snapshotIdleTankSim(sim).food.length).toBeLessThanOrEqual(8);
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
});
