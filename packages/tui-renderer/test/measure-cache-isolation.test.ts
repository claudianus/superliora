import { describe, expect, it } from 'vitest';

import {
  Markdown,
  RendererWidthRenderCache,
  withTranscriptMeasureMode,
} from '../src';

describe('measure-mode paint cache isolation', () => {
  it('Markdown cheap measure cache is not used as permanent full paint', () => {
    let highlightCalls = 0;
    const md = new Markdown(
      '```ts\nconst x = 1\n```',
      0,
      0,
      {
        heading: (t) => t,
        link: (t) => t,
        linkUrl: (t) => t,
        code: (t) => t,
        codeBlock: (t) => t,
        codeBlockBorder: (t) => t,
        quote: (t) => t,
        quoteBorder: (t) => t,
        hr: (t) => t,
        listBullet: (t) => t,
        bold: (t) => t,
        italic: (t) => t,
        strikethrough: (t) => t,
        underline: (t) => t,
        highlightCode: (code) => {
          highlightCalls += 1;
          return code.split('\n').map((line) => `HL:${line}`);
        },
      },
    );

    // Measure stores a cheap layout slot only; full paint must still highlight.
    withTranscriptMeasureMode(() => {
      md.render(40);
    });
    const callsAfterMeasure = highlightCalls;

    const painted = md.render(40);
    expect(highlightCalls).toBeGreaterThan(callsAfterMeasure);
    expect(painted.some((line) => line.includes('HL:'))).toBe(true);

    const callsBeforeCached = highlightCalls;
    md.render(40);
    expect(highlightCalls).toBe(callsBeforeCached);
  });

  it('RendererWidthRenderCache keeps measure and full paint slots separate', () => {
    const cache = new RendererWidthRenderCache();
    let builds = 0;
    const render = (width: number) => {
      builds += 1;
      return [`w${width}-b${builds}`];
    };

    withTranscriptMeasureMode(() => {
      expect(cache.render({ width: 10, render })).toEqual(['w10-b1']);
    });
    expect(builds).toBe(1);

    // Full paint does not reuse cheap slot content identity forever as "full".
    expect(cache.render({ width: 10, render })).toEqual(['w10-b2']);
    expect(builds).toBe(2);
    expect(cache.render({ width: 10, render })).toEqual(['w10-b2']);
    expect(builds).toBe(2);
  });
});
