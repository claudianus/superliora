import { describe, expect, it } from 'vitest';

import {
  promoteTranscriptRegionLinesToCells,
  promoteTranscriptRegionLinesToCellsCached,
  resetTranscriptPromoteWindowCacheForTest,
} from '#/tui/features/native-layout/native-layout-frame-transcript';
import type { RendererCell } from '@harness-kit/tui-renderer';

describe('transcript promote window cache', () => {
  it('returns the same output reference when input line refs and window key match', () => {
    resetTranscriptPromoteWindowCacheForTest();
    const lines = ['hello', 'world'];
    const a = promoteTranscriptRegionLinesToCellsCached(lines, {
      start: 10,
      width: 80,
      selectionKey: '',
    });
    const b = promoteTranscriptRegionLinesToCellsCached(lines, {
      start: 10,
      width: 80,
      selectionKey: '',
    });
    expect(b).toBe(a);
  });

  it('misses when the viewport start moves (new scroll window)', () => {
    resetTranscriptPromoteWindowCacheForTest();
    const lines = ['hello', 'world'];
    const a = promoteTranscriptRegionLinesToCellsCached(lines, {
      start: 10,
      width: 80,
      selectionKey: '',
    });
    const b = promoteTranscriptRegionLinesToCellsCached(lines, {
      start: 11,
      width: 80,
      selectionKey: '',
    });
    expect(b).not.toBe(a);
  });

  it('keeps a backfilled line reference stable across repeated promotion', () => {
    // Background-only cell: the promote step hands out the same cell array every
    // frame, so the foreground backfill must return the same line array too —
    // otherwise the compositor's reference-keyed row memo never hits and every
    // unchanged row is re-serialized each frame.
    const cells: readonly RendererCell[] = [
      { char: 'a', style: { bg: '#101010' } },
      { char: ' ' },
    ];

    const first = promoteTranscriptRegionLinesToCells([cells])[0];
    const second = promoteTranscriptRegionLinesToCells([cells])[0];

    expect(first).not.toBe(cells);
    expect(second).toBe(first);
  });
});
