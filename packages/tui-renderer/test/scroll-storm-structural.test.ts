/**
 * Structural pure-scroll storm contract (shipped viewport APIs only).
 *
 * Acceptance:
 * - Alternating up/down storm on a large N×M transcript stays interactive
 * - Pure-scroll child paint stays inside the per-frame scroll budget, so cold
 *   layout can never stack across a fling (the multi-second freeze class)
 * - Overflow retain stays hard-capped after content walk + storm
 * - Post-storm content settle paints non-empty fidelity without hang
 */
import { describe, expect, it, beforeEach } from 'vitest';

import {
  Text,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET,
  TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
  TRANSCRIPT_SCROLL_MATERIALIZE_BUDGET,
  resetTranscriptMeasureModeForTest,
  withTranscriptCheapPaintMode,
} from '../src';

/**
 * Paint calls one budgeted scroll materialize can cost: the geometry measure,
 * the geometry-count fallback, and the band fill.
 */
const SCROLL_PAINT_CALLS_PER_CARD = 3;
/** Per-frame ceiling on child paint during a pure-scroll storm. */
const SCROLL_FRAME_PAINT_CEILING =
  TRANSCRIPT_SCROLL_MATERIALIZE_BUDGET * SCROLL_PAINT_CALLS_PER_CARD;

function buildLargeTranscript(options: {
  readonly messages: number;
  readonly linesPerMessage: number;
  readonly visibleRows: number;
  readonly width: number;
}): {
  viewport: RendererTranscriptViewport;
  transcript: RendererTranscriptViewportComponent;
  childRenderCalls: { count: number };
} {
  const viewport = new RendererTranscriptViewport();
  const transcript = new RendererTranscriptViewportComponent({
    viewport,
    getVisibleRows: () => options.visibleRows,
    leftPad: 1,
    rightPad: 1,
  });
  const childRenderCalls = { count: 0 };
  for (let i = 0; i < options.messages; i++) {
    const body = Array.from(
      { length: options.linesPerMessage },
      (_, r) => `m${i}-r${r}-${'x'.repeat(48)}`,
    ).join('\n');
    const text = new Text(body, 0, 0);
    const origRender = text.render.bind(text);
    text.render = (w: number) => {
      childRenderCalls.count += 1;
      return origRender(w);
    };
    const origPaint = text.paintContentRows.bind(text);
    text.paintContentRows = (w, s, e) => {
      childRenderCalls.count += 1;
      return origPaint(w, s, e);
    };
    transcript.addChild(text);
  }
  // Geometry is progressively measured under a time-sliced runtime budget.
  // One call can leave 1-row provisional cards; finish the fixture by work,
  // not by assuming this CPU can measure the entire transcript in one slice.
  const expectedRows = options.messages * options.linesPerMessage;
  let measuredRows = 0;
  for (let pass = 0; pass < options.messages; pass++) {
    measuredRows = transcript.contentRowCount(options.width);
    if (measuredRows === expectedRows) break;
  }
  expect(measuredRows).toBe(expectedRows);
  expect(transcript.needsMaterializeContinue).toBe(false);
  // Row-count probes do not sync the viewport. Scroll/jump inputs must see the
  // real range before the first paint, rather than clamping against 0 rows.
  viewport.sync(measuredRows, options.visibleRows);
  return { viewport, transcript, childRenderCalls };
}

describe('structural pure-scroll storm (hard budget)', () => {
  beforeEach(() => {
    resetTranscriptMeasureModeForTest();
  });

  it('alternating up/down storm stays under hard per-frame budget with bounded child paint', () => {
    const width = 100;
    const { viewport, transcript, childRenderCalls } = buildLargeTranscript({
      messages: 300,
      linesPerMessage: 200,
      visibleRows: 24,
      width,
    });

    // Progressive content fill so some overflow cache is warm (settle path).
    viewport.jumpToLine(0);
    for (let p = 0; p < 20; p++) {
      transcript.render(width);
      if (!transcript.needsMaterializeContinue) break;
    }

    childRenderCalls.count = 0;
    const INITIAL_FRAMES = 8;
    const STORM_FRAMES = 80;

    withTranscriptCheapPaintMode(() => {
      // Initial frames establish the preceding position for fling detection.
      for (let i = 0; i < INITIAL_FRAMES; i++) {
        viewport.scroll(i % 2 === 0 ? 'line-up' : 'line-down', 90);
        transcript.render(width);
        expect(transcript.lastFrameChildPaintCalls).toBeLessThanOrEqual(
          SCROLL_FRAME_PAINT_CEILING,
        );
      }

      for (let i = 0; i < STORM_FRAMES; i++) {
        const dir = i % 2 === 0 ? 'line-up' : 'line-down';
        viewport.scroll(dir, 90);
        const painted = transcript.render(width);
        expect(painted).toHaveLength(24);
        // Structural: these jumps clear a screen per frame, so they stay on the
        // fling path — no cold layout at all, however far the storm travels.
        expect(transcript.lastFrameChildPaintCalls).toBe(0);
        expect(transcript.lastPaintWasPureScroll).toBe(true);
      }

      // A fling must not accumulate cold child paints across the storm.
      expect(childRenderCalls.count).toBeLessThanOrEqual(SCROLL_FRAME_PAINT_CEILING);
      expect(transcript.overflowRetainedFullLineChildCount).toBeLessThanOrEqual(
        TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
      );
    });
  });

  it('mid-storm content invalidation keeps pure-scroll child paint budgeted', () => {
    const width = 90;
    const { viewport, transcript, childRenderCalls } = buildLargeTranscript({
      messages: 120,
      linesPerMessage: 400,
      visibleRows: 20,
      width,
    });
    childRenderCalls.count = 0;

    withTranscriptCheapPaintMode(() => {
      for (let i = 0; i < 40; i++) {
        // Simulate format/content invalidation mid-storm (must not break O(viewport)).
        if (i % 5 === 0) {
          transcript.invalidatePaint();
        }
        if (i % 7 === 0) {
          // Geometry wipe is hostile; pure-scroll must still avoid child paint.
          transcript.invalidateGeometryAndPaint();
        }
        viewport.scroll(i % 2 === 0 ? 'line-down' : 'line-up', 70);
        transcript.render(width);
        expect(transcript.lastFrameChildPaintCalls).toBeLessThanOrEqual(
          SCROLL_FRAME_PAINT_CEILING,
        );
      }
    });
    expect(childRenderCalls.count).toBeLessThanOrEqual(SCROLL_FRAME_PAINT_CEILING);
  });

  it('post-storm settle paints non-empty fidelity and exits continue within budget', () => {
    const width = 100;
    const { viewport, transcript, childRenderCalls } = buildLargeTranscript({
      messages: 80,
      linesPerMessage: 150,
      visibleRows: 22,
      width,
    });
    viewport.jumpToLine(0);

    withTranscriptCheapPaintMode(() => {
      for (let i = 0; i < 35; i++) {
        viewport.scroll(i % 2 === 0 ? 'line-down' : 'line-up', 80);
        transcript.render(width);
      }
    });

    // Content settle: progressive materialize under shipped budget.
    let painted: string[] = [];
    let totalChildPaints = 0;
    childRenderCalls.count = 0;
    for (let pass = 0; pass < 24; pass++) {
      painted = transcript.render(width);
      totalChildPaints += transcript.lastFrameChildPaintCalls;
      // Per content frame: at most budget (+ small probe slack).
      expect(transcript.lastFrameChildPaintCalls).toBeLessThanOrEqual(
        TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET + 4,
      );
      if (!transcript.needsMaterializeContinue && pass > 0) break;
    }

    expect(transcript.needsMaterializeContinue).toBe(false);
    expect(painted).toHaveLength(22);
    const start = viewport.start();
    for (let row = 0; row < painted.length; row++) {
      const contentRow = start + row;
      expect(painted[row]).toContain(
        `m${Math.floor(contentRow / 150)}-r${contentRow % 150}-`,
      );
    }
    expect(transcript.overflowRetainedFullLineChildCount).toBeLessThanOrEqual(
      TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
    );
    // Settle did real work (not stuck permanently on placeholders only).
    expect(totalChildPaints).toBeGreaterThan(0);
    expect(childRenderCalls.count).toBeGreaterThan(0);
    expect(childRenderCalls.count).toBeLessThanOrEqual(totalChildPaints);
  });

  it('cheap band-fill of an identity-cached windowed card requests a fidelity upgrade', () => {
    const width = 100;
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 24,
      leftPad: 1,
      rightPad: 1,
    });
    const body = Array.from({ length: 400 }, (_, r) => `row-${r}-${'x'.repeat(48)}`).join('\n');
    transcript.addChild(new Text(body, 0, 0));
    transcript.contentRowCount(width);

    // Warm identity + band cache at full fidelity (content frames).
    viewport.jumpToLine(0);
    for (let p = 0; p < 20; p++) {
      transcript.render(width);
      if (!transcript.needsMaterializeContinue) break;
    }
    expect(transcript.needsMaterializeContinue).toBe(false);

    // Wheel step away from the bottom exposes new rows of the same
    // (identity-cached) card; the cheap band fill must mark them for a
    // settle-frame fidelity upgrade — unmarked slots stayed unstyled.
    withTranscriptCheapPaintMode(() => {
      viewport.scroll('line-up', 6);
      transcript.render(width);
    });
    expect(transcript.needsMaterializeContinue).toBe(true);

    for (let p = 0; p < 20 && transcript.needsMaterializeContinue; p++) {
      transcript.render(width);
    }
    expect(transcript.needsMaterializeContinue).toBe(false);
  });

  it('top→bottom fling then reverse storm stays bounded and reaches both ends', () => {
    const width = 80;
    const visibleRows = 18;
    const { viewport, transcript, childRenderCalls } = buildLargeTranscript({
      messages: 200,
      linesPerMessage: 300,
      visibleRows,
      width,
    });
    viewport.jumpToLine(0);
    transcript.render(width);
    expect(viewport.start()).toBe(0);
    childRenderCalls.count = 0;

    // Cover the actual transcript range in each direction. The old fixed
    // 50 × 120 rows never traversed a fully measured 60,000-row transcript.
    const framesPerDirection = 50;
    const bottom = viewport.snapshot().maxOffsetFromBottom;
    const step = Math.ceil(bottom / framesPerDirection);
    withTranscriptCheapPaintMode(() => {
      for (const direction of ['line-down', 'line-up'] as const) {
        for (let frame = 0; frame < framesPerDirection; frame++) {
          const previousStart = viewport.start();
          const previousChildCalls = childRenderCalls.count;
          expect(viewport.scroll(direction, step)).toBe(true);
          const painted = transcript.render(width);
          // Every frame really moves more than a screen, including the
          // clamped endpoint frame; stationary wheel paints are not flings.
          expect(Math.abs(viewport.start() - previousStart)).toBeGreaterThan(visibleRows);
          expect(painted).toHaveLength(visibleRows);
          expect(transcript.lastPaintWasPureScroll).toBe(true);
          expect(transcript.lastFrameChildPaintCalls).toBe(0);
          expect(childRenderCalls.count).toBe(previousChildCalls);
          expect(transcript.overflowFilledSparseLineCount).toBeLessThanOrEqual(
            visibleRows * TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
          );
          expect(transcript.overflowRetainedFullLineChildCount).toBeLessThanOrEqual(
            TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
          );
        }
        expect(viewport.start()).toBe(direction === 'line-down' ? bottom : 0);
      }
    });
    expect(childRenderCalls.count).toBe(0);
  });
});
