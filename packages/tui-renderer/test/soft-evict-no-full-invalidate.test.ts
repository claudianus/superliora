import { describe, expect, it } from 'vitest';

import {
  Container,
  Text,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
} from '../src';

/**
 * Soft-evict must never call full invalidate() on cards whose invalidate
 * rebuilds body / dirties geometry (ToolCall/Assistant pattern).
 */
describe('overflow soft-evict leaf paint drop only', () => {
  it('does not call full invalidate on ToolCall-style cards during eviction', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 12,
      leftPad: 1,
      rightPad: 1,
    });

    let fullInvalidateCalls = 0;
    let softDropCalls = 0;
    let rebuildBodyCalls = 0;

    class ToolCallStyleCard extends Container {
      private readonly body = new Text(
        Array.from({ length: 80 }, (_, r) => `tool-line-${r}`).join('\n'),
        0,
        0,
      );

      constructor() {
        super();
        this.addChild(this.body);
      }

      override invalidate(): void {
        fullInvalidateCalls += 1;
        rebuildBodyCalls += 1;
        this.body.setText(
          Array.from({ length: 80 }, (_, r) => `rebuilt-${r}-${Date.now()}`).join('\n'),
        );
        super.invalidate();
      }

      softDropPaintCaches(): void {
        softDropCalls += 1;
        super.softDropPaintCaches();
      }
    }

    const cards: ToolCallStyleCard[] = [];
    for (let i = 0; i < 40; i++) {
      const card = new ToolCallStyleCard();
      cards.push(card);
      transcript.addChild(card);
    }
    transcript.contentRowCount(80);

    // Jump through many cards so overflow retain LRU exceeds the hard cap.
    for (let i = 0; i < 40; i++) {
      viewport.jumpToLine(i * 80 + 1);
      // Multiple progressive content paints per jump to materialize.
      for (let p = 0; p < 4; p++) {
        transcript.render(80);
      }
    }

    expect(transcript.overflowRetainedFullLineChildCount).toBeLessThanOrEqual(
      TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
    );
    expect(fullInvalidateCalls).toBe(0);
    expect(rebuildBodyCalls).toBe(0);
    expect(softDropCalls).toBeGreaterThan(0);
  });

  it('does not tear down Assistant-style trees on soft-evict', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 12,
      leftPad: 1,
      rightPad: 1,
    });

    let fullInvalidateCalls = 0;
    let softDropCalls = 0;
    let markdownTeardowns = 0;

    class AssistantStyleCard extends Container {
      private markdown = new Text(
        Array.from({ length: 60 }, (_, r) => `assistant-${r}`).join('\n'),
        0,
        0,
      );

      constructor() {
        super();
        this.addChild(this.markdown);
      }

      override invalidate(): void {
        fullInvalidateCalls += 1;
        this.clear();
        markdownTeardowns += 1;
        this.markdown = new Text('reallocated', 0, 0);
        this.addChild(this.markdown);
      }

      softDropPaintCaches(): void {
        softDropCalls += 1;
        this.markdown.softDropPaintCaches();
      }
    }

    for (let i = 0; i < 40; i++) {
      transcript.addChild(new AssistantStyleCard());
    }
    transcript.contentRowCount(80);
    for (let i = 0; i < 40; i++) {
      viewport.jumpToLine(i * 60 + 1);
      for (let p = 0; p < 4; p++) transcript.render(80);
    }

    expect(fullInvalidateCalls).toBe(0);
    expect(markdownTeardowns).toBe(0);
    expect(softDropCalls).toBeGreaterThan(0);
  });
});
