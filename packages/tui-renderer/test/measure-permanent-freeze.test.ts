import { describe, expect, it } from 'vitest';

import {
  Markdown,
  Text,
  estimateTranscriptWrappedRowCount,
  measurePlaceholderLines,
  withTranscriptMeasureMode,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
} from '../src';
import { isInteractiveRenderCause } from '../src/native-renderer/auto-frame-hold';
import { BACKPRESSURE_STUCK_TIMEOUT_MS } from '../src/native-renderer/backpressure';

describe('permanent freeze guards (measure + interactive scroll)', () => {
  it('estimateTranscriptWrappedRowCount is O(source) and stable', () => {
    const body = Array.from({ length: 5_000 }, (_, i) => `line-${i} ${'x'.repeat(40)}`).join('\n');
    const t0 = performance.now();
    const rows = estimateTranscriptWrappedRowCount(body, 40, 0);
    const ms = performance.now() - t0;
    expect(rows).toBeGreaterThan(5_000);
    expect(ms).toBeLessThan(50);
    expect(measurePlaceholderLines(rows).length).toBe(rows);
  });

  it('Text under measure mode does not full-wrap multi-k bodies', () => {
    const body = Array.from({ length: 4_000 }, (_, i) => `ROW-${i}-${'z'.repeat(60)}`).join('\n');
    const text = new Text(body, 0, 0);

    text.invalidate();
    const t0 = performance.now();
    const measured = withTranscriptMeasureMode(() => text.render(80));
    const measureMs = performance.now() - t0;
    expect(measured.length).toBeGreaterThan(1_000);
    // Full ANSI wrap of this body is expensive; measure estimate must stay tiny.
    expect(measureMs).toBeLessThan(80);
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
    // Full Markdown parse+wrap of this body is hundreds of ms; measure must stay small.
    expect(ms).toBeLessThan(100);
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

  it('interactive causes include transcript-scroll for backpressure bypass', () => {
    expect(isInteractiveRenderCause('transcript-scroll')).toBe(true);
    expect(isInteractiveRenderCause('input')).toBe(true);
    expect(isInteractiveRenderCause('resize')).toBe(true);
    expect(isInteractiveRenderCause('request')).toBe(false);
    expect(isInteractiveRenderCause('animation')).toBe(false);
    expect(BACKPRESSURE_STUCK_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
