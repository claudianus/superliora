import { describe, expect, it } from 'vitest';

import {
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
} from '#/tui/renderer';
import { TruncatedOutputComponent } from '#/tui/components/messages/tool-renderers/truncated';

function strip(text: string): string {
  return text.replaceAll(/\[[0-9;]*m/g, '');
}

function buildViewport(visibleRows: number): {
  viewport: RendererTranscriptViewport;
  component: RendererTranscriptViewportComponent;
} {
  const viewport = new RendererTranscriptViewport();
  const component = new RendererTranscriptViewportComponent({
    viewport,
    getVisibleRows: () => visibleRows,
    leftPad: 0,
    rightPad: 0,
    scrollbar: false,
  });
  return { viewport, component };
}

/**
 * Collects every line the viewport shows while scrolling from the tail to the
 * top — the union a user can read by scrolling alone.
 */
function collectScrolledLines(
  component: RendererTranscriptViewportComponent,
  viewport: RendererTranscriptViewport,
  width: number,
  maxScrolls: number,
): string {
  const seen: string[] = [];
  for (let i = 0; i < maxScrolls; i++) {
    seen.push(...component.render(width));
    viewport.scroll('line-up');
  }
  seen.push(...component.render(width));
  return strip(seen.join('\n'));
}

describe('transcript scroll reveal over the viewport window', () => {
  const output = Array.from(
    { length: 30 },
    (_, i) => `line-${String(i).padStart(2, '0')}`,
  ).join('\n');

  it('collapsed previews hide lines from scrolling and show the scroll hint', () => {
    const { viewport, component } = buildViewport(6);
    component.addChild(
      new TruncatedOutputComponent(output, {
        expanded: false,
        isError: false,
        maxLines: 3,
      }),
    );

    const seen = collectScrolledLines(component, viewport, 40, 15);
    // Preview lines are reachable...
    expect(seen).toContain('line-00');
    expect(seen).toContain('line-02');
    // ...but the hidden tail is not, no matter how much we scroll...
    expect(seen).not.toContain('line-29');
    expect(seen).not.toContain('line-10');
    // ...and the footer promises the scroll gesture.
    expect(seen).toContain('⋯ 27 more lines — scroll for more');
  });

  it('expanded blocks expose every line through viewport scrolling', () => {
    const { viewport, component } = buildViewport(6);
    // Expanded truncated bodies remain readable via the transcript viewport.
    component.addChild(
      new TruncatedOutputComponent(output, {
        expanded: true,
        isError: false,
        maxLines: 3,
      }),
    );

    const seen = collectScrolledLines(component, viewport, 40, 15);
    for (let i = 0; i < 30; i++) {
      expect(seen).toContain(`line-${String(i).padStart(2, '0')}`);
    }
    expect(seen).not.toContain('scroll for more');
  });

  it('keeps the newest output in view before any scroll (follow-output)', () => {
    const { component } = buildViewport(6);
    component.addChild(
      new TruncatedOutputComponent(output, {
        expanded: true,
        isError: false,
        maxLines: 3,
      }),
    );

    const firstFrame = strip(component.render(40).join('\n'));
    expect(firstFrame).toContain('line-29');
    expect(firstFrame).not.toContain('line-00');
  });
});
