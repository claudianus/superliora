import { afterEach, describe, expect, it, vi } from 'vitest';

import { highlightLines } from '#/tui/components/media/code-highlight';
import { withTranscriptPaintMode } from '#/tui/utils/render/transcript-paint-mode';
import { formatTranscriptOutput } from '#/tui/utils/transcript/transcript-output-format';
import {
  clearDeferredTranscriptFormatQueueForTest,
  setDeferredFormatSchedulerForTest,
} from '#/tui/utils/transcript/deferred-format-queue';
import { TruncatedOutputComponent } from '#/tui/components/messages/tool-renderers/truncated';
import { DIFF_LCS_SOFT_CAP_LINES, computeDiffLines } from '#/tui/components/media/diff-preview';
import {
  HIGHLIGHT_WINDOW_SOFT_CAP,
} from '#/tui/components/media/code-highlight';
import { buildWriteCallPreviewItems } from '#/tui/components/messages/tool-call/preview';

describe('pure-scroll cheap paint freezes class', () => {
  afterEach(() => {
    clearDeferredTranscriptFormatQueueForTest();
    setDeferredFormatSchedulerForTest(undefined);
  });

  it('highlightLines serves cache hits but skips tokenize on pure-scroll miss', () => {
    const code = ['export function big() {', '  return 42;', '}'].join('\n');

    // Warm paint path (full highlight may colorize).
    const warm = highlightLines(code, 'typescript');
    expect(warm.length).toBe(3);

    let tokenizeSpy = 0;
    // Second language cold under pure-scroll: must not block.
    const cold = Array.from({ length: 80 }, (_, i) => `const v${i} = ${i};`).join('\n');
    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {
      const plain = highlightLines(cold, 'typescript');
      tokenizeSpy = plain.length;
      expect(plain[0]).toBe('const v0 = 0;');
    });
    expect(tokenizeSpy).toBe(80);

    // Ambient paint can still highlight cold code later.
    const later = highlightLines(cold, 'typescript');
    expect(later.length).toBe(80);
  });

  it('formatTranscriptOutput does not pretty-print JSON on pure-scroll miss', () => {
    const json = `{"items":[${Array.from({ length: 40 }, (_, i) => i).join(',')}]}`;
    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {
      const out = formatTranscriptOutput(json, { mode: 'tool' });
      expect(out.split('\n').length).toBe(1);
      expect(out).toContain('"items"');
    });
    const painted = formatTranscriptOutput(json, { mode: 'tool' });
    expect(painted.length).toBeGreaterThan(0);
  });

  it('large TruncatedOutput stays plain and does not enqueue format under pure-scroll', () => {
    setDeferredFormatSchedulerForTest(() => {
      /* hold jobs */
    });
    const body = Array.from({ length: 120 }, (_, i) => `{"id":${i},"pad":"${'z'.repeat(30)}"}`).join(
      '\n',
    );
    const component = new TruncatedOutputComponent(body, {
      expanded: false,
      isError: false,
      maxLines: 4,
    });

    withTranscriptPaintMode({ suppressLiveToolTicks: true }, () => {
      const lines = component.render(100);
      // Wheel path must not schedule deferred highlight (queue storms → freeze).
      expect(component.isFormatPending).toBe(false);
      expect(lines.length).toBeGreaterThan(0);
    });

    // Ambient/content paint may then defer format once.
    component.render(100);
    expect(component.isFormatPending).toBe(true);
  });

  it('computeDiffLines soft-caps LCS input size', () => {
    const oldText = Array.from({ length: DIFF_LCS_SOFT_CAP_LINES + 200 }, (_, i) => `old-${i}`).join(
      '\n',
    );
    const newText = Array.from({ length: DIFF_LCS_SOFT_CAP_LINES + 200 }, (_, i) => `new-${i}`).join(
      '\n',
    );
    const lines = computeDiffLines(oldText, newText);
    // Result is bounded by 2 × soft cap (+ small overhead for adds/deletes).
    expect(lines.length).toBeLessThanOrEqual(DIFF_LCS_SOFT_CAP_LINES * 2 + 8);
  });

  it('expanded Write preview never highlights more than soft-cap window', () => {
    const content = Array.from({ length: HIGHLIGHT_WINDOW_SOFT_CAP + 300 }, (_, i) => {
      return `export const line${i} = ${i};`;
    }).join('\n');
    const items = buildWriteCallPreviewItems({
      content,
      filePath: 'huge.ts',
      expanded: true,
    });
    // Items are Text components for the windowed highlight (+ optional more footer).
    expect(items.length).toBeLessThanOrEqual(HIGHLIGHT_WINDOW_SOFT_CAP + 2);
  });
});
