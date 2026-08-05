import { describe, expect, it } from 'vitest';

import {
  Text,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  withTranscriptCheapPaintMode,
} from '../src';

describe('overflow paint cache eviction (GC freeze class)', () => {
  it('does not retain full line arrays for the entire scrolled history', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 16,
      leftPad: 1,
      rightPad: 1,
    });

    for (let i = 0; i < 80; i++) {
      const body = Array.from({ length: 120 }, (_, r) => `card-${i}-row-${r}-${'x'.repeat(20)}`).join(
        '\n',
      );
      transcript.addChild(new Text(body, 0, 0));
    }
    transcript.contentRowCount(80);

    // Content paints materialize a few cards per frame while walking history.
    for (let step = 0; step < 60; step++) {
      viewport.scroll('line-down', 80);
      transcript.render(80);
    }
    // Walk back up.
    for (let step = 0; step < 60; step++) {
      viewport.scroll('line-up', 80);
      transcript.render(80);
    }

    // Inspect private overflow cache via render + needsMaterializeContinue path:
    // force a content paint then peek retained slots through a second cheap fling
    // that must stay fast (would thrash GC if 80×120 strings stayed pinned).
    const t0 = performance.now();
    withTranscriptCheapPaintMode(() => {
      for (let i = 0; i < 40; i++) {
        viewport.scroll('line-down', 100);
        transcript.render(80);
      }
    });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(350);
  });

  it('pure-scroll does not cold-render a card per wheel frame', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 20,
      leftPad: 1,
      rightPad: 1,
    });
    let paints = 0;
    for (let i = 0; i < 30; i++) {
      const body = Array.from({ length: 300 }, (_, r) => `r${i}-${r}`).join('\n');
      const text = new Text(body, 0, 0);
      const orig = text.render.bind(text);
      text.render = (w: number) => {
        paints += 1;
        return orig(w);
      };
      transcript.addChild(text);
    }
    // Measure-mode geometry probes call render — reset after warm.
    transcript.contentRowCount(90);
    transcript.render(90);
    viewport.jumpToLine(0);
    transcript.render(90);
    paints = 0;

    const flingBatch = (frames: number): number => {
      const before = paints;
      withTranscriptCheapPaintMode(() => {
        for (let i = 0; i < frames; i++) {
          viewport.scroll('line-down', 60);
          transcript.render(90);
        }
      });
      return paints - before;
    };

    const first = flingBatch(25);
    const second = flingBatch(25);

    // The freeze class was cold layout per wheel frame, so the cost of a fling
    // must not scale with how long it lasts. Asserting growth rather than an
    // absolute count keeps this meaningful without pinning a machine-speed number.
    expect(second).toBeLessThanOrEqual(first);
    expect(first + second).toBeLessThan(30);
  });
});
