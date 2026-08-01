import { describe, expect, it } from 'vitest';

import {
  promoteTranscriptRegionLinesToCellsCached,
  resetTranscriptPromoteWindowCacheForTest,
} from '#/tui/features/native-layout/native-layout-frame-transcript';

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
});
