import { describe, expect, it } from 'vitest';

import {
  Text,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  withTranscriptCheapPaintMode,
} from '../src';

/**
 * Repro: scroll to top, then fling to bottom. Each pure-scroll frame used to
 * cold-layout newly intersecting multi-k cards (budget>0), stacking into a
 * multi-second freeze. Fling detection must force placeholder-only paint.
 */
describe('top→bottom fling pure-scroll', () => {
  it('fling frames do not cold-layout multi-k children (placeholders only)', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 20,
      leftPad: 1,
      rightPad: 1,
    });

    let fullRenders = 0;
    for (let i = 0; i < 60; i++) {
      const body = Array.from({ length: 800 }, (_, r) => `card${i}-row${r}-${'x'.repeat(50)}`).join(
        '\n',
      );
      const text = new Text(body, 0, 0);
      const original = text.render.bind(text);
      text.render = (width: number) => {
        fullRenders += 1;
        return original(width);
      };
      transcript.addChild(text);
    }

    // Geometry warm (measure path).
    transcript.contentRowCount(90);

    // Jump near top then fling toward bottom with back-to-back pure-scroll paints.
    viewport.jumpToLine(0);
    fullRenders = 0;

    const t0 = performance.now();
    withTranscriptCheapPaintMode(() => {
      // First pure-scroll paint may materialize 1 card (non-fling).
      transcript.render(90);
      // Subsequent paints <40ms apart are flings — placeholders only.
      for (let step = 0; step < 40; step++) {
        viewport.scroll('line-down', 40);
        transcript.render(90);
      }
    });
    const ms = performance.now() - t0;

    // At most a handful of cold layouts (first frame budget), not 60 cards × fling.
    expect(fullRenders).toBeLessThan(8);
    expect(ms).toBeLessThan(400);
  });
});
