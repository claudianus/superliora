import { describe, expect, it } from 'vitest';

import {
  Text,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET,
  TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
  withTranscriptCheapPaintMode,
} from '../src';

/**
 * Phase B extreme opt contract: shipped viewport entry points only.
 * - overflow retain hard-capped after history walk
 * - pure-scroll zero cold materialize
 * - content frames budgeted progressive materialize
 */
describe('Phase B extreme TUI memory/responsiveness', () => {
  it('exports retain and materialize ceilings used by the shipped viewport', () => {
    expect(TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN).toBeGreaterThan(0);
    expect(TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN).toBeLessThanOrEqual(24);
    expect(TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET).toBeGreaterThan(0);
    // Enough to fill a typical viewport of short cards in one content frame;
    // still a hard ceiling so settle cannot unbounded-layout the whole history.
    expect(TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET).toBeLessThanOrEqual(64);
  });

  it('after long history walk retained full-line children stay hard-capped', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 16,
      leftPad: 1,
      rightPad: 1,
    });
    for (let i = 0; i < 80; i++) {
      const body = Array.from({ length: 100 }, (_, r) => `c${i}-r${r}-${'x'.repeat(24)}`).join(
        '\n',
      );
      transcript.addChild(new Text(body, 0, 0));
    }
    transcript.contentRowCount(80);

    // Content-class paints walk history (budgeted materialize per frame).
    for (let step = 0; step < 80; step++) {
      viewport.scroll('line-down', 60);
      transcript.render(80);
    }
    for (let step = 0; step < 80; step++) {
      viewport.scroll('line-up', 60);
      transcript.render(80);
    }

    expect(transcript.overflowRetainedFullLineChildCount).toBeLessThanOrEqual(
      TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
    );
    // Heap proxy: cannot retain 80×100 full arrays.
    expect(transcript.overflowRetainedRawLineCount).toBeLessThan(80 * 100);
  });

  it('pure-scroll never cold-materializes multi-k children', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 20,
      leftPad: 1,
      rightPad: 1,
    });
    let paints = 0;
    for (let i = 0; i < 40; i++) {
      const body = Array.from({ length: 400 }, (_, r) => `mk-${i}-${r}-${'z'.repeat(40)}`).join(
        '\n',
      );
      const text = new Text(body, 0, 0);
      const orig = text.render.bind(text);
      text.render = (w: number) => {
        paints += 1;
        return orig(w);
      };
      transcript.addChild(text);
    }
    transcript.contentRowCount(90);
    paints = 0;

    withTranscriptCheapPaintMode(() => {
      viewport.jumpToLine(0);
      for (let i = 0; i < 30; i++) {
        viewport.scroll('line-down', 80);
        const painted = transcript.render(90);
        expect(painted.length).toBeGreaterThan(0);
        expect(painted.length).toBeLessThanOrEqual(25);
      }
    });
    expect(paints).toBe(0);
  });

  it('content frames materialize under the shipped per-frame budget', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 28,
      leftPad: 1,
      rightPad: 1,
    });
    let paints = 0;
    for (let i = 0; i < 16; i++) {
      const body = Array.from({ length: 80 }, (_, r) => `b${i}-${r}`).join('\n');
      const text = new Text(body, 0, 0);
      const orig = text.render.bind(text);
      text.render = (w: number) => {
        paints += 1;
        return orig(w);
      };
      transcript.addChild(text);
    }
    transcript.contentRowCount(100);
    viewport.jumpToLine(0);
    paints = 0;

    // Non-cheap content paint.
    transcript.render(100);
    // Geometry may have warmed some; cold materialize this frame ≤ budget (+small probe slack).
    expect(paints).toBeLessThanOrEqual(TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET + 2);

    // Progressive continuation fills more without unlimited one-shot.
    let totalPaints = paints;
    for (let pass = 0; pass < 12; pass++) {
      if (!transcript.needsMaterializeContinue && pass > 0) break;
      paints = 0;
      transcript.render(100);
      totalPaints += paints;
      expect(paints).toBeLessThanOrEqual(TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET + 2);
    }
    expect(totalPaints).toBeGreaterThan(0);
  });

  it('fling after history walk stays interactive under pure-scroll', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 16,
      leftPad: 1,
      rightPad: 1,
    });
    for (let i = 0; i < 50; i++) {
      const body = Array.from({ length: 150 }, (_, r) => `h${i}-${r}-${'y'.repeat(30)}`).join('\n');
      transcript.addChild(new Text(body, 0, 0));
    }
    transcript.contentRowCount(80);
    for (let s = 0; s < 40; s++) {
      viewport.scroll('line-down', 70);
      transcript.render(80);
    }

    const t0 = performance.now();
    withTranscriptCheapPaintMode(() => {
      for (let i = 0; i < 35; i++) {
        viewport.scroll(i % 2 === 0 ? 'line-up' : 'line-down', 90);
        transcript.render(80);
      }
    });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(400);
    expect(transcript.overflowRetainedFullLineChildCount).toBeLessThanOrEqual(
      TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
    );
  });
});
