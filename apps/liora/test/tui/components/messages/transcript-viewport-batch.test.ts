import { describe, expect, it, vi } from 'vitest';

import { IdleStageComponent } from '#/tui/components/chrome/idle-stage';
import { TranscriptViewportComponent } from '#/tui/components/messages/transcript-viewport';
import type { Component } from '#/tui/renderer';
import type { TranscriptViewportState } from '#/tui/features/transcript/transcript-viewport';
import type { AppState } from '#/tui/types';

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

function makeIdle(): IdleStageComponent {
  return new IdleStageComponent({
    state: {
      streamingPhase: 'idle',
      thinking: false,
      appearance: undefined,
    } as unknown as AppState,
    preferredRows: 12,
  });
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

  it('paint-invalidates on every addChild outside a batch (keeps geometry)', () => {
    const container = makeViewport();
    // Streaming appends must not cascade full invalidate() (that clears every
    // sibling render cache and forces O(n) geometry remeasure). Paint-only
    // drop is enough; line counts reconcile by child identity.
    const invalidate = vi.spyOn(container, 'invalidate');
    const invalidatePaint = vi.spyOn(container, 'invalidatePaint');
    container.addChild(new StubComponent());
    container.addChild(new StubComponent());
    expect(invalidate).not.toHaveBeenCalled();
    expect(invalidatePaint).toHaveBeenCalledTimes(2);
  });

  it('tracks IdleStage mount with an O(1) flag', () => {
    const container = makeViewport();
    expect(container.hasIdleStageMounted).toBe(false);

    const idle = makeIdle();
    container.addChild(idle);
    expect(container.hasIdleStageMounted).toBe(true);

    container.dismissIdleStage();
    expect(container.hasIdleStageMounted).toBe(false);
    expect(container.children.some((c) => c instanceof IdleStageComponent)).toBe(false);

    // Real content still clears the flag via dismissIdleStage.
    container.addChild(makeIdle());
    expect(container.hasIdleStageMounted).toBe(true);
    container.addChild(new StubComponent());
    expect(container.hasIdleStageMounted).toBe(false);
  });
});
