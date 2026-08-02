/**
 * Structural pure-scroll storm contract (shipped viewport APIs only).
 *
 * Acceptance:
 * - Alternating up/down storm on a large N×M transcript stays interactive
 * - Pure-scroll never cold-paints children (childPaintCalls === 0)
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
  resetTranscriptMeasureModeForTest,
  withTranscriptCheapPaintMode,
} from '../src';

/**
 * Timing budgets vs multi-second hang class.
 * Mean must stay interactive; p99 allows suite-parallel GC noise but stays
 * far below freeze class (seconds). Structural zero-child-paint is the hard
 * non-flaky contract.
 */
const HARD_FRAME_P99_BUDGET_MS = 50;
/** Mean per-frame budget for pure-scroll storm (interactive-class). */
const HARD_FRAME_MEAN_BUDGET_MS = 4;
/** Total storm wall time for dozens of frames must stay interactive-class. */
const STORM_TOTAL_BUDGET_MS = 400;
/** Absolute per-frame hang detector (still << multi-second freeze). */
const HARD_FRAME_MAX_BUDGET_MS = 100;

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
  // Warm geometry once (content path — may paint).
  transcript.contentRowCount(options.width);
  return { viewport, transcript, childRenderCalls };
}

describe('structural pure-scroll storm (hard budget)', () => {
  beforeEach(() => {
    resetTranscriptMeasureModeForTest();
  });

  it('alternating up/down storm stays under hard per-frame budget with zero child paint', () => {
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
    const frameMs: number[] = [];
    const WARMUP = 8;
    const MEASURED = 80;

    withTranscriptCheapPaintMode(() => {
      // JIT / first-touch warmup — not scored against hard budgets.
      for (let i = 0; i < WARMUP; i++) {
        viewport.scroll(i % 2 === 0 ? 'line-up' : 'line-down', 90);
        transcript.render(width);
        expect(transcript.lastFrameChildPaintCalls).toBe(0);
      }

      const t0 = performance.now();
      for (let i = 0; i < MEASURED; i++) {
        const dir = i % 2 === 0 ? 'line-up' : 'line-down';
        viewport.scroll(dir, 90);
        const f0 = performance.now();
        const painted = transcript.render(width);
        const f1 = performance.now();
        frameMs.push(f1 - f0);
        expect(painted.length).toBeGreaterThan(0);
        expect(painted.length).toBeLessThanOrEqual(30);
        // Structural: pure-scroll never enters child paint.
        expect(transcript.lastFrameChildPaintCalls).toBe(0);
        expect(transcript.lastPaintWasPureScroll).toBe(true);
      }
      const totalMs = performance.now() - t0;

      frameMs.sort((a, b) => a - b);
      const p99 = frameMs[Math.min(frameMs.length - 1, Math.floor(frameMs.length * 0.99))]!;
      const max = frameMs[frameMs.length - 1]!;
      const mean = frameMs.reduce((a, b) => a + b, 0) / frameMs.length;

      // Structural contract (never flake): pure-scroll does not paint children.
      expect(childRenderCalls.count).toBe(0);
      expect(transcript.overflowRetainedFullLineChildCount).toBeLessThanOrEqual(
        TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
      );
      // Timing: interactive-class, not multi-second hang class.
      expect(totalMs).toBeLessThan(STORM_TOTAL_BUDGET_MS);
      expect(mean).toBeLessThan(HARD_FRAME_MEAN_BUDGET_MS);
      expect(p99).toBeLessThan(HARD_FRAME_P99_BUDGET_MS);
      expect(max).toBeLessThan(HARD_FRAME_MAX_BUDGET_MS);
    });
  });

  it('mid-storm content invalidation does not force child paint on pure-scroll frames', () => {
    const width = 90;
    const { viewport, transcript, childRenderCalls } = buildLargeTranscript({
      messages: 120,
      linesPerMessage: 400,
      visibleRows: 20,
      width,
    });
    transcript.contentRowCount(width);
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
        expect(transcript.lastFrameChildPaintCalls).toBe(0);
      }
    });
    expect(childRenderCalls.count).toBe(0);
  });

  it('post-storm settle paints non-empty fidelity and exits continue within budget', () => {
    const width = 100;
    const { viewport, transcript } = buildLargeTranscript({
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
    const t0 = performance.now();
    for (let pass = 0; pass < 24; pass++) {
      painted = transcript.render(width);
      totalChildPaints += transcript.lastFrameChildPaintCalls;
      // Per content frame: at most budget (+ small probe slack).
      expect(transcript.lastFrameChildPaintCalls).toBeLessThanOrEqual(
        TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET + 4,
      );
      if (!transcript.needsMaterializeContinue && pass > 0) break;
    }
    const settleMs = performance.now() - t0;

    expect(painted.length).toBeGreaterThan(0);
    expect(painted.some((line) => line.includes('…') === false || line.trim().length > 2)).toBe(
      true,
    );
    expect(settleMs).toBeLessThan(800);
    expect(transcript.overflowRetainedFullLineChildCount).toBeLessThanOrEqual(
      TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
    );
    // Settle did real work (not stuck permanently on placeholders only).
    expect(totalChildPaints).toBeGreaterThan(0);
  });

  it('top→bottom fling then reverse storm stays interactive', () => {
    const width = 80;
    const { viewport, transcript, childRenderCalls } = buildLargeTranscript({
      messages: 200,
      linesPerMessage: 300,
      visibleRows: 18,
      width,
    });
    transcript.contentRowCount(width);
    childRenderCalls.count = 0;

    const t0 = performance.now();
    withTranscriptCheapPaintMode(() => {
      viewport.jumpToLine(0);
      for (let i = 0; i < 50; i++) {
        viewport.scroll('line-down', 120);
        transcript.render(width);
        expect(transcript.lastFrameChildPaintCalls).toBe(0);
      }
      for (let i = 0; i < 50; i++) {
        viewport.scroll('line-up', 120);
        transcript.render(width);
        expect(transcript.lastFrameChildPaintCalls).toBe(0);
      }
    });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(400);
    expect(childRenderCalls.count).toBe(0);
  });
});
