import { describe, expect, it } from 'vitest';

import {
  Markdown,
  RendererChildrenRenderCache,
  RendererTruncatedOutputComponent,
  RendererWidthRenderCache,
  shouldSkipExpensiveTranscriptFormat,
  withTranscriptCheapPaintMode,
  withTranscriptMeasureMode,
  type Component,
} from '../src';

function hugeMarkdownSource(lineCount: number): string {
  const body = Array.from({ length: lineCount }, (_, i) => `const x${i} = ${i};`).join('\n');
  return `\`\`\`ts\n${body}\n\`\`\``;
}

function makeMarkdown(source: string, onHighlight: () => void): Markdown {
  return new Markdown(source, 0, 0, {
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
      onHighlight();
      // Cheap paint short-circuits higher up; when this runs it is full paint.
      return code.split('\n').map((line) => `COL:${line}`);
    },
  });
}

describe('transcript cheap-paint mode', () => {
  it('flags shouldSkipExpensiveTranscriptFormat under measure and cheap paint', () => {
    expect(shouldSkipExpensiveTranscriptFormat()).toBe(false);
    withTranscriptMeasureMode(() => {
      expect(shouldSkipExpensiveTranscriptFormat()).toBe(true);
    });
    withTranscriptCheapPaintMode(() => {
      expect(shouldSkipExpensiveTranscriptFormat()).toBe(true);
    });
    expect(shouldSkipExpensiveTranscriptFormat()).toBe(false);
  });

  it('amortizes pure-scroll width cache after the first cheap frame', () => {
    const cache = new RendererWidthRenderCache();
    let builds = 0;
    const render = (width: number) => {
      builds += 1;
      return [`w${width}`];
    };

    withTranscriptCheapPaintMode(() => {
      for (let i = 0; i < 20; i++) {
        expect(cache.render({ width: 12, render })).toEqual(['w12']);
      }
    });
    // One build for cold cheap frame; remaining 19 pure-scroll frames hit cheap cache.
    expect(builds).toBe(1);

    // Full paint builds once and supersedes cheap.
    expect(cache.render({ width: 12, render })).toEqual(['w12']);
    expect(builds).toBe(2);
    expect(cache.render({ width: 12, render })).toEqual(['w12']);
    expect(builds).toBe(2);
  });

  it('TruncatedOutput stays plain under cheap paint without scheduling format', () => {
    const body = `${'x'.repeat(2_000)}\nmore\nlines\nhere`;
    let formatCalls = 0;
    let scheduleCount = 0;
    let scheduled: (() => void) | undefined;
    const component = new RendererTruncatedOutputComponent(body, {
      expanded: false,
      maxLines: 2,
      deferFormatAboveChars: 100,
      formatText: (text) => {
        formatCalls += 1;
        return `FMT:${text.slice(0, 12)}`;
      },
      onDeferredFormat: (apply) => {
        scheduleCount += 1;
        scheduled = apply;
      },
    });

    withTranscriptCheapPaintMode(() => {
      const lines = component.render(80);
      expect(formatCalls).toBe(0);
      expect(scheduleCount).toBe(0);
      expect(lines.some((l) => l.includes('x'.repeat(8)))).toBe(true);
      expect(lines.some((l) => l.includes('FMT:'))).toBe(false);
    });

    // Real paint schedules deferred format once.
    component.render(80);
    expect(scheduleCount).toBe(1);
    expect(scheduled).toBeTypeOf('function');
    scheduled?.();
    expect(formatCalls).toBe(1);
    expect(component.render(80).some((l) => l.includes('FMT:'))).toBe(true);
  });

  it('Markdown does not pin cheap-paint plain fences as permanent full cache', () => {
    let highlightCalls = 0;
    const md = makeMarkdown('```js\nconst a = 1\n```', () => {
      highlightCalls += 1;
    });

    withTranscriptCheapPaintMode(() => {
      md.render(48);
    });
    const afterCheap = highlightCalls;

    const painted = md.render(48);
    expect(highlightCalls).toBeGreaterThan(afterCheap);
    expect(painted.some((line) => line.includes('COL:'))).toBe(true);
  });

  it('N pure-scroll paints of cold large Markdown stay O(1) after first cheap frame', () => {
    let layoutPasses = 0;
    // Track highlightCode invocations; under cheap paint highlightLines short-
    // circuits before theme.highlightCode when using liora, but Markdown still
    // calls theme.highlightCode for fences. Count renderUncached via highlight.
    const md = makeMarkdown(hugeMarkdownSource(2_000), () => {
      layoutPasses += 1;
    });

    withTranscriptCheapPaintMode(() => {
      const first = md.render(80);
      expect(first.length).toBeGreaterThan(100);
      const afterFirst = layoutPasses;

      for (let frame = 0; frame < 20; frame++) {
        const again = md.render(80);
        // Multi-k cheap stand-ins intentionally do NOT pin array identity
        // (overflow eviction owns retention; pin would fight soft-evict).
        expect(again.length).toBe(first.length);
      }
      // No fence highlight under multi-k cheap paint.
      expect(layoutPasses).toBe(afterFirst);
      expect(layoutPasses).toBe(0);
    });

    // Full paint must re-enter highlight once (not stuck on cheap plain).
    const full = md.render(80);
    expect(layoutPasses).toBeGreaterThan(0);
    expect(full.some((line) => line.includes('COL:'))).toBe(true);
  });

  it('eight cold multi-k Markdown cards amortize across pure-scroll frames', () => {
    let highlightCalls = 0;
    const cards = Array.from({ length: 8 }, () =>
      makeMarkdown(hugeMarkdownSource(4_000), () => {
        highlightCalls += 1;
      }),
    );

    withTranscriptCheapPaintMode(() => {
      // Frame 0: cold intersection of all 8 cards.
      for (const card of cards) card.render(100);
      const coldCalls = highlightCalls;

      // Frames 1..19: pure scroll over the same cards — must not re-layout.
      for (let frame = 0; frame < 19; frame++) {
        for (const card of cards) card.render(100);
      }
      // Re-paid layout is what thrash means here, and the highlight counter says
      // so deterministically. Elapsed time cannot: measured per-frame warm cost
      // sits within noise of one cold frame, so any ms budget is a runner-speed
      // assertion wearing a performance costume.
      expect(highlightCalls).toBe(coldCalls);
    });
  });

  it('RendererChildrenRenderCache amortizes pure-scroll after first cheap frame', () => {
    // Stable line-array identity mimics Text/Markdown width caches under scroll.
    let stableLines: string[] | undefined;
    let childRenders = 0;
    const child: Component = {
      invalidate() {},
      render(width: number) {
        childRenders += 1;
        const key = `child-${width}`;
        if (stableLines?.[0] === key) return stableLines;
        stableLines = [key];
        return stableLines;
      },
    };
    const cache = new RendererChildrenRenderCache();

    let firstOut: string[] | undefined;
    withTranscriptCheapPaintMode(() => {
      firstOut = cache.render({ width: 40, children: [child] });
      const afterCold = childRenders;
      for (let frame = 0; frame < 12; frame++) {
        const again = cache.render({ width: 40, children: [child] });
        // Parent flatten reuses the same out array when child line refs match.
        expect(again).toBe(firstOut);
      }
      // Child still probed for identity, but cold layout happened once.
      expect(childRenders).toBeGreaterThan(afterCold);
    });
    expect(firstOut).toEqual(['child-40']);
  });
});
