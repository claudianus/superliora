import { describe, expect, it, vi } from 'vitest';

import {
  areLiveToolTicksSuppressed,
  withTranscriptPaintMode,
} from '#/tui/utils/render/transcript-paint-mode';
import { ToolCallComponent } from '#/tui/components/messages/tool-call/index';
import * as toolCallInternals from '#/tui/components/messages/tool-call/tool-call-internals';

describe('transcript paint mode (scroll hard-hang guard)', () => {
  it('restores suppress flag after withTranscriptPaintMode', () => {
    expect(areLiveToolTicksSuppressed()).toBe(false);
    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {
      expect(areLiveToolTicksSuppressed()).toBe(true);
    });
    expect(areLiveToolTicksSuppressed()).toBe(false);
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
});
