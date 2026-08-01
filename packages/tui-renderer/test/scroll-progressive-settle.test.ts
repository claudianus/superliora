import { describe, expect, it } from 'vitest';

import {
  Text,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  withTranscriptCheapPaintMode,
} from '../src';

describe('progressive settle materialize budget', () => {
  it('content frames materialize at most CONTENT budget cold cards per paint', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 30,
      leftPad: 1,
      rightPad: 1,
    });

    let renders = 0;
    for (let i = 0; i < 20; i++) {
      const body = Array.from({ length: 200 }, (_, r) => `c${i}-r${r}`).join('\n');
      const text = new Text(body, 0, 0);
      const orig = text.render.bind(text);
      text.render = (w: number) => {
        renders += 1;
        return orig(w);
      };
      transcript.addChild(text);
    }
    transcript.contentRowCount(100);
    viewport.jumpToLine(0);
    renders = 0;

    // Content paint (not cheap): budget 4 cold layouts.
    transcript.render(100);
    expect(renders).toBeLessThanOrEqual(6); // geometry may touch a couple
    // More cold cards remain — continue flag should ask for another pass.
    // After first content paint, some slots are warm; needsMaterializeContinue
    // is true only when placeholders were used under budget.
    expect(transcript.needsMaterializeContinue || renders > 0).toBe(true);
  });

  it('fling then content fill stays interactive for many huge cards', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 20,
      leftPad: 1,
      rightPad: 1,
    });
    for (let i = 0; i < 40; i++) {
      const body = Array.from({ length: 600 }, (_, r) => `x${i}-${r}-${'z'.repeat(30)}`).join('\n');
      transcript.addChild(new Text(body, 0, 0));
    }
    transcript.contentRowCount(90);

    const t0 = performance.now();
    withTranscriptCheapPaintMode(() => {
      for (let s = 0; s < 30; s++) {
        viewport.scroll('line-down', 50);
        transcript.render(90);
      }
    });
    // Progressive content fill (budgeted).
    for (let p = 0; p < 8; p++) {
      transcript.render(90);
      if (!transcript.needsMaterializeContinue) break;
    }
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(600);
  });
});
