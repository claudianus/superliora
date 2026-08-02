import { describe, expect, it } from 'vitest';

import {
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  Text,
  TEXT_WINDOWED_BODY_CHAR_CAP,
  supportsWindowedBody,
  withTranscriptCheapPaintMode,
} from '../src';

/** Multi-k plain source above the windowed char cap. */
function multiKBody(rows: number, width = 48): string {
  return Array.from({ length: rows }, (_, r) => `row-${r}-${'x'.repeat(width)}`).join('\n');
}

describe('windowed large-body paint (Phase D)', () => {
  it('Text exposes windowed measure/paint seam', () => {
    const body = multiKBody(400);
    const text = new Text(body, 0, 0);
    expect(supportsWindowedBody(text)).toBe(true);
    expect(text.measureContentRows(80)).toBeGreaterThan(0);
    // Source must exceed the shipped windowed threshold.
    expect(body.length).toBeGreaterThan(TEXT_WINDOWED_BODY_CHAR_CAP);
  });

  it('paintContentRows returns only the visible window length', () => {
    const body = multiKBody(500);
    const text = new Text(body, 0, 0);
    const total = text.measureContentRows(60);
    expect(total).toBeGreaterThan(400);

    const window = text.paintContentRows(60, 10, 26);
    expect(window.length).toBe(16);
    // Must not pin full multi-k on the component after windowed paint.
    expect(text.debugCachedLineCountForTest()).toBe(0);
  });

  it('measureContentRows does not pin a full multi-k line array', () => {
    const text = new Text(multiKBody(600), 0, 0);
    const rows = text.measureContentRows(72);
    expect(rows).toBeGreaterThan(500);
    expect(text.debugCachedLineCountForTest()).toBe(0);
  });

  it('viewport pure-scroll + content walk does not retain full multi-k arrays', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 20,
      leftPad: 1,
      rightPad: 1,
    });

    const cards = 30;
    for (let i = 0; i < cards; i++) {
      // Each body >> TEXT_WINDOWED_BODY_CHAR_CAP so windowed path is mandatory.
      transcript.addChild(new Text(multiKBody(300, 40), 0, 0));
    }
    transcript.contentRowCount(90);

    // Pure-scroll history walk (placeholders only).
    withTranscriptCheapPaintMode(() => {
      for (let step = 0; step < cards; step++) {
        viewport.scroll('page-down');
        transcript.render(90);
      }
      for (let step = 0; step < cards; step++) {
        viewport.scroll('page-up');
        transcript.render(90);
      }
    });

    // Content frames materialize budgeted windows (not full multi-k pins).
    for (let step = 0; step < cards * 3; step++) {
      viewport.scroll('page-down');
      transcript.render(90);
    }
    for (let step = 0; step < cards * 3; step++) {
      viewport.scroll('page-up');
      transcript.render(90);
    }

    // Full multi-k arrays must not accumulate in overflow childRenderRefs.
    // Windowed path leaves childRenderRefs undefined; sparse holds viewport rows only.
    expect(transcript.overflowRetainedRawLineCount).toBeLessThan(300);
    // Even if every retained child kept a full 300-row array, 30×300 would be 9000 —
    // hard fail that class.
    expect(transcript.overflowRetainedRawLineCount).toBeLessThan(cards * 300 * 0.25);

    // Leaf Text components must not hold full multi-k paint caches either.
    let pinnedFull = 0;
    for (const child of transcript['children'] as Text[]) {
      if (typeof child.debugCachedLineCountForTest === 'function') {
        pinnedFull += child.debugCachedLineCountForTest();
      }
    }
    expect(pinnedFull).toBe(0);
  });

  it('windowed paint of a mid-body slice matches legacy render slice for small bodies', () => {
    // Under cap: full cache + slice must equal paintContentRows.
    const body = Array.from({ length: 40 }, (_, r) => `line-${r}-abc`).join('\n');
    expect(body.length).toBeLessThan(TEXT_WINDOWED_BODY_CHAR_CAP);
    const text = new Text(body, 0, 0);
    const full = text.render(50);
    const viaWindow = text.paintContentRows(50, 5, 15);
    expect(viaWindow).toEqual(full.slice(5, 15));
  });
});
