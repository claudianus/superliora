import { describe, expect, it } from 'vitest';

import { NativeFrameRenderer } from '../src';

function createRenderer(): NativeFrameRenderer {
  return new NativeFrameRenderer({
    width: 20,
    height: 5,
    output: { write: () => {} },
  });
}

const PULSE_EFFECT = {
  kind: 'pulse',
  color: '#ff8800',
  nowMs: 300,
  intervalMs: 600,
} as const;

describe('NativeFrameRenderer.applyCellVfx', () => {
  it('confines present() damage and patches to the changed-cell union', () => {
    const renderer = createRenderer();

    // Seed a baseline frame so the next present diffs against real content.
    renderer.beginFrame({ clear: true });
    renderer.writeAnsiText(0, 1, 'aaaaaaaaaaaaaaaaaaaa');
    renderer.present();

    // New frame: keep the baseline (clear:false shares frame 1 content) and
    // apply a pulse VFX to a sub-rect only. The double buffer accumulates just
    // the VFX write-damage, so present() damage matches the changed-cell union.
    renderer.beginFrame({ clear: false });
    const changed = renderer.applyCellVfx({
      effect: { ...PULSE_EFFECT },
      rect: { x: 2, y: 1, width: 4, height: 1 },
    });
    expect(changed).not.toBeNull();
    if (changed === null) return;

    // The changed rect stays inside the requested VFX rect.
    expect(changed.x).toBeGreaterThanOrEqual(2);
    expect(changed.y).toBeGreaterThanOrEqual(1);
    expect(changed.x + changed.width).toBeLessThanOrEqual(6);
    expect(changed.y + changed.height).toBeLessThanOrEqual(2);

    const { diff } = renderer.present();
    // Damage is exactly the union of changed cells...
    expect(diff.damage).toEqual(changed);
    // ...and every patch stays inside that rect.
    expect(diff.patches.length).toBeGreaterThan(0);
    for (const patch of diff.patches) {
      expect(patch.y).toBeGreaterThanOrEqual(changed.y);
      expect(patch.y).toBeLessThan(changed.y + changed.height);
      expect(patch.x).toBeGreaterThanOrEqual(changed.x);
      expect(patch.x).toBeLessThan(changed.x + changed.width);
    }
  });

  it('returns null and leaves no damage for a no-op effect', () => {
    const renderer = createRenderer();
    renderer.beginFrame({ clear: true });
    renderer.writeAnsiText(0, 1, 'aaaaaaaaaaaaaaaaaaaa');
    renderer.present();

    renderer.beginFrame({ clear: false });
    expect(renderer.applyCellVfx({ effect: { kind: 'none' } })).toBeNull();

    const { diff } = renderer.present();
    expect(diff.damage).toBeNull();
    expect(diff.patches).toHaveLength(0);
  });

  it('returns null for an out-of-bounds rect', () => {
    const renderer = createRenderer();
    renderer.beginFrame({ clear: true });
    renderer.present();

    renderer.beginFrame();
    expect(
      renderer.applyCellVfx({
        effect: { ...PULSE_EFFECT },
        rect: { x: 30, y: 1, width: 4, height: 1 },
      }),
    ).toBeNull();
  });
});
