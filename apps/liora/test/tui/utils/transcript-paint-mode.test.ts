import { describe, expect, it, vi } from 'vitest';

import {
  areLiveToolTicksSuppressed,
  resetTranscriptScrollActivityForTest,
  wasRecentTranscriptScroll,
  withTranscriptPaintMode,
} from '#/tui/utils/render/transcript-paint-mode';
import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import { ShellRunComponent } from '#/tui/components/messages/shell/shell-run';
import * as toolCallInternals from '#/tui/components/messages/tool-call/tool-call-internals';
import {
  resetTranscriptMeasureModeForTest,
  withTranscriptMeasureMode,
} from '#/tui/renderer';

describe('transcript paint mode (scroll hard-hang guard)', () => {
  it('restores suppress flag after withTranscriptPaintMode', () => {
    resetTranscriptScrollActivityForTest();
    expect(areLiveToolTicksSuppressed()).toBe(false);
    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {
      expect(areLiveToolTicksSuppressed()).toBe(true);
      expect(wasRecentTranscriptScroll()).toBe(true);
    });
    expect(areLiveToolTicksSuppressed()).toBe(false);
    expect(wasRecentTranscriptScroll()).toBe(true);
  });

  it('skips tool-card body rebuild during suppressed paint (pure scroll path)', () => {
    const rebuildSpy = vi.spyOn(toolCallInternals, 'rebuildToolCallComponentBody');
    const tc = new ToolCallComponent(
      {
        id: 'call_scroll_hang',
        name: 'Write',
        args: {
          file_path: 'hang.ts',
          content: Array.from({ length: 40 }, (_, i) => `const v${i} = ${i};`).join('\n'),
        },
        streamingStartedAtMs: Date.now(),
      },
      undefined,
    );

    // Normal paint may tick live clocks.
    tc.render(100);
    rebuildSpy.mockClear();

    // Scroll paint: must not rebuildBody even if preview reveal would want it.
    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {
      tc.render(100);
      tc.render(100);
      tc.render(100);
    });
    expect(rebuildSpy).not.toHaveBeenCalled();
    rebuildSpy.mockRestore();
  });

  it('shell-run does not requestRender from inside suppressed paint', () => {
    const requestRender = vi.fn();
    const shell = new ShellRunComponent(requestRender);
    shell.append('hello\n');
    requestRender.mockClear();

    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {
      shell.render(80);
      shell.render(80);
    });
    expect(requestRender).not.toHaveBeenCalled();
    shell.dispose();
  });

  it('geometry measure mode suppresses live tool ticks (contentRowCount path)', () => {
    resetTranscriptScrollActivityForTest();
    resetTranscriptMeasureModeForTest();
    expect(areLiveToolTicksSuppressed()).toBe(false);
    withTranscriptMeasureMode(() => {
      expect(areLiveToolTicksSuppressed()).toBe(true);
    });
    expect(areLiveToolTicksSuppressed()).toBe(false);

    const rebuildSpy = vi.spyOn(toolCallInternals, 'rebuildToolCallComponentBody');
    const tc = new ToolCallComponent(
      {
        id: 'call_measure_mode',
        name: 'Write',
        args: {
          file_path: 'measure.ts',
          content: Array.from({ length: 20 }, (_, i) => `export const n${i} = ${i};`).join('\n'),
        },
        streamingStartedAtMs: Date.now(),
      },
      undefined,
    );
    tc.render(100);
    rebuildSpy.mockClear();

    // Geometry probe must not rebuildBody / re-enter live ticks.
    withTranscriptMeasureMode(() => {
      tc.render(100);
      tc.render(100);
    });
    expect(rebuildSpy).not.toHaveBeenCalled();
    rebuildSpy.mockRestore();
  });
});
