import { describe, expect, it } from 'vitest';

import {
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  type RendererComponent,
} from '../src';

class CountingComponent implements RendererComponent {
  readonly renderWidths: number[] = [];

  constructor(private readonly lines: string[]) {}

  render(width: number): string[] {
    this.renderWidths.push(width);
    return this.lines;
  }

  invalidate(): void {}
}

function createTranscript(lines: string[]): {
  component: RendererTranscriptViewportComponent;
  child: CountingComponent;
} {
  const viewport = new RendererTranscriptViewport();
  const component = new RendererTranscriptViewportComponent({
    viewport,
    getVisibleRows: () => 3,
  });
  const child = new CountingComponent(lines);
  component.addChild(child);
  return { component, child };
}

describe('RendererTranscriptViewportComponent line-count cache', () => {
  it('reuses cached line counts when the width oscillates (LRU, not single slot)', () => {
    const { component, child } = createTranscript(['one', 'two', 'three', 'four', 'five']);

    expect(component.contentRowCount(80)).toBe(5);
    expect(child.renderWidths).toEqual([80]);

    expect(component.contentRowCount(60)).toBe(5);
    expect(child.renderWidths).toEqual([80, 60]);

    // The width-60 pass must not have evicted the width-80 entry: the second
    // width-80 pass is served from cache without re-rendering the child.
    expect(component.contentRowCount(80)).toBe(5);
    expect(child.renderWidths).toEqual([80, 60]);
  });

  it('evicts the oldest entry past the LRU cap', () => {
    const { component, child } = createTranscript(['a', 'b']);

    for (const width of [40, 42, 44, 46]) {
      expect(component.contentRowCount(width)).toBe(2);
    }
    expect(child.renderWidths).toEqual([40, 42, 44, 46]);

    // A fifth width fills the cap and evicts the oldest (40).
    expect(component.contentRowCount(48)).toBe(2);
    expect(child.renderWidths).toEqual([40, 42, 44, 46, 48]);

    // 46 is still cached (hit), 40 was evicted (miss → re-render).
    expect(component.contentRowCount(46)).toBe(2);
    expect(child.renderWidths).toEqual([40, 42, 44, 46, 48]);
    expect(component.contentRowCount(40)).toBe(2);
    expect(child.renderWidths).toEqual([40, 42, 44, 46, 48, 40]);
  });

  it('skips the phase-1 child render on a width cache hit during full render', () => {
    const { component, child } = createTranscript(['one', 'two', 'three', 'four', 'five']);

    component.render(80);
    const afterFirst = child.renderWidths.length;
    component.render(60);
    const afterSecond = child.renderWidths.length;
    component.render(80);
    const afterThird = child.renderWidths.length;

    // Both cache-miss passes render the child twice (line counts + visible
    // window); the width-80 replay hits the LRU and only renders the visible
    // window.
    expect(afterSecond - afterFirst).toBe(2);
    expect(afterThird - afterSecond).toBe(1);
  });

  it('resolves child and local rows from cached logical transcript ranges', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 3,
      leftPad: 2,
      rightPad: 2,
    });
    const first = new CountingComponent(['a', 'b']);
    const second = new CountingComponent(['c', 'd', 'e']);
    component.addChild(first);
    component.addChild(second);

    expect(component.childRowRangeAt(20, 0)).toEqual({
      child: first,
      childIndex: 0,
      renderWidth: 16,
      startRow: 0,
      endRow: 2,
      localRow: 0,
    });
    expect(component.childRowRangeAt(20, 1)?.localRow).toBe(1);
    expect(component.childRowRangeAt(20, 2)).toEqual({
      child: second,
      childIndex: 1,
      renderWidth: 16,
      startRow: 2,
      endRow: 5,
      localRow: 0,
    });
    expect(component.childRowRangeAt(20, 4)?.localRow).toBe(2);
    expect(component.childRowRangeAt(20, -1)).toBeUndefined();
    expect(component.childRowRangeAt(20, 5)).toBeUndefined();

    expect(first.renderWidths).toEqual([16]);
    expect(second.renderWidths).toEqual([16]);
  });
});
