/**
 * The non-overflow pure-scroll path may only fall back to placeholder rows when
 * there is genuinely no warm paint cache. Keying that check on the ambient epoch
 * made the cache look cold on every animation tick, so a wheel scroll over a
 * short transcript alternated between the painted window and a screen of `…`.
 */
import { describe, expect, it } from 'vitest';

import {
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  Text,
  withTranscriptCheapPaintMode,
} from '../src';

describe('transcript pure-scroll paint across ambient ticks', () => {
  it('reuses the painted window when the ambient tick advanced', () => {
    const viewport = new RendererTranscriptViewport();
    let epoch = 0;
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 3,
      getCacheEpoch: () => epoch,
    });
    component.addChild(new Text('alpha\nbeta\ngamma', 0, 0));

    // Content frame: paints for real and warms the cache.
    expect(component.render(40).join('\n')).toContain('alpha');

    // Ambient animation tick, then a scroll frame (cheap paint).
    epoch += 1;
    const scrolled = withTranscriptCheapPaintMode(() => component.render(40));

    expect(scrolled.join('\n')).toContain('alpha');
    expect(scrolled.join('\n')).not.toContain('…');
  });
});