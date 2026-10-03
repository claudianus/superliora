import { describe, expect, it } from 'vitest';

import {
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  Text,
  TEXT_WINDOWED_BODY_CHAR_CAP,
  withTranscriptCheapPaintMode,
} from '../src';

/** Multi-k plain source above the windowed char cap. */
function multiKBody(rows: number, width = 48): string {
  return Array.from({ length: rows }, (_, r) => `row-${r}-${'x'.repeat(width)}`).join('\n');
}

describe('windowed large-body paint (Phase D)', () => {
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

  it('scrolling one multi-k body keeps filled sparse slots viewport-class', () => {
    // Honest criterion-2 proxy: a single tall body still in the retain band must
    // not accumulate filled sparse for every visited local row (geometry height).
    // Also guards O(geometry) clear freezes: band storage is compact only.
    const visibleRows = 16;
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => visibleRows,
      leftPad: 1,
      rightPad: 1,
    });

    // One multi-k body (thousands of rows) + padding cards so overflow exists.
    const tallRows = 2_500;
    transcript.addChild(new Text(multiKBody(tallRows, 48), 0, 0));
    for (let i = 0; i < 8; i++) {
      transcript.addChild(new Text(`pad-${i}\nsecond`, 0, 0));
    }

    // Sync geometry, jump to top of tall body, content-walk through it.
    transcript.render(80);
    viewport.jumpToLine(0);
    // Walk deep into the tall body while it remains the retained intersecting child.
    // Keep step count moderate — paint must stay O(band) not O(geometry×steps).
    const started =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    for (let step = 0; step < 80; step++) {
      viewport.scroll('line-down');
      transcript.render(80);
    }
    const elapsed =
      (typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()) - started;
    // Synthetic bound: 80 content frames through multi-k must not block for seconds.
    expect(elapsed).toBeLessThan(5_000);

    const filled = transcript.overflowFilledSparseLineCount;
    // Retain band = viewport × (1 + 2 × OVERFLOW_RETAIN_VIEWPORTS) with margin on both sides.
    // OVERFLOW_RETAIN_VIEWPORTS = 2 → band ≤ visible × 5, plus a small multi-child slack.
    const maxViewportClass = visibleRows * 5 * 2; // 2 retained children slack
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThanOrEqual(maxViewportClass);
    // Must not approach geometry height of the tall body.
    expect(filled).toBeLessThan(tallRows * 0.1);
    expect(transcript.overflowRetainedRawLineCount).toBe(0);
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

  it('replaces a stale sparse band when a mounted windowed child changes', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 2,
    });
    let prefix = 'old';
    const child = {
      invalidate() {},
      render: () => Array.from({ length: 8 }, (_, i) => `${prefix}-${i}`),
      measureContentRows: () => 8,
      paintContentRows: (_width: number, start: number, end: number) =>
        Array.from({ length: end - start }, (_, i) => `${prefix}-${start + i}`),
    };
    transcript.addChild(child);
    expect(transcript.render(40)).toEqual(['old-6', 'old-7']);
    prefix = 'new';
    transcript.invalidateChildGeometry(child);
    expect(transcript.render(40)).toEqual(['new-6', 'new-7']);
  });

  it('maps row boundaries after zero-height cards, height changes and removal', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 2,
    });
    const empty = { render: () => [], invalidate() {} };
    const first = new Text('a\nb', 0, 0);
    const last = new Text('c\nd', 0, 0);
    transcript.addChild(empty);
    transcript.addChild(first);
    transcript.addChild(last);
    expect(transcript.childRowRangeAt(40, 0)?.child).toBe(first);
    expect(transcript.childRowRangeAt(40, 2)?.child).toBe(last);
    first.setText('a');
    transcript.invalidateChildGeometry(first);
    expect(transcript.childRowRangeAt(40, 1)?.child).toBe(last);
    expect(transcript.childRowRangeAt(40, 2)?.localRow).toBe(1);
    transcript.removeChild(first);
    expect(transcript.childRowRangeAt(40, 0)?.child).toBe(last);
    expect(transcript.childRowRangeAt(40, 2)).toBeUndefined();
  });

  it('refreshes rows across animated and settled window-mode transitions', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({ viewport, getVisibleRows: () => 1 });
    let animated = true;
    let label = 'pulse-1';
    const child = {
      invalidate() {},
      render: () => ['head', label],
      measureContentRows: () => 2,
      paintContentRows: (_width: number, start: number, end: number) => ['head', label].slice(start, end),
      canPaintContentRows: () => !animated,
    };
    transcript.addChild(child);
    expect(transcript.render(40)).toEqual(['pulse-1']);
    label = 'pulse-2';
    expect(transcript.render(40)).toEqual(['pulse-2']);
    animated = false;
    label = 'settled';
    expect(transcript.render(40)).toEqual(['settled']);
    animated = true;
    label = 'pulse-3';
    expect(transcript.render(40)).toEqual(['pulse-3']);
  });
});
