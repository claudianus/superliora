import { describe, expect, it } from 'vitest';

import {
  createToolOutputViewportState,
  projectToolOutputViewport,
  resizeToolOutputViewport,
  scrollToolOutputViewport,
  syncToolOutputViewportContent,
  toolOutputViewportMaxHeight,
  toolOutputViewportThumb,
} from '#/tui/utils/tool/tool-output-viewport';

describe('tool output viewport state', () => {
  it('keeps the existing collapsed preview height and clamps scrolling', () => {
    const initial = syncToolOutputViewportContent(createToolOutputViewportState(), 10);
    expect(initial).toEqual({ offset: 0, height: 5, contentRows: 10 });
    expect(scrollToolOutputViewport(initial, 2).offset).toBe(2);
    expect(scrollToolOutputViewport(initial, 100).offset).toBe(5);
    expect(scrollToolOutputViewport(initial, -100).offset).toBe(0);
  });

  it('follows appends only while parked at the end and clamps shrinkage', () => {
    const initial = syncToolOutputViewportContent(createToolOutputViewportState(), 8);
    const atEnd = scrollToolOutputViewport(initial, 100);
    expect(syncToolOutputViewportContent(atEnd, 10).offset).toBe(5);

    const readingMiddle = scrollToolOutputViewport(initial, 2);
    expect(syncToolOutputViewportContent(readingMiddle, 10).offset).toBe(2);
    expect(syncToolOutputViewportContent(readingMiddle, 4).offset).toBe(0);
  });

  it('resizes within min/max while preserving end position', () => {
    const atEnd = scrollToolOutputViewport(
      syncToolOutputViewportContent(createToolOutputViewportState(), 20),
      100,
    );
    expect(resizeToolOutputViewport(atEnd, 1, 8)).toEqual({
      offset: 15,
      height: 5,
      contentRows: 20,
    });
    expect(resizeToolOutputViewport(atEnd, 7, 8)).toEqual({
      offset: 13,
      height: 7,
      contentRows: 20,
    });
    expect(resizeToolOutputViewport(atEnd, 99, 8).height).toBe(8);
    expect(toolOutputViewportMaxHeight(40)).toBe(16);
    expect(toolOutputViewportMaxHeight(10)).toBe(5);
    expect(toolOutputViewportMaxHeight(2)).toBe(5);
  });

  it('keeps nested windowing when expanded (taller budget, never unlimited unroll)', () => {
    const state = scrollToolOutputViewport(
      syncToolOutputViewportContent(createToolOutputViewportState(), 10),
      4,
    );
    expect(projectToolOutputViewport(state, false)).toEqual({
      startRow: 4,
      endRow: 9,
      visibleRows: 5,
      overflow: true,
    });
    // 10 content rows fit inside the expanded budget — full body visible, no rail.
    expect(projectToolOutputViewport(state, true)).toEqual({
      startRow: 0,
      endRow: 10,
      visibleRows: 10,
      overflow: false,
    });

    // Large bodies stay windowed so transcript geometry stays bounded.
    const huge = syncToolOutputViewportContent(createToolOutputViewportState(), 500);
    const expanded = projectToolOutputViewport(huge, true);
    expect(expanded.visibleRows).toBe(40);
    expect(expanded.endRow - expanded.startRow).toBe(40);
    expect(expanded.overflow).toBe(true);
    expect(expanded.startRow).toBe(0);
  });

  it('derives thumb size and position from content, height, and offset', () => {
    const state = scrollToolOutputViewport(
      syncToolOutputViewportContent(createToolOutputViewportState(), 12),
      6,
    );
    expect(toolOutputViewportThumb(state, 3)).toEqual({ startRow: 2, endRow: 3 });
    expect(toolOutputViewportThumb({ offset: 0, height: 6, contentRows: 12 }, 6)).toEqual({
      startRow: 0,
      endRow: 3,
    });
    expect(toolOutputViewportThumb({ offset: 0, height: 3, contentRows: 3 }, 3)).toBeUndefined();
  });
});
