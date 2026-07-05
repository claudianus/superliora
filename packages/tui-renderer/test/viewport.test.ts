import { describe, expect, it } from 'vitest';

import {
  composeRendererRegions,
  createRendererViewportSnapshot,
  decodeNativeInput,
  measureRendererScrollbar,
  projectRendererViewportHistoryStatus,
  projectRendererViewportLineWindow,
  projectRendererScrollableLineWindow,
  RendererCellBuffer,
  RendererSelectableListViewport,
  RendererScrollableLineViewport,
  RendererStableScrollableLineViewport,
  RendererTranscriptViewport,
  RendererTranscriptViewportComponent,
  RendererViewport,
  renderRendererRightGutterLines,
  rendererViewportActionForInput,
  renderRendererVerticalScrollbar,
  Text,
} from '../src';

describe('RendererViewport', () => {
  it('follows growing output while pinned to the bottom', () => {
    const viewport = new RendererViewport({ contentRows: 10, viewportRows: 4 });

    expect(viewport.snapshot()).toMatchObject({
      start: 6,
      end: 10,
      offsetFromBottom: 0,
      followOutput: true,
    });
    expect(viewport.update({ contentRows: 12 })).toMatchObject({
      start: 8,
      end: 12,
      offsetFromBottom: 0,
      followOutput: true,
    });
  });

  it('keeps visible rows stable when output grows while scrolled up', () => {
    const viewport = new RendererViewport({ contentRows: 10, viewportRows: 4 });

    expect(viewport.scroll('line-up', 2)).toMatchObject({
      start: 4,
      end: 8,
      offsetFromBottom: 2,
      followOutput: false,
      hasNewContentBelow: true,
    });
    expect(viewport.update({ contentRows: 12 })).toMatchObject({
      start: 4,
      end: 8,
      offsetFromBottom: 4,
      followOutput: false,
      hasNewContentBelow: true,
    });
    expect(viewport.scroll('line-down', 4)).toMatchObject({
      start: 8,
      end: 12,
      offsetFromBottom: 0,
      followOutput: true,
    });
  });

  it('preserves manual scroll intent before output overflows', () => {
    const viewport = new RendererViewport({ contentRows: 3, viewportRows: 5 });

    expect(viewport.snapshot()).toMatchObject({
      start: 0,
      end: 3,
      offsetFromBottom: 0,
      followOutput: true,
      hasOverflow: false,
    });
    expect(viewport.scroll('line-up', 3)).toMatchObject({
      start: 0,
      end: 3,
      offsetFromBottom: 0,
      followOutput: false,
      hasOverflow: false,
    });
    expect(viewport.update({ contentRows: 10 })).toMatchObject({
      start: 0,
      end: 5,
      offsetFromBottom: 5,
      followOutput: false,
      hasNewContentBelow: true,
    });
    expect(viewport.scroll('line-down', 10)).toMatchObject({
      start: 5,
      end: 10,
      offsetFromBottom: 0,
      followOutput: true,
    });
  });

  it('maps page, home, end, and wheel input to scroll actions', () => {
    expect(rendererViewportActionForInput(decodeNativeInput('\u001B[5~')[0]!)).toBe('page-up');
    expect(rendererViewportActionForInput(decodeNativeInput('\u001B[6~')[0]!)).toBe('page-down');
    expect(rendererViewportActionForInput(decodeNativeInput('\u001B[H')[0]!)).toBe('home');
    expect(rendererViewportActionForInput(decodeNativeInput('\u001B[F')[0]!)).toBe('end');
    expect(rendererViewportActionForInput(decodeNativeInput('\u001B[<64;1;1M')[0]!)).toBe('line-up');
    expect(rendererViewportActionForInput(decodeNativeInput('\u001B[<65;1;1M')[0]!)).toBe('line-down');
  });

  it('supports top jumps and unbounded viewport rows', () => {
    const viewport = new RendererViewport({ contentRows: 10, viewportRows: 4 });

    expect(viewport.scroll('home')).toMatchObject({
      start: 0,
      end: 4,
      offsetFromBottom: 6,
      followOutput: false,
    });
    expect(createRendererViewportSnapshot({
      contentRows: 5,
      viewportRows: Number.POSITIVE_INFINITY,
    })).toMatchObject({
      start: 0,
      end: 5,
      maxOffsetFromBottom: 0,
      hasOverflow: false,
    });
  });

  it('feeds the compositor scroll offset from the visible range', () => {
    const snapshot = createRendererViewportSnapshot({
      contentRows: 5,
      viewportRows: 2,
      offsetFromBottom: 1,
      followOutput: false,
    });
    const buffer = new RendererCellBuffer(4, 2);

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 4, height: 2 },
        scrollY: snapshot.start,
        lines: ['zero', 'one', 'two', 'tri', 'four'],
      },
    ]);

    expect(rowText(buffer, 0)).toBe('two ');
    expect(rowText(buffer, 1)).toBe('tri ');
  });

  it('projects a compact history status while output follow is paused', () => {
    expect(projectRendererViewportHistoryStatus({
      followOutput: true,
      offsetFromBottom: 42,
    })).toBeUndefined();
    expect(projectRendererViewportHistoryStatus({
      followOutput: false,
      offsetFromBottom: 42,
    })).toEqual({
      rowsBehind: 42,
      label: 'history +42 rows',
    });
    expect(projectRendererViewportHistoryStatus({
      followOutput: false,
      offsetFromBottom: 0,
    })).toEqual({
      rowsBehind: 1,
      label: 'history +1 rows',
    });
    expect(projectRendererViewportHistoryStatus({
      followOutput: false,
      offsetFromBottom: 1_200,
    })).toEqual({
      rowsBehind: 1_200,
      label: 'history +1.2k rows',
    });
  });

  it('projects a bottom-anchored line window from viewport state', () => {
    expect(projectRendererViewportLineWindow({
      lines: ['one', 'two', 'three', 'four', 'five'],
      viewportRows: 3,
    })).toMatchObject({
      lines: ['three', 'four', 'five'],
      start: 2,
      end: 5,
      followOutput: true,
      hasOverflow: true,
    });

    expect(projectRendererViewportLineWindow({
      lines: ['one', 'two', 'three', 'four', 'five'],
      viewportRows: 3,
      offsetFromBottom: 2,
      followOutput: false,
    })).toMatchObject({
      lines: ['one', 'two', 'three'],
      start: 0,
      end: 3,
      followOutput: false,
      hasNewContentBelow: true,
    });
  });

  it('pads viewport line windows when requested', () => {
    expect(projectRendererViewportLineWindow({
      lines: ['one'],
      viewportRows: 3,
      fill: '',
    })).toMatchObject({
      lines: ['one', '', ''],
      start: 0,
      end: 1,
      hasOverflow: false,
    });
  });

  it('owns transcript follow-output state with line/page/top/bottom actions', () => {
    const viewport = new RendererTranscriptViewport();

    expect(viewport.sync(100, 20)).toMatchObject({
      start: 80,
      followOutput: true,
      offsetFromBottom: 0,
    });
    expect(viewport.scroll('page-up')).toBe(true);
    expect(viewport.snapshot()).toMatchObject({
      start: 61,
      followOutput: false,
      offsetFromBottom: 19,
    });

    viewport.sync(110, 20);
    expect(viewport.snapshot()).toMatchObject({
      start: 61,
      followOutput: false,
      offsetFromBottom: 29,
    });

    expect(viewport.scroll('bottom')).toBe(true);
    expect(viewport.snapshot()).toMatchObject({
      start: 90,
      followOutput: true,
      offsetFromBottom: 0,
    });
  });

  it('keeps transcript manual scroll intent before content overflows', () => {
    const viewport = new RendererTranscriptViewport();

    viewport.sync(3, 5);

    expect(viewport.scroll('line-up')).toBe(true);
    expect(viewport.snapshot()).toMatchObject({
      start: 0,
      followOutput: false,
      offsetFromBottom: 0,
    });

    viewport.sync(10, 5);

    expect(viewport.snapshot()).toMatchObject({
      start: 0,
      followOutput: false,
      offsetFromBottom: 5,
    });
  });

  it('uses bounded transcript line steps and preserves top row across viewport height changes', () => {
    const viewport = new RendererTranscriptViewport();

    viewport.sync(100, 20);

    expect(viewport.scroll('line-up')).toBe(true);
    expect(viewport.snapshot()).toMatchObject({
      start: 77,
      offsetFromBottom: 3,
      followOutput: false,
    });

    viewport.sync(100, 10);

    expect(viewport.snapshot()).toMatchObject({
      start: 77,
      offsetFromBottom: 13,
      followOutput: false,
    });
  });

  it('renders transcript viewport children through the reusable component', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 3,
    });
    component.addChild(new Text(['one', 'two', 'three', 'four', 'five'].join('\n'), 0, 0));

    expect(component.render(80).map((line) => line.trimEnd())).toEqual([
      'three',
      'four',
      'five',
    ]);
  });

  it('renders transcript viewport scrollbars through the reusable component', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 3,
      rightPad: 1,
    });
    component.addChild(new Text(['one', 'two', 'three', 'four', 'five'].join('\n'), 0, 0));

    expect(component.render(8)).toEqual([
      'three  │',
      'four   █',
      'five   █',
    ]);
  });

  it('renders transcript viewport region lines without a string roundtrip', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 2,
      paintRegionLine: (line) => [{ char: line.trimEnd(), style: { fg: '#111111' } }],
    });
    component.addChild(new Text('alpha\nbeta\ngamma', 0, 0));

    const lines = component.renderWithVisibleRegionLines(6, 2);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => Array.isArray(line))).toBe(true);
    expect(lines[0]).toEqual([{ char: 'beta', style: { fg: '#111111' } }]);
    expect(lines[1]).toEqual([{ char: 'gamma', style: { fg: '#111111' } }]);
  });

  // ── Virtual scroll ──────────────────────────────────────────────────────
  //
  // The transcript viewport must only render the children that intersect the
  // visible line window, not every child.  These tests verify the fast path
  // by counting how many children actually get their render() called.

  it('virtualizes: only renders children intersecting the visible window', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 3,
    });
    // 10 children, each 2 lines → 20 total lines, viewport shows last 3.
    let renderCount = 0;
    for (let i = 0; i < 10; i++) {
      const label = `child-${i}`;
      component.addChild({
        invalidate: () => {},
        render: () => {
          renderCount++;
          return [`${label}-a`, `${label}-b`];
        },
      });
    }

    const lines = component.render(80);
    // First render: resolveChildLineCounts renders all 10 children (cache
    // miss), then renderVisibleChildren renders the 2 visible children again.
    expect(renderCount).toBe(12);
    // Viewport at bottom: lines 17,18,19 → child-8-b, child-9-a, child-9-b.
    expect(lines).toEqual(['child-8-b', 'child-9-a', 'child-9-b']);

    // Second render at the same width — line-count cache hit, only the 2
    // visible children are rendered.
    renderCount = 0;
    component.render(80);
    expect(renderCount).toBe(2);
  });

  it('virtualizes: renders only visible children when scrolled to the top', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 3,
    });
    let renderCount = 0;
    for (let i = 0; i < 10; i++) {
      const label = `child-${i}`;
      component.addChild({
        invalidate: () => {},
        render: () => {
          renderCount++;
          return [`${label}-a`, `${label}-b`];
        },
      });
    }

    // First render: cache miss → all children rendered for line counts, then
    // visible children rendered again.
    component.render(80);
    expect(renderCount).toBe(12);

    // Scroll to the top.
    viewport.scroll('top');

    // Second render: cache hit → only the 2 visible children rendered.
    renderCount = 0;
    const lines = component.render(80);
    expect(renderCount).toBe(2);
    // Viewport at top shows the first 3 lines (child-0 both lines + child-1-a).
    expect(lines).toEqual(['child-0-a', 'child-0-b', 'child-1-a']);
  });

  it('contentRowCount uses cached line counts without re-rendering children', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 100,
    });
    let renderCount = 0;
    for (let i = 0; i < 5; i++) {
      component.addChild({
        invalidate: () => {},
        render: () => {
          renderCount++;
          return ['a', 'b'];
        },
      });
    }

    // render() populates the cache.
    component.render(80);
    const countAfterRender = renderCount;

    // contentRowCount must use the cache — no additional renders.
    expect(component.contentRowCount(80)).toBe(10);
    expect(renderCount).toBe(countAfterRender);
  });

  it('projects scrollable line windows with tail-follow and padding', () => {
    expect(projectRendererScrollableLineWindow({
      lines: ['a', 'b', 'c', 'd'],
      viewportRows: 2,
      followTail: true,
    })).toEqual({
      lines: ['c', 'd'],
      contentRows: 4,
      viewportRows: 2,
      start: 2,
      end: 4,
      scrollTop: 2,
      maxScrollTop: 2,
      followTail: true,
      hasOverflow: true,
      lineFrom: 3,
      lineTo: 4,
      scrollPercent: 100,
    });

    expect(projectRendererScrollableLineWindow({
      lines: ['a', 'b', 'c', 'd'],
      viewportRows: 2,
      scrollTop: 1,
      followTail: false,
    })).toMatchObject({
      lines: ['b', 'c'],
      scrollTop: 1,
      followTail: false,
      hasOverflow: true,
      lineFrom: 2,
      lineTo: 3,
      scrollPercent: 50,
    });

    expect(projectRendererScrollableLineWindow({
      lines: ['a'],
      viewportRows: 3,
      fill: '',
    })).toMatchObject({
      lines: ['a', '', ''],
      maxScrollTop: 0,
      followTail: true,
      hasOverflow: false,
      lineFrom: 1,
      lineTo: 1,
      scrollPercent: 100,
    });
  });

  it('owns scrollable line viewport state across scroll and content updates', () => {
    const viewport = new RendererScrollableLineViewport({
      contentRows: 100,
      viewportRows: 10,
    });

    expect(viewport.snapshot()).toMatchObject({
      start: 0,
      end: 10,
      scrollTop: 0,
      maxScrollTop: 90,
      followTail: false,
      scrollPercent: 0,
    });

    expect(viewport.scroll('end')).toMatchObject({
      start: 90,
      end: 100,
      followTail: true,
      scrollPercent: 100,
    });

    expect(viewport.update({ contentRows: 120 })).toMatchObject({
      start: 110,
      end: 120,
      followTail: true,
      scrollPercent: 100,
    });

    expect(viewport.scroll('line-up', 5)).toMatchObject({
      start: 105,
      end: 115,
      followTail: false,
      lineFrom: 106,
      lineTo: 115,
    });

    expect(viewport.update({ contentRows: 140 })).toMatchObject({
      start: 105,
      end: 115,
      followTail: false,
      lineFrom: 106,
      lineTo: 115,
    });
  });

  it('resumes tail-follow when a scrollable line viewport reaches the bottom', () => {
    const viewport = new RendererScrollableLineViewport({
      contentRows: 8,
      viewportRows: 3,
    });

    viewport.scroll('end');
    viewport.scroll('line-up', 2);

    expect(viewport.snapshot()).toMatchObject({
      scrollTop: 3,
      maxScrollTop: 5,
      followTail: false,
    });

    expect(viewport.scroll('line-down', 2)).toMatchObject({
      scrollTop: 5,
      maxScrollTop: 5,
      followTail: true,
    });

    expect(viewport.update({ contentRows: 10 })).toMatchObject({
      scrollTop: 7,
      maxScrollTop: 7,
      followTail: true,
      lineFrom: 8,
      lineTo: 10,
    });
  });

  it('keeps stable rows for scrollable line panels while respecting a max viewport cap', () => {
    const viewport = new RendererStableScrollableLineViewport();

    expect(viewport.project({
      lines: ['question', 'thinking 1', 'thinking 2', 'thinking 3'],
      maxViewportRows: 5,
      fill: '',
    })).toMatchObject({
      lines: ['question', 'thinking 1', 'thinking 2', 'thinking 3'],
      viewportRows: 4,
      stableViewportRows: 4,
      hasOverflow: false,
    });

    expect(viewport.project({
      lines: ['question', 'final'],
      maxViewportRows: 5,
      fill: '',
    })).toMatchObject({
      lines: ['question', 'final', '', ''],
      viewportRows: 4,
      stableViewportRows: 4,
      hasOverflow: false,
    });

    const capped = viewport.project({
      lines: ['a', 'b', 'c', 'd', 'e', 'f'],
      maxViewportRows: 3,
      fill: '',
    });
    expect(capped).toMatchObject({
      lines: ['d', 'e', 'f'],
      viewportRows: 3,
      stableViewportRows: 4,
      hasOverflow: true,
    });
  });

  it('projects lines through the stateful scrollable line viewport', () => {
    const viewport = new RendererScrollableLineViewport({
      contentRows: 4,
      viewportRows: 2,
    });

    expect(viewport.project({
      lines: ['a', 'b', 'c', 'd'],
    })).toMatchObject({
      lines: ['a', 'b'],
      lineFrom: 1,
      lineTo: 2,
      scrollPercent: 0,
    });

    expect(viewport.scroll('page-down', 1)).toMatchObject({
      scrollTop: 1,
      followTail: false,
    });

    expect(viewport.project({
      lines: ['a', 'b', 'c', 'd'],
    })).toMatchObject({
      lines: ['b', 'c'],
      lineFrom: 2,
      lineTo: 3,
      scrollPercent: 50,
    });
  });

  it('keeps selected list items visible while preserving offset', () => {
    const viewport = new RendererSelectableListViewport({
      itemCount: 20,
      viewportRows: 5,
    });

    expect(viewport.snapshot()).toMatchObject({
      selectedIndex: 0,
      start: 0,
      end: 5,
      selectedViewportIndex: 0,
      scrollPercent: 0,
    });

    expect(viewport.select(8)).toMatchObject({
      selectedIndex: 8,
      start: 4,
      end: 9,
      selectedViewportIndex: 4,
    });

    expect(viewport.moveSelection(-2)).toMatchObject({
      selectedIndex: 6,
      start: 4,
      end: 9,
      selectedViewportIndex: 2,
    });

    expect(viewport.update({ itemCount: 7 })).toMatchObject({
      selectedIndex: 6,
      start: 2,
      end: 7,
      selectedViewportIndex: 4,
      scrollPercent: 100,
    });
  });

  it('projects selectable list windows with indices and selection flags', () => {
    const viewport = new RendererSelectableListViewport({
      itemCount: 5,
      viewportRows: 3,
      selectedIndex: 4,
      scrollPadding: 1,
    });

    expect(viewport.project({
      items: ['a', 'b', 'c', 'd', 'e'],
    })).toMatchObject({
      start: 2,
      end: 5,
      lineFrom: 3,
      lineTo: 5,
      items: [
        { item: 'c', index: 2, isSelected: false },
        { item: 'd', index: 3, isSelected: false },
        { item: 'e', index: 4, isSelected: true },
      ],
    });
  });
});

describe('Renderer scrollbar', () => {
  it('maps viewport position to a minimum-size thumb', () => {
    expect(measureRendererScrollbar({
      contentRows: 100,
      viewportRows: 10,
      offsetFromBottom: 90,
      trackRows: 10,
    })).toMatchObject({
      visible: true,
      start: 0,
      thumbStart: 0,
      thumbRows: 1,
      atTop: true,
      atBottom: false,
    });

    expect(measureRendererScrollbar({
      contentRows: 100,
      viewportRows: 10,
      offsetFromBottom: 0,
      trackRows: 10,
    })).toMatchObject({
      start: 90,
      thumbStart: 9,
      atTop: false,
      atBottom: true,
    });
  });

  it('renders a vertical scrollbar track and thumb rows', () => {
    expect(renderRendererVerticalScrollbar({
      contentRows: 20,
      viewportRows: 5,
      offsetFromBottom: 10,
      trackRows: 5,
      trackChar: '.',
      thumbChar: '#',
    })).toEqual(['.', '#', '.', '.', '.']);
  });

  it('hides the scrollbar when content fits in the viewport', () => {
    expect(renderRendererVerticalScrollbar({
      contentRows: 5,
      viewportRows: 5,
      trackRows: 5,
    })).toEqual([]);
  });

  it('renders right-gutter glyphs without changing line width', () => {
    expect(renderRendererRightGutterLines({
      lines: ['abc', 'abcdef', 'x'],
      width: 6,
      glyphs: ['│', '█', '·'],
    })).toEqual([
      'abc  │',
      'abcde█',
      'x    ·',
    ]);
  });
});

function rowText(buffer: RendererCellBuffer, y: number): string {
  return Array.from({ length: buffer.width }, (_, x) => buffer.getCell(x, y).char).join('');
}
