import { describe, expect, it } from 'vitest';

import {
  Markdown,
  Text,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  withTranscriptCheapPaintMode,
} from '../src';

function hugeMarkdown(lines: number): Markdown {
  const body = Array.from({ length: lines }, (_, i) => `### h${i}\n\npara ${'w'.repeat(60)}`).join(
    '\n',
  );
  return new Markdown(body, 0, 0, {
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
}

describe('pure-scroll cold materialize budget', () => {
  it('Markdown cheap paint of multi-k body stays interactive', () => {
    const md = hugeMarkdown(2_500);
    const t0 = performance.now();
    const lines = withTranscriptCheapPaintMode(() => md.render(100));
    const ms = performance.now() - t0;
    expect(lines.length).toBeGreaterThan(100);
    // Full markdown parse of this body is hundreds of ms; plain cheap path must stay small.
    expect(ms).toBeLessThan(120);
  });

  it('wheel storm over many huge cold cards does not thrash layout', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 24,
      leftPad: 1,
      rightPad: 1,
    });
    for (let i = 0; i < 40; i++) {
      const body = Array.from({ length: 1_500 }, (_, r) => `c${i}-r${r}-${'x'.repeat(40)}`).join(
        '\n',
      );
      transcript.addChild(new Text(body, 0, 0));
    }
    // Warm geometry once.
    transcript.contentRowCount(80);

    const t0 = performance.now();
    withTranscriptCheapPaintMode(() => {
      for (let frame = 0; frame < 25; frame++) {
        viewport.scroll('line-up', 3);
        const painted = transcript.render(80);
        expect(painted.length).toBeLessThanOrEqual(30);
      }
    });
    const ms = performance.now() - t0;
    // Without cold budgets this was multi-second freezes.
    expect(ms).toBeLessThan(800);
  });
});
