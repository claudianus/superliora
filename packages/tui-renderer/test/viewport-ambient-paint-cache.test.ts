/**
 * A fresh install runs a ~60fps ambient frame loop, and a pure animation frame
 * still walks the transcript paint path. The formatted lines of an unchanged
 * child must survive an ambient tick: keying the full-paint cache on the
 * ambient epoch re-formatted every visible line of a short transcript every
 * ~16ms. Child components that truly animate already rebuild their own line
 * arrays (their render cache embeds the epoch), so the parent sees a new array
 * reference and re-paints exactly those rows.
 */
import { describe, expect, it } from 'vitest';

import {
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  Text,
  withTranscriptCheapPaintMode,
} from '../src';

function paintCounter(): { readonly lines: string[]; readonly paintLine: (line: string) => string } {
  const lines: string[] = [];
  return {
    lines,
    paintLine: (line: string) => {
      lines.push(line);
      return line;
    },
  };
}

describe('transcript full-paint cache across ambient ticks', () => {
  it('reuses formatted lines for an unchanged child when the ambient epoch advances', () => {
    const viewport = new RendererTranscriptViewport();
    const { lines: painted, paintLine } = paintCounter();
    let epoch = 0;
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 3,
      getCacheEpoch: () => epoch,
      paintLine,
    });
    component.addChild(new Text('alpha\nbeta\ngamma', 0, 0));

    expect(component.render(40)).toHaveLength(3);
    const afterFirstFrame = painted.length;
    expect(afterFirstFrame).toBeGreaterThan(0);

    // Ambient animation tick: no child content changed.
    epoch += 1;
    expect(component.render(40)).toHaveLength(3);
    expect(painted.length).toBe(afterFirstFrame);
  });

  it('re-paints a child whose own render output changed', () => {
    const viewport = new RendererTranscriptViewport();
    const { lines: painted, paintLine } = paintCounter();
    let epoch = 0;
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 3,
      getCacheEpoch: () => epoch,
      paintLine,
    });
    const child = new Text('alpha\nbeta\ngamma', 0, 0);
    component.addChild(child);

    component.render(40);
    const afterFirstFrame = painted.length;

    epoch += 1;
    child.setText('alpha\nbeta\nDELTA');
    component.render(40);
    expect(painted.length).toBeGreaterThan(afterFirstFrame);
  });

  it('updates visible overflow rows when a live child returns new output', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 2,
    });
    let lines = ['a', 'b', 'old-c', 'old-d'];
    component.addChild({ render: () => lines, invalidate() {} });
    expect(component.render(40)).toEqual(['old-c', 'old-d']);
    lines = ['a', 'b', 'new-c', 'new-d'];
    expect(component.render(40)).toEqual(['new-c', 'new-d']);
  });

  it('keeps cached history readable while a live card is appended', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 1,
    });
    component.addChild({
      render: () => Array.from({ length: 300 }, (_, i) => `history-${i}`),
      invalidate() {},
    });
    component.render(40);
    viewport.jumpToLine(0);
    component.render(40);
    component.addChild({ render: () => ['live'], invalidate() {} });
    component.contentRowCount(40);
    viewport.scroll('bottom');
    expect(component.render(40)).toEqual(['live']);
    viewport.jumpToLine(0);
    expect(withTranscriptCheapPaintMode(() => component.render(40))).toEqual(['history-0']);
  });
});