/**
 * Product mutators (setResult / live output / expand) rebuild tool-call body
 * in place. After geometry was decoupled from paint epoch, those mutators must
 * dirty the parent transcript line-count slot so virtual scroll does not clip
 * grown output.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  advanceAppearanceAnimationClock,
  getActiveAppearancePreferences,
  setActiveAppearancePreferences,
} from '#/tui/features/appearance/appearance-effects';
import type { TranscriptDetailLevel } from '#/tui/types';
import {
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
} from '#/tui/renderer';

describe('ToolCallComponent transcript geometry dirty', () => {
  const originalAppearance = getActiveAppearancePreferences();
  afterEach(() => {
    setActiveAppearancePreferences(originalAppearance);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  function mountUnderTranscript(tc: ToolCallComponent): RendererTranscriptViewportComponent {
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 80,
    });
    // Historical siblings — prove setResult does not force full remeasure.
    for (let i = 0; i < 8; i++) {
      transcript.addChild({
        invalidate: () => {},
        render: () => [`hist-${i}`],
      });
    }
    transcript.addChild(tc);
    return transcript;
  }

  it('setResult grows contentRowCount without a full parent invalidate', () => {
    const tc = new ToolCallComponent(
      {
        id: 'call_geom_result',
        name: 'Bash',
        args: { command: 'seq 1 20' },
      },
      undefined,
    );
    const transcript = mountUnderTranscript(tc);

    // Warm geometry while the tool is still running (header-only-ish height).
    const before = transcript.contentRowCount(100);
    expect(before).toBeGreaterThan(0);

    const tallOutput = Array.from({ length: 20 }, (_, i) => `out-line-${i}`).join('\n');
    tc.setResult({
      tool_call_id: 'call_geom_result',
      output: tallOutput,
      is_error: false,
    });
    tc.setExpanded(true);

    const after = transcript.contentRowCount(100);
    // Virtual window must see the grown body — stale counts would stay ≈ before.
    expect(after).toBeGreaterThan(before + 5);
    // Paint path must also expose the result lines.
    const painted = transcript.render(100).join('\n');
    expect(painted).toContain('out-line-0');
    expect(painted).toContain('out-line-19');
  });

  it('appendLiveOutput dirties geometry so streaming stdout is not clipped', () => {
    const tc = new ToolCallComponent(
      {
        id: 'call_geom_live',
        name: 'Bash',
        args: { command: 'long-running' },
      },
      undefined,
    );
    const transcript = mountUnderTranscript(tc);
    const before = transcript.contentRowCount(100);

    for (let i = 0; i < 12; i++) {
      tc.appendLiveOutput(`live-${i}\n`);
    }
    tc.setExpanded(true);

    const after = transcript.contentRowCount(100);
    expect(after).toBeGreaterThan(before);
    const painted = transcript.render(100).join('\n');
    expect(painted).toContain('live-0');
  });

  it('setExpanded from collapsed to expanded updates row counts in place', () => {
    const output = Array.from({ length: 15 }, (_, i) => `body-${i}`).join('\n');
    const tc = new ToolCallComponent(
      {
        id: 'call_geom_expand',
        name: 'Bash',
        args: { command: 'cat big.ts' },
      },
      {
        tool_call_id: 'call_geom_expand',
        output,
        is_error: false,
      },
    );
    tc.setExpanded(false);
    const transcript = mountUnderTranscript(tc);
    const collapsed = transcript.contentRowCount(100);

    tc.setExpanded(true);
    const expanded = transcript.contentRowCount(100);
    expect(expanded).toBeGreaterThan(collapsed);
  });

  it('matches full-render geometry and row slices at every transcript density', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const levels: TranscriptDetailLevel[] = ['minimal', 'compact', 'standard', 'full'];
    for (const detail of levels) {
      const tc = new ToolCallComponent(
        { id: `call-window-${detail}`, name: 'Bash', args: { command: 'output' } },
        { tool_call_id: `call-window-${detail}`, output: 'one\ntwo\nthree', is_error: false },
      );
      tc.setDetail(detail);
      for (const expanded of [false, true]) {
        tc.setExpanded(expanded);
        const full = tc.render(80);
        expect(tc.measureContentRows(80)).toBe(full.length);
        for (let start = 0; start < full.length; start++) {
          expect(tc.paintContentRows(80, start, start + 2)).toEqual(full.slice(start, start + 2));
        }
      }
    }
  });

  it('paints a settled tall tool without full child materialization', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    const tc = new ToolCallComponent(
      { id: 'call-tall-window', name: 'Bash', args: { command: 'output' } },
      { tool_call_id: 'call-tall-window', output: 'done', is_error: false },
    );
    tc.setDetail('full');
    const render = vi.fn(() => { throw new Error('full tall tool paint'); });
    const paintContentRows = vi.fn((_width: number, start: number, end: number) =>
      Array.from({ length: end - start }, (_, row) => `body-${start + row}`),
    );
    tc.children = [{ render, invalidate() {}, measureContentRows: () => 10_000, paintContentRows }];
    expect(tc.measureContentRows(80)).toBe(10_000);
    const window = tc.paintContentRows(80, 500, 505);
    expect(window).toHaveLength(5);
    expect(window[0]).toContain('body-500');
    expect(paintContentRows).toHaveBeenCalledExactlyOnceWith(80, 500, 505);
    expect(render).not.toHaveBeenCalled();
  });

  it('keeps live progress advancing through warm viewport frames before windowing settled output', () => {
    setActiveAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'off' });
    vi.useFakeTimers();
    vi.setSystemTime(0);
    advanceAppearanceAnimationClock(0);
    const tc = new ToolCallComponent(
      {
        id: 'call-viewport-live-clock',
        name: 'Bash',
        args: { command: 'cat foo.ts' },
        streamingArguments: '{"command":"cat foo.ts',
        streamingStartedAtMs: 0,
      },
      undefined,
    );
    tc.setDetail('full');
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 12,
      leftPad: 0,
      rightPad: 0,
      scrollbar: false,
    });
    for (let row = 0; row < 20; row++) {
      transcript.addChild({ render: () => [`history-${row}`], invalidate() {} });
    }
    transcript.addChild(tc);
    const paintWindow = vi.spyOn(tc, 'paintContentRows');
    const first = transcript.render(100).join('\n').replaceAll(/\u001B\[[0-9;]*m/g, '');
    expect(first).toContain('Using Bash');
    expect(paintWindow).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    advanceAppearanceAnimationClock(1000);
    const live = transcript.render(100).join('\n').replaceAll(/\u001B\[[0-9;]*m/g, '');
    expect(live).toContain('1s');
    expect(paintWindow).not.toHaveBeenCalled();

    tc.setResult({
      tool_call_id: 'call-viewport-live-clock',
      output: 'file content',
      is_error: false,
    });
    const settled = transcript.render(100).join('\n').replaceAll(/\u001B\[[0-9;]*m/g, '');
    expect(settled).toContain('Used Bash');
    expect(settled).not.toContain('Using Bash');
    expect(paintWindow).toHaveBeenCalled();
  });
});
