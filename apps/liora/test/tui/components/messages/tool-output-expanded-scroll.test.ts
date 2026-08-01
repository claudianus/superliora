/**
 * Regression: expanded multi-kiloline tool bodies used to unroll unlimited
 * rows into the transcript. Fast wheel scroll then re-measured/painted those
 * bodies and permanently froze the TUI. Expanded cards must stay nested-
 * windowed so transcript geometry stays O(visible).
 */
import { describe, expect, it } from 'vitest';

import { ToolOutputViewportComponent } from '#/tui/components/messages/tool-output-viewport';
import { TruncatedOutputComponent } from '#/tui/components/messages/tool-renderers/truncated';
import {
  createToolOutputViewportState,
  projectToolOutputViewport,
  TOOL_OUTPUT_EXPANDED_MAX_HEIGHT,
} from '#/tui/utils/tool/tool-output-viewport';
import {
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
} from '#/tui/renderer';

function strip(text: string): string {
  return text.replaceAll(/\[[0-9;]*m/g, '').replaceAll(/\u001B\[[0-9;]*m/g, '');
}

function hugeOutput(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `ROW-${String(i).padStart(4, '0')}`).join('\n');
}

describe('expanded tool output scroll freeze regression', () => {
  it('caps expanded nested viewport contribution well below content size', () => {
    let state = createToolOutputViewportState();
    state = { ...state, contentRows: 5_000, offset: 0 };
    const projection = projectToolOutputViewport(state, true);
    expect(projection.visibleRows).toBe(TOOL_OUTPUT_EXPANDED_MAX_HEIGHT);
    expect(projection.overflow).toBe(true);
    expect(projection.endRow - projection.startRow).toBe(TOOL_OUTPUT_EXPANDED_MAX_HEIGHT);
  });

  it('keeps transcript paint rows bounded under many expanded multi-k tools', () => {
    const visibleRows = 12;
    const viewport = new RendererTranscriptViewport();
    const transcript = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => visibleRows,
      leftPad: 0,
      rightPad: 0,
      scrollbar: false,
    });

    // 30 expanded tools × 2k lines each — previously ~60k transcript rows.
    for (let t = 0; t < 30; t++) {
      let toolState = createToolOutputViewportState();
      const child = new TruncatedOutputComponent(hugeOutput(2_000), {
        expanded: true,
        isError: false,
        maxLines: 5,
      });
      const nested = new ToolOutputViewportComponent({
        child,
        getState: () => toolState,
        setState: (next) => {
          toolState = next;
        },
        expanded: true,
      });
      transcript.addChild(nested);
    }

    // First paint + geometry must finish and stay near 30 × expanded budget.
    const first = transcript.render(80);
    expect(first.length).toBeLessThanOrEqual(visibleRows);
    const totalRows = transcript.contentRowCount(80);
    expect(totalRows).toBeLessThanOrEqual(30 * TOOL_OUTPUT_EXPANDED_MAX_HEIGHT + 30);
    expect(totalRows).toBeGreaterThan(30);

    // Fast wheel storm: many pure-scroll paints must keep returning.
    const starts: number[] = [viewport.start()];
    for (let i = 0; i < 40; i++) {
      viewport.scroll('line-up');
      const frame = transcript.render(80);
      expect(frame.length).toBeLessThanOrEqual(visibleRows);
      starts.push(viewport.start());
    }
    // Viewport actually moved (not frozen at the same offset).
    expect(starts[starts.length - 1]).toBeLessThan(starts[0]!);
  });

  it('hard-caps raw tool body lines so mount does not format megabyte dumps', () => {
    const component = new TruncatedOutputComponent(hugeOutput(5_000), {
      expanded: true,
      isError: false,
      maxLines: 5,
    });
    const lines = component.render(80);
    // Visual soft-cap + footer — never 5k rows.
    expect(lines.length).toBeLessThanOrEqual(620);
    const text = strip(lines.join('\n'));
    expect(text).toMatch(/more lines/);
  });
});
