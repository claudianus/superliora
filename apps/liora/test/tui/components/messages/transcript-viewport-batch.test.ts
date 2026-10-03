import { afterEach, describe, expect, it, vi } from 'vitest';

import { IdleStageComponent } from '#/tui/components/chrome/idle-stage';
import { TranscriptViewportComponent } from '#/tui/components/messages/transcript-viewport';
import {
  resetTranscriptMeasureModeForTest,
  withTranscriptCheapPaintMode,
  type Component,
} from '#/tui/renderer';
import {
  createTranscriptViewportState,
  type TranscriptViewportState,
} from '#/tui/features/transcript/transcript-viewport';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  getActiveAppearancePreferences,
  setActiveAppearancePreferences,
} from '#/tui/features/appearance/appearance-effects';
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
    scroll: vi.fn(),
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
  const originalAppearance = getActiveAppearancePreferences();
  afterEach(() => {
    setActiveAppearancePreferences(originalAppearance);
    resetTranscriptMeasureModeForTest();
  });
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

  it('preserves sibling paint caches on live append outside a batch', () => {
    const container = makeViewport();
    // The renderer already invalidates the appended geometry slot. A whole
    // paint wipe would discard the history window on every streamed card.
    const invalidate = vi.spyOn(container, 'invalidate');
    const invalidatePaint = vi.spyOn(container, 'invalidatePaint');
    container.addChild(new StubComponent());
    container.addChild(new StubComponent());
    expect(invalidate).not.toHaveBeenCalled();
    expect(invalidatePaint).not.toHaveBeenCalled();
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

  it('keeps browsing position and warm visible rows when new live content arrives', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const viewport = createTranscriptViewportState();
    const container = new TranscriptViewportComponent(0, 1, viewport, () => 20);
    const renders = Array.from({ length: 30 }, (_, row) =>
      vi.fn(() => [`history-${String(row).padStart(3, '0')}`]),
    );
    for (const render of renders) container.addChild({ render, invalidate() {} });
    container.render(80);
    viewport.scroll('top');
    container.render(80);
    for (const render of renders) render.mockClear();
    const start = viewport.start();

    container.addChild({ render: () => ['new-live-content'], invalidate() {} });
    expect(viewport.followOutput).toBe(false);
    const painted = withTranscriptCheapPaintMode(() => container.render(80)).join('\n');
    expect(viewport.start()).toBe(start);
    for (let row = 0; row < 20; row++) {
      expect(painted).toContain(`history-${String(row).padStart(3, '0')}`);
      expect(renders[row]).not.toHaveBeenCalled();
    }
    expect(painted).not.toContain('new-live-content');
    expect(painted).not.toContain('…');
  });

  it('restores live follow only for the first real message replacing the empty hero', () => {
    const viewport = createTranscriptViewportState();
    const container = new TranscriptViewportComponent(0, 1, viewport, () => 20);
    container.addChild(makeIdle());
    viewport.sync(12, 5);
    viewport.scroll('top');
    expect(viewport.followOutput).toBe(false);
    container.addChild(new StubComponent());
    expect(viewport.followOutput).toBe(true);
    viewport.pauseFollowOutput();
    container.addChild(new StubComponent());
    expect(viewport.followOutput).toBe(false);
  });
});
