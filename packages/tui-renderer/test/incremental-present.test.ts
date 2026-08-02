import { describe, expect, it } from 'vitest';

import {
  IncrementalRenderer,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  Text,
  TranscriptVisibleLinePresenter,
} from '../src';

describe('incremental present path (Phase C)', () => {
  it('stable re-present of identical lines skips clean rows', () => {
    const presenter = new TranscriptVisibleLinePresenter({ frameBudgetMs: 50 });
    const lines = Array.from({ length: 40 }, (_, i) => `stable-line-${i}-xxxxxxxx`);

    const first = presenter.present(lines);
    expect(first.stats.repaintedLines).toBe(40);
    expect(first.stats.skippedLines).toBe(0);
    expect(first.hasPendingDirty).toBe(false);

    const second = presenter.present(lines);
    // Clean re-present: nothing dirty → zero repaint, full skip.
    expect(second.stats.repaintedLines).toBe(0);
    expect(second.stats.skippedLines).toBe(40);
    expect(second.stats.visibleLines).toBe(40);
    expect(second.paintCommands.length).toBe(0);
  });

  it('only dirty subset is repainted after a partial update', () => {
    const presenter = new TranscriptVisibleLinePresenter({ frameBudgetMs: 50 });
    const lines = Array.from({ length: 30 }, (_, i) => `row-${i}`);
    presenter.present(lines);

    const next = lines.slice();
    next[5] = 'row-5-CHANGED';
    next[6] = 'row-6-CHANGED';
    const result = presenter.present(next);

    expect(result.stats.repaintedLines).toBe(2);
    expect(result.stats.skippedLines).toBe(28);
    expect(result.paintCommands.length).toBe(2);
    expect(result.paintCommands.map((c) => c.row).sort()).toEqual([5, 6]);
  });

  it('frame budget stops dirty work and reports pending', () => {
    // Tiny budget so multi-line dirty present cannot finish in one frame.
    const engine = new IncrementalRenderer({ frameBudgetMs: 0, useHashing: true });
    for (let i = 0; i < 200; i++) {
      engine.appendLine(`dirty-seed-${i}-${'z'.repeat(80)}`);
    }
    // All dirty on first present.
    const commands = engine.computePaintCommands({ start: 0, end: 200 });
    // With 0ms budget, at most one dirty line may slip through before the check
    // — remaining must stay pending.
    expect(commands.length).toBeLessThan(200);
    expect(engine.hasPendingDirtyLines({ start: 0, end: 200 })).toBe(true);
    expect(engine.lastFrameStats.repaintedLines).toBeLessThan(200);
  });

  it('shipped viewport present path skips clean lines on stable re-render', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 16,
      leftPad: 1,
      rightPad: 1,
    });

    for (let i = 0; i < 12; i++) {
      transcript.addChild(
        new Text(Array.from({ length: 8 }, (_, r) => `card${i}-r${r}`).join('\n'), 0, 0),
      );
    }
    // Warm geometry + first present (dirty).
    transcript.render(80);
    const first = transcript.lastIncrementalPresentStats;
    expect(first).toBeDefined();
    expect(first!.visibleLines).toBeGreaterThan(0);
    expect(first!.repaintedLines).toBe(first!.visibleLines);

    // Stable re-present — same viewport, same content.
    transcript.render(80);
    const second = transcript.lastIncrementalPresentStats!;
    expect(second.repaintedLines).toBe(0);
    expect(second.skippedLines).toBe(second.visibleLines);
    expect(second.skippedLines).toBeGreaterThan(0);
    // Prove skip-clean: repaint ≪ visible on stable frame.
    expect(second.repaintedLines).toBeLessThan(second.visibleLines);
  });

  it('viewport scroll dirties present window (not skip-all)', () => {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 10,
      leftPad: 0,
      rightPad: 0,
    });
    for (let i = 0; i < 40; i++) {
      transcript.addChild(new Text(`line-body-${i}\nsecond-${i}`, 0, 0));
    }
    // Sync content size first so jumpToLine can leave follow-output bottom.
    transcript.render(60);
    viewport.jumpToLine(0);
    for (let i = 0; i < 40; i++) {
      transcript.render(60);
      if (
        transcript.lastIncrementalPresentStats?.repaintedLines === 0 &&
        !transcript.needsMaterializeContinue
      ) {
        break;
      }
    }
    expect(transcript.lastIncrementalPresentStats!.repaintedLines).toBe(0);

    // From top, page-down moves the window (line-down is only ~3 rows and may
    // share hashes on short cards; page move guarantees content change).
    const moved = viewport.scroll('page-down');
    expect(moved).toBe(true);
    transcript.render(60);
    const afterScroll = transcript.lastIncrementalPresentStats!;
    // Scrolled window content changed → some rows must repaint.
    expect(afterScroll.repaintedLines).toBeGreaterThan(0);
  });
});
