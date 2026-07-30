import { describe, expect, it, vi } from 'vitest';

import { TranscriptViewportComponent } from '#/tui/components/messages/transcript-viewport';
import type { Component } from '#/tui/renderer';
import type { TranscriptViewportState } from '#/tui/features/transcript/transcript-viewport';

class StubComponent implements Component {
  invalidate = vi.fn();
  render(): string[] {
    return ['stub'];
  }
}

function makeViewport(): TranscriptViewportComponent {
  const viewport = {
    sync: () => ({ start: 0, end: 0, hasOverflow: false }),
  } as unknown as TranscriptViewportState;
  return new TranscriptViewportComponent(0, 1, viewport, () => 20);
}

describe('TranscriptViewportComponent batch mount', () => {
  it('defers invalidate until endBatchMount', () => {
    const container = makeViewport();
    const invalidate = vi.spyOn(container, 'invalidate');

    container.beginBatchMount();
    container.addChild(new StubComponent());
    container.addChild(new StubComponent());
    expect(invalidate).not.toHaveBeenCalled();
    expect(container.isBatchMounting).toBe(true);
    expect(container.children).toHaveLength(2);

    container.endBatchMount();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(container.isBatchMounting).toBe(false);
  });

  it('invalidates on every addChild outside a batch', () => {
    const container = makeViewport();
    const invalidate = vi.spyOn(container, 'invalidate');
    container.addChild(new StubComponent());
    container.addChild(new StubComponent());
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
