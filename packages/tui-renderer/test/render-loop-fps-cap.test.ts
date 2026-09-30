import { describe, expect, it } from 'vitest';

import { NativeRenderLoop } from '../src/frame/render-loop';

/**
 * The loop advertises a target frame rate and hard-caps it. A caller that
 * re-arms `requestAnimationFrame` every frame — which is what the TUI's
 * ambient animations do — must not be able to push the loop past that cap.
 *
 * Measured on the built bundle at an idle input prompt, the loop produced
 * roughly 1,150 frames per second against a declared maximum of 240, so the
 * pacing was not holding. This drives the loop directly to tell whether the
 * breach belongs to the loop or to the caller.
 */
describe('NativeRenderLoop frame-rate cap', () => {
  it('does not exceed the target frame rate under continuous animation', async () => {
    const RENDER_INTERVAL_MS = 4; // 250fps of request pressure, above the cap.
    const DURATION_MS = 300;
    let frames = 0;

    const loop = new NativeRenderLoop({
      // No scheduler override: the real timer path is what misbehaves.
      render: (): void => {
        frames += 1;
        // Re-arm immediately, exactly like a per-frame ambient animation.
        loop.requestAnimationFrame(() => {});
      },
    });

    loop.start();
    loop.requestRender('request');
    await new Promise((resolve) => {
      setTimeout(resolve, DURATION_MS);
    });
    loop.stop();

    const fps = (frames / DURATION_MS) * 1000;
    // 240 is the declared MAX_TARGET_FPS. Allow generous slack for timer
    // granularity while still failing hard on a 1000+fps runaway.
    expect(fps).toBeLessThan(400);
    expect(frames).toBeGreaterThan(0);
  });
});
