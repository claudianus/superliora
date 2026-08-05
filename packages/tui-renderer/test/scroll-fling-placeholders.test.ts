import { describe, expect, it } from 'vitest';

import {
  Text,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  withTranscriptCheapPaintMode,
  type Component,
} from '../src';

/** A card that only exposes `render()` — the legacy (non-windowed) shape. */
class LegacyCard implements Component {
  renders = 0;
  constructor(private readonly lines: string[]) {}
  render(): string[] {
    this.renders += 1;
    return this.lines;
  }
  invalidate(): void {}
}

function legacyCards(count: number, rowsEach: number): LegacyCard[] {
  return Array.from(
    { length: count },
    (_, i) => new LegacyCard(Array.from({ length: rowsEach }, (_, r) => `card${i}-row${r}`)),
  );
}

function totalRenders(cards: readonly LegacyCard[]): number {
  return cards.reduce((sum, card) => sum + card.renders, 0);
}

/**
 * Cold rows render as a lone `…` in the content column. Match on the leading
 * glyph rather than the whole line — a scrollbar gutter is appended on the right.
 */
function placeholderRows(lines: readonly unknown[]): number {
  return lines.filter((line) => typeof line === 'string' && line.trimStart().startsWith('…'))
    .length;
}

/**
 * Repro: scroll to top, then fling to bottom. Each pure-scroll frame used to
 * cold-layout newly intersecting multi-k cards (budget>0), stacking into a
 * multi-second freeze. Fling detection must force placeholder-only paint.
 */
describe('top→bottom fling pure-scroll', () => {
  it('fling frames do not cold-layout multi-k children (placeholders only)', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 20,
      leftPad: 1,
      rightPad: 1,
    });

    let fullRenders = 0;
    for (let i = 0; i < 60; i++) {
      const body = Array.from({ length: 800 }, (_, r) => `card${i}-row${r}-${'x'.repeat(50)}`).join(
        '\n',
      );
      const text = new Text(body, 0, 0);
      const original = text.render.bind(text);
      text.render = (width: number) => {
        fullRenders += 1;
        return original(width);
      };
      transcript.addChild(text);
    }

    // Geometry warm (measure path).
    transcript.contentRowCount(90);

    // Jump near top then fling toward bottom with back-to-back pure-scroll paints.
    viewport.jumpToLine(0);
    fullRenders = 0;

    const t0 = performance.now();
    withTranscriptCheapPaintMode(() => {
      // First pure-scroll paint may materialize 1 card (non-fling).
      transcript.render(90);
      // Subsequent paints <40ms apart are flings — placeholders only.
      for (let step = 0; step < 40; step++) {
        viewport.scroll('line-down', 40);
        transcript.render(90);
      }
    });
    const ms = performance.now() - t0;

    // At most a handful of cold layouts (first frame budget), not 60 cards × fling.
    expect(fullRenders).toBeLessThan(8);
    expect(ms).toBeLessThan(400);
  });
});

/**
 * Scroll frames used to be forbidden from any cold layout, so every card the
 * wheel reached painted as `…` until the settle frame ~200ms later. That
 * blank/refill cycle at wheel cadence is the transcript scroll flicker.
 */
describe('wheel scroll over ordinary cards', () => {
  it('paints real content instead of … placeholders', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 20,
      leftPad: 1,
      rightPad: 1,
    });
    for (const card of legacyCards(40, 20)) transcript.addChild(card);

    transcript.contentRowCount(90);
    viewport.jumpToLine(0);

    let placeholders = 0;
    withTranscriptCheapPaintMode(() => {
      for (let step = 0; step < 60; step++) {
        viewport.scroll('line-down', 3);
        placeholders += placeholderRows(transcript.render(90));
      }
    });

    expect(placeholders).toBe(0);
  });

  it('keeps the fling guard for multi-k legacy bodies', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 20,
      leftPad: 1,
      rightPad: 1,
    });
    const cards = legacyCards(20, 2_000);
    for (const card of cards) transcript.addChild(card);

    transcript.contentRowCount(90);
    viewport.jumpToLine(0);
    for (const card of cards) card.renders = 0;

    let placeholders = 0;
    withTranscriptCheapPaintMode(() => {
      for (let step = 0; step < 30; step++) {
        viewport.scroll('line-down', 3);
        placeholders += placeholderRows(transcript.render(90));
      }
    });

    // Bodies this tall stay on the placeholder path — no full render per tick.
    expect(totalRenders(cards)).toBe(0);
    expect(placeholders).toBeGreaterThan(0);
  });

  it('re-materializes scroll-painted cards on the next content frame', () => {
    // Cheap paint short-circuits highlight/pretty-print to plain text, so a
    // slot filled during scroll must not be treated as an authoritative cache.
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 20,
      leftPad: 1,
      rightPad: 1,
    });
    const cards = legacyCards(40, 20);
    for (const card of cards) transcript.addChild(card);

    transcript.contentRowCount(90);
    viewport.jumpToLine(0);
    for (const card of cards) card.renders = 0;

    withTranscriptCheapPaintMode(() => {
      viewport.scroll('line-down', 3);
      transcript.render(90);
    });
    const scrollPainted = cards.filter((card) => card.renders > 0);
    expect(scrollPainted.length).toBeGreaterThan(0);
    expect(transcript.needsMaterializeContinue).toBe(true);

    const before = totalRenders(scrollPainted);
    transcript.render(90); // settle / content frame at the same offset
    expect(totalRenders(scrollPainted)).toBeGreaterThan(before);

    // Once upgraded, a further content frame no longer forces a cold re-render.
    const upgraded = totalRenders(scrollPainted);
    transcript.render(90);
    expect(totalRenders(scrollPainted)).toBe(upgraded + scrollPainted.length);
  });
});
