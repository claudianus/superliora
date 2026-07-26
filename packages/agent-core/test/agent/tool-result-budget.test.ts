import { describe, expect, it } from 'vitest';

import { buildToolResultPreview } from '../../src/agent/turn/tool-result-budget';

describe('buildToolResultPreview', () => {
  it('returns short text unchanged', () => {
    expect(buildToolResultPreview('hello world')).toBe('hello world');
  });

  it('keeps head and tail for long logs so EOF errors remain visible', () => {
    const headMarker = 'HEAD_MARKER_START';
    const tailMarker = 'TAIL_MARKER_FAIL_EXIT_1';
    const text = `${headMarker}${'x'.repeat(2_000)}${tailMarker}`;
    const preview = buildToolResultPreview(text);
    expect(preview).toContain(headMarker);
    expect(preview).toContain(tailMarker);
    expect(preview).toContain('...');
    expect(preview.length).toBeLessThan(text.length);
  });
});
