import { describe, expect, it, vi } from 'vitest';

import {
  Container,
  Markdown,
  Text,
  estimateTranscriptWrappedRowCount,
  measurePlaceholderLines,
  withTranscriptMeasureMode,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  RendererTruncatedOutputComponent,
} from '../src';

/**
 * How much cheaper the measure path must be than the full work it skips.
 *
 * The point of every test below is that measure mode skips work — full ANSI
 * wrap, full Markdown parse, per-row re-measure. Asserting a millisecond
 * number instead measured the host, not the code, and failed on a loaded
 * runner while passing on an idle laptop. Comparing against the expensive path
 * in the same process states the actual claim and holds on any machine,
 * because a slow host slows both sides.
 *
 * The bound is deliberately asymmetric. "Not slower than the full path" would
 * pass even if measure mode quietly fell back to doing the full work, which is
 * the one regression these tests exist to catch. Measured here, the measure
 * path runs roughly 40-50x under the full path, so requiring only 10x keeps
 * wide margin while still failing the moment the two converge.
 */
const MEASURE_MUST_BE_AT_LEAST = 10;

const gradientChar = (c: string) => `\x1B[0;1;38;2;61;155;255;48;2;11;15;20m${c}`;

function measureMustBeatFull(measureMs: number, fullMs: number): void {
  expect(measureMs).toBeLessThan(fullMs / MEASURE_MUST_BE_AT_LEAST);
}

/** Ten times the input must not cost anywhere near a hundred times the work. */
function mustScaleSubQuadratically(smallMs: number, tenXLargerMs: number): void {
  expect(tenXLargerMs).toBeLessThan(smallMs * 30);
}

describe('permanent freeze guards (measure + interactive scroll)', () => {
  it('estimateTranscriptWrappedRowCount is O(source) and stable', () => {
    const body = Array.from({ length: 5_000 }, (_, i) => `line-${i} ${'x'.repeat(40)}`).join('\n');
    const t0 = performance.now();
    const rows = estimateTranscriptWrappedRowCount(body, 40, 0);
    const ms = performance.now() - t0;
    expect(rows).toBeGreaterThan(5_000);
    // Warm the call, then compare a cold call against a deliberately far
    // heavier one. Counting rows by scanning the source is what makes this
    // linear; anything quadratic shows up as the ratio collapsing.
    const heavier = Array.from({ length: 50_000 }, (_, i) => `l${i} ${'x'.repeat(40)}`).join('\n');
    const h0 = performance.now();
    expect(estimateTranscriptWrappedRowCount(heavier, 40, 0)).toBeGreaterThan(50_000);
    const heavierMs = performance.now() - h0;
    mustScaleSubQuadratically(ms, heavierMs);
    expect(measurePlaceholderLines(rows).length).toBe(rows);
  });

  it('estimateTranscriptWrappedRowCount skips CSI params, not just the introducer', () => {
    // Regression: ESC [ already ends the escape-scan range, so parameter bytes
    // like `38;2;…m` were counted as visible columns. Per-char styled labels
    // (gradient loaders carrying a URL) measure ~30x tall — enough phantom
    // rows to push the painted window off every real transcript row.
    const label = 'Opening browser to authorize\nvisit:\n' + 'x'.repeat(200);
    const styled = label.split('').map(gradientChar).join('') + '\x1B[0m';
    expect(styled.length).toBeGreaterThan(8_000);

    const truth = new Text(styled, 0, 0).render(100).length;
    const estimate = estimateTranscriptWrappedRowCount(styled, 100, 0);
    expect(estimate).toBeLessThanOrEqual(truth + 2);
    expect(estimate).toBeGreaterThanOrEqual(truth);

    // OSC hyperlinks terminate on BEL / ST — payload must not count either.
    const linked = `\x1B]8;;https://example.com\x1B\\link text\x1B]8;;\x1B\\`;
    expect(estimateTranscriptWrappedRowCount(linked, 40, 0)).toBe(1);
  });

  it('viewport does not scroll past ANSI-heavy children whose measure is short', () => {
    const label = 'Opening browser to authorize\nvisit:\n' + 'x'.repeat(200);
    const styled = label.split('').map(gradientChar).join('') + '\x1B[0m';

    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 10,
    });
    transcript.addChild(new Text('head', 0, 0));
    transcript.addChild(new Text(styled, 0, 0));
    transcript.addChild(new Text('tail-visible', 0, 0));

    const painted = transcript.render(60);
    // Phantom geometry used to pin the follow-bottom window inside the
    // inflated child slot — every painted row came out blank.
    expect(painted.some((line) => line.includes('tail-visible'))).toBe(true);
    expect(transcript.contentRowCount(60)).toBeLessThanOrEqual(10);
  });

  it('Text under measure mode does not full-wrap multi-k bodies', () => {
    const body = Array.from({ length: 4_000 }, (_, i) => `ROW-${i}-${'z'.repeat(60)}`).join('\n');
    const text = new Text(body, 0, 0);

    text.invalidate();
    const t0 = performance.now();
    const measured = withTranscriptMeasureMode(() => text.render(80));
    const measureMs = performance.now() - t0;
    expect(measured.length).toBeGreaterThan(1_000);
    // The claim in the name: measure mode must skip the full wrap. The same
    // body rendered outside measure mode is the work being avoided, so it is
    // the honest yardstick — and the one the test's own comment described.
    text.invalidate();
    const f0 = performance.now();
    text.render(80);
    const fullMs = performance.now() - f0;
    measureMustBeatFull(measureMs, fullMs);
  });

  it('Markdown under measure mode does not parse multi-k cold history', () => {
    const body = Array.from({ length: 3_000 }, (_, i) => `### h${i}\n\nparagraph ${'w'.repeat(80)}`).join(
      '\n',
    );
    const md = new Markdown(body, 0, 0, {
      heading: (s) => s,
      link: (s) => s,
      linkUrl: (s) => s,
      code: (s) => s,
      codeBlock: (s) => s,
      codeBlockBorder: (s) => s,
      quote: (s) => s,
      quoteBorder: (s) => s,
      hr: (s) => s,
      listBullet: (s) => s,
      bold: (s) => s,
      italic: (s) => s,
      strikethrough: (s) => s,
      underline: (s) => s,
    });

    const t0 = performance.now();
    const lines = withTranscriptMeasureMode(() => md.render(100));
    const ms = performance.now() - t0;
    expect(lines.length).toBeGreaterThan(1_000);
    // Same shape as the Text case: the full parse is the work measure mode is
    // supposed to skip, so comparing against it tests the claim directly.
    const f0 = performance.now();
    md.render(100);
    const fullMs = performance.now() - f0;
    measureMustBeatFull(ms, fullMs);
  });

  it('contentRowCount of many huge cold children finishes under a hard wall budget', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 10,
    });
    for (let i = 0; i < 80; i++) {
      const body = Array.from({ length: 2_000 }, (_, r) => `c${i}-r${r}-${'x'.repeat(50)}`).join('\n');
      component.addChild(new Text(body, 0, 0));
    }
    const t0 = performance.now();
    const total = component.contentRowCount(80);
    const ms = performance.now() - t0;
    expect(total).toBeGreaterThan(0);
    // Without measure estimates this was multi-minute. Budget + estimate must keep it interactive.
    expect(ms).toBeLessThan(500);
  });

  it('TruncatedOutput multi-k contentRowCount does not throw on measure placeholders', () => {
    // Regression: measure mode returned { length: n } from Text; TruncatedOutput
    // then spread/sliced it → TypeError: n.lines is not iterable.
    const body = Array.from({ length: 500 }, (_, i) => `${'x'.repeat(40)}${i}`).join('\n');
    expect(body.length).toBeGreaterThan(8_000);

    const truncated = new RendererTruncatedOutputComponent(body, {
      expanded: false,
      maxLines: 3,
    });
    const measured = withTranscriptMeasureMode(() => truncated.render(80));
    expect(Array.isArray(measured)).toBe(true);
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.length).toBeLessThanOrEqual(4); // preview + footer

    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 12,
    });
    // Direct child + nested in Container (tool-call shape).
    transcript.addChild(truncated);
    const nested = new Container();
    nested.addChild(
      new RendererTruncatedOutputComponent(body, { expanded: true, maxLines: 5 }),
    );
    transcript.addChild(nested);

    expect(() => transcript.contentRowCount(80)).not.toThrow();
    expect(transcript.contentRowCount(80)).toBeGreaterThan(0);
  });

  it('Container under measure mode does not spread multi-k Text placeholders', () => {
    const body = Array.from({ length: 400 }, (_, i) => `${'z'.repeat(50)}${i}`).join('\n');
    const box = new Container();
    box.addChild(new Text(body, 0, 0));
    const measured = withTranscriptMeasureMode(() => box.render(80));
    expect(measured.length).toBeGreaterThan(100);
    // Geometry may use a length-only stub for very tall containers.
    expect(typeof measured.length).toBe('number');
  });

  it('continues provisional geometry without bypassing the visible paint budget', () => {
    let now = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const viewport = new RendererTranscriptViewport();
      const transcript = new RendererTranscriptViewportComponent({
        viewport,
        getVisibleRows: () => 100,
      });
      let paints = 0;
      for (let i = 0; i < 50; i++) {
        transcript.addChild({
          invalidate() {},
          measureContentRows: () => {
            now += 5;
            return 1;
          },
          render: () => {
            paints += 1;
            return [`row-${i}`];
          },
        });
      }
      transcript.render(40);
      expect(paints).toBeLessThan(50);
      expect(transcript.needsMaterializeContinue).toBe(true);
      for (let frame = 0; frame < 60 && transcript.needsMaterializeContinue; frame++) {
        transcript.render(40);
      }
      expect(transcript.needsMaterializeContinue).toBe(false);
      expect(transcript.render(40)).toEqual(
        Array.from({ length: 50 }, (_, i) => `row-${i}`),
      );
    } finally {
      clock.mockRestore();
    }
  });

});
