import { describe, expect, it } from 'vitest';

import {
  composeRendererRegions,
  createRendererViewportSnapshot,
  decodeNativeInput,
  isTranscriptMeasureMode,
  measureRendererScrollbar,
  notifyTranscriptChildGeometryDirty,
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
  withTranscriptMeasureMode,
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

  it('jumps the viewport start to an exact line', () => {
    const viewport = new RendererViewport({ contentRows: 100, viewportRows: 20 });

    expect(viewport.jumpToLine(30)).toMatchObject({
      start: 30,
      followOutput: false,
      offsetFromBottom: 50,
    });
    // Fractional lines floor to the previous whole line.
    expect(viewport.jumpToLine(42.9)).toMatchObject({
      start: 42,
      followOutput: false,
    });
  });

  it('pins jump targets beyond the tail to the bottom', () => {
    const viewport = new RendererViewport({ contentRows: 100, viewportRows: 20 });

    expect(viewport.jumpToLine(95)).toMatchObject({
      start: 80,
      followOutput: true,
      offsetFromBottom: 0,
    });
  });

  it('jumps to the top for line 0 and clamps negative lines to the top', () => {
    const viewport = new RendererViewport({ contentRows: 100, viewportRows: 20 });

    expect(viewport.jumpToLine(0)).toMatchObject({
      start: 0,
      followOutput: false,
      offsetFromBottom: 80,
    });
    expect(viewport.jumpToLine(-5)).toMatchObject({
      start: 0,
      followOutput: false,
      offsetFromBottom: 80,
    });
  });

  it('leaves follow-output mode when jumping mid-content', () => {
    const viewport = new RendererViewport({ contentRows: 100, viewportRows: 20 });
    viewport.toBottom();
    expect(viewport.snapshot().followOutput).toBe(true);

    expect(viewport.jumpToLine(40)).toMatchObject({
      start: 40,
      followOutput: false,
    });
  });

  it('jumps the transcript viewport to an exact line and refreshes its snapshot', () => {
    const viewport = new RendererTranscriptViewport();
    viewport.sync(100, 20);

    expect(viewport.jumpToLine(30)).toMatchObject({
      start: 30,
      followOutput: false,
      offsetFromBottom: 50,
    });
    expect(viewport.snapshot()).toMatchObject({ start: 30, offsetFromBottom: 50 });
    expect(viewport.start()).toBe(30);

    expect(viewport.jumpToLine(99)).toMatchObject({
      start: 80,
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

    // Second render: geometry short-circuit; overflow probes only the 2
    // visible children (identity/content check), never the full tree.
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

  it('reuses overflow child render output when scrolling inside the same child', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 3,
    });
    let renderCount = 0;
    component.addChild({
      invalidate: () => {},
      render: () => {
        renderCount++;
        return Array.from({ length: 20 }, (_, index) => `line-${index}`);
      },
    });

    component.render(80);
    expect(renderCount).toBe(2);

    viewport.scroll('line-up');
    renderCount = 0;
    const lines = component.render(80);
    // One probe render for identity/content check; must not remeasure geometry.
    expect(renderCount).toBe(1);
    expect(lines).toEqual(['line-15', 'line-16', 'line-17']);
  });

  // ── Geometry vs paint epoch (scroll freeze guard) ──────────────────────
  //
  // Line counts must survive ambient/paint epoch advances and pure scroll.
  // Coupling geometry to paint epoch remeasured every historical child on each
  // ambient tick — the dominant freeze path under large transcripts.

  function mountInstrumentedTranscript(options: {
    childCount: number;
    linesPerChild?: number;
    visibleRows?: number;
    getCacheEpoch?: () => number;
  }): {
    viewport: RendererTranscriptViewport;
    component: RendererTranscriptViewportComponent;
    renderCounts: number[];
    totalRenders: () => number;
  } {
    const linesPerChild = options.linesPerChild ?? 2;
    const renderCounts = Array.from({ length: options.childCount }, () => 0);
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => options.visibleRows ?? 5,
      getCacheEpoch: options.getCacheEpoch,
    });
    for (let i = 0; i < options.childCount; i++) {
      const index = i;
      component.addChild({
        invalidate: () => {},
        render: () => {
          renderCounts[index]!++;
          return Array.from({ length: linesPerChild }, (_, line) => `c${index}-l${line}`);
        },
      });
    }
    return {
      viewport,
      component,
      renderCounts,
      totalRenders: () => renderCounts.reduce((sum, n) => sum + n, 0),
    };
  }

  it('pure paint-epoch advance does not remeasure all children', () => {
    let epoch = 0;
    const { component, renderCounts, totalRenders } = mountInstrumentedTranscript({
      childCount: 40,
      linesPerChild: 3,
      visibleRows: 6,
      getCacheEpoch: () => epoch,
    });

    // Warm geometry + visible paint caches.
    component.render(80);
    const warmTotal = totalRenders();
    expect(warmTotal).toBeGreaterThanOrEqual(40);
    // Every child measured once for geometry; a few visible measured again for paint.
    expect(renderCounts.every((n) => n >= 1)).toBe(true);

    // Ambient animation tick: paint epoch advances, geometry must stay warm.
    epoch = 1;
    const before = totalRenders();
    component.render(80);
    const afterEpoch = totalRenders() - before;

    // Only children intersecting the visible window may repaint — never the full tree.
    expect(afterEpoch).toBeLessThan(40);
    expect(afterEpoch).toBeLessThanOrEqual(6);
    // Off-screen children must not have been touched by the epoch tick.
    const offscreenAfterWarm = renderCounts.slice(0, 30);
    const offscreenSnapshots = offscreenAfterWarm.map((n) => n);
    epoch = 2;
    component.render(80);
    for (let i = 0; i < 30; i++) {
      expect(renderCounts[i]).toBe(offscreenSnapshots[i]);
    }
  });

  it('pure scroll after warm geometry stays O(visible), not O(all children)', () => {
    const { viewport, component, renderCounts, totalRenders } = mountInstrumentedTranscript({
      childCount: 50,
      linesPerChild: 2,
      visibleRows: 4,
    });

    component.render(80);
    renderCounts.fill(0);

    // Page/line/top/bottom while content + width unchanged.
    const actions = ['page-up', 'line-up', 'line-down', 'top', 'page-down', 'bottom'] as const;
    for (const action of actions) {
      viewport.scroll(action);
      const before = totalRenders();
      component.render(80);
      const delta = totalRenders() - before;
      // At most a small visible subset (children spanning ~4 rows + neighbors).
      expect(delta).toBeLessThan(50);
      expect(delta).toBeLessThanOrEqual(6);
    }

    // After the scroll sequence, most historical children stay at 0 additional renders.
    const untouched = renderCounts.filter((n) => n === 0).length;
    expect(untouched).toBeGreaterThan(30);
  });

  it('keeps correct viewport windows across pure scroll actions on a large transcript', () => {
    const { viewport, component } = mountInstrumentedTranscript({
      childCount: 20,
      linesPerChild: 5,
      visibleRows: 10,
    });
    // 20 * 5 = 100 content rows, viewport 10 → overflow.

    component.render(80);
    expect(viewport.snapshot()).toMatchObject({
      start: 90,
      end: 100,
      followOutput: true,
      hasOverflow: true,
      contentRows: 100,
      viewportRows: 10,
    });

    expect(viewport.scroll('top')).toBe(true);
    component.render(80);
    expect(viewport.snapshot()).toMatchObject({
      start: 0,
      end: 10,
      followOutput: false,
      offsetFromBottom: 90,
    });

    expect(viewport.scroll('page-down')).toBe(true);
    component.render(80);
    expect(viewport.snapshot()).toMatchObject({
      start: 9,
      end: 19,
      followOutput: false,
    });

    expect(viewport.scroll('bottom')).toBe(true);
    component.render(80);
    expect(viewport.snapshot()).toMatchObject({
      start: 90,
      end: 100,
      followOutput: true,
      offsetFromBottom: 0,
    });

    // Follow-output tracks growth while pinned to bottom.
    component.addChild({
      invalidate: () => {},
      render: () => ['extra-a', 'extra-b', 'extra-c', 'extra-d', 'extra-e'],
    });
    component.render(80);
    expect(viewport.snapshot()).toMatchObject({
      start: 95,
      end: 105,
      followOutput: true,
      contentRows: 105,
    });
  });

  it('content invalidate remeasures so total height stays correct', () => {
    const viewport = new RendererTranscriptViewport();
    let lines = ['a', 'b'];
    let renderCount = 0;
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 50,
    });
    component.addChild({
      invalidate: () => {},
      render: () => {
        renderCount++;
        return lines;
      },
    });
    for (let i = 0; i < 9; i++) {
      component.addChild({
        invalidate: () => {},
        render: () => ['x', 'y'],
      });
    }

    expect(component.contentRowCount(80)).toBe(20);
    const afterWarm = renderCount;

    // In-place content growth (same child ref): must invalidate geometry.
    lines = ['a', 'b', 'c', 'd', 'e', 'f'];
    component.invalidate();
    expect(component.contentRowCount(80)).toBe(24);
    expect(renderCount).toBeGreaterThan(afterWarm);
  });

  it('appended child remeasures only the new slot when geometry is warm', () => {
    const { component, renderCounts } = mountInstrumentedTranscript({
      childCount: 15,
      linesPerChild: 2,
      visibleRows: 4,
    });
    component.render(80);
    renderCounts.fill(0);

    let newChildRenders = 0;
    component.addChild({
      invalidate: () => {},
      render: () => {
        newChildRenders++;
        return ['new-a', 'new-b'];
      },
    });
    // Identity reconcile: prior children keep geometry counts; new child is
    // measured for geometry (+ again if it intersects the visible bottom).
    component.render(80);
    const priorRenders = renderCounts.reduce((sum, n) => sum + n, 0);
    // Prior slots may repaint if they intersect the new bottom window, but
    // geometry must not force a full remeasure of all 15.
    expect(priorRenders).toBeLessThan(15);
    expect(newChildRenders).toBeGreaterThan(0);
    expect(newChildRenders).toBeLessThanOrEqual(2);
    expect(component.contentRowCount(80)).toBe(32);
  });

  it('invalidatePaint preserves geometry counts across paint-only refresh', () => {
    let epoch = 0;
    const { component, totalRenders } = mountInstrumentedTranscript({
      childCount: 25,
      linesPerChild: 2,
      visibleRows: 4,
      getCacheEpoch: () => epoch,
    });
    component.render(80);
    const warm = totalRenders();

    component.invalidatePaint();
    epoch = 1;
    const before = totalRenders();
    expect(component.contentRowCount(80)).toBe(50);
    // contentRowCount is geometry-only — no child.render after paint invalidate.
    expect(totalRenders()).toBe(before);

    // Full render may repaint visible children (overflow cache cleared) but
    // must not remeasure the whole tree for line counts.
    component.render(80);
    expect(totalRenders() - before).toBeLessThan(25);
    expect(totalRenders()).toBeGreaterThan(warm);
  });

  it('invalidateChildGeometry remeasures only the dirty slot', () => {
    const linesByChild: string[][] = Array.from({ length: 20 }, (_, i) => [
      `c${i}-a`,
      `c${i}-b`,
    ]);
    const renderCounts = Array.from({ length: 20 }, () => 0);
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 4,
    });
    const children = linesByChild.map((lines, index) => {
      const child = {
        invalidate: () => {},
        render: () => {
          renderCounts[index]!++;
          return linesByChild[index]!;
        },
      };
      component.addChild(child);
      return child;
    });

    expect(component.contentRowCount(80)).toBe(40);
    renderCounts.fill(0);

    // Grow child 5 in place (streaming-style mutation).
    linesByChild[5] = ['x', 'y', 'z', 'w', 'v', 'u'];
    component.invalidateChildGeometry(children[5]!);
    expect(component.contentRowCount(80)).toBe(44);

    // Only the dirty slot remeasured for geometry.
    expect(renderCounts[5]).toBe(1);
    expect(renderCounts.filter((n, i) => i !== 5 && n > 0)).toEqual([]);
  });

  it('notifyTranscriptChildGeometryDirty reaches the parent registered on addChild', () => {
    let lines = ['a'];
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 50,
    });
    // Neighbors prove only the dirty slot is remeasured.
    for (let i = 0; i < 5; i++) {
      component.addChild({
        invalidate: () => {},
        render: () => ['n'],
      });
    }
    const live = {
      invalidate: () => {},
      render: () => lines,
    };
    component.addChild(live);
    for (let i = 0; i < 5; i++) {
      component.addChild({
        invalidate: () => {},
        render: () => ['n'],
      });
    }

    expect(component.contentRowCount(80)).toBe(11);
    lines = ['a', 'b', 'c', 'd', 'e'];
    // Product mutators call notify — must not require a manual parent invalidate.
    notifyTranscriptChildGeometryDirty(live);
    expect(component.contentRowCount(80)).toBe(15);
  });

  it('geometry generation short-circuits repeated contentRowCount without child.render', () => {
    const { component, totalRenders } = mountInstrumentedTranscript({
      childCount: 40,
      linesPerChild: 2,
      visibleRows: 5,
    });
    component.render(80);
    const afterWarm = totalRenders();
    // Layout shift detection calls contentRowCount every frame — must be free.
    for (let i = 0; i < 20; i++) {
      expect(component.contentRowCount(80)).toBe(80);
    }
    expect(totalRenders()).toBe(afterWarm);
  });

  it('pure scroll formats only the visible slice of a tall child', () => {
    let paintCount = 0;
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 4,
      paintLine: (line) => {
        paintCount++;
        return line;
      },
    });
    // Tall body: full format would cost 200 paintLine calls per first intersection.
    component.addChild({
      invalidate: () => {},
      render: () => Array.from({ length: 200 }, (_, i) => `line-${i}`),
    });

    component.render(80);
    // Only the visible window is formatted (not the whole 200-line body).
    expect(paintCount).toBe(4);
    paintCount = 0;

    // Scroll inside the same child — new rows format; already-seen rows reuse sparse cache.
    viewport.scroll('line-up');
    component.render(80);
    // lineScrollRows defaults to 3 → up to 3 new lines formatted.
    expect(paintCount).toBeLessThanOrEqual(3);
    expect(paintCount).toBeGreaterThan(0);
    const afterScroll = paintCount;
    paintCount = 0;
    // Re-render same window: sparse cache hit, no paintLine.
    component.render(80);
    expect(paintCount).toBe(0);
    expect(afterScroll).toBeGreaterThan(0);
  });

  it('ambient paint-epoch advance does not wipe overflow format cache for static children', () => {
    let epoch = 0;
    let paintCount = 0;
    const stableLines = Array.from({ length: 30 }, (_, i) => `s${i}`);
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 5,
      getCacheEpoch: () => epoch,
      paintLine: (line) => {
        paintCount++;
        return line;
      },
    });
    component.addChild({
      invalidate: () => {},
      // Stable array identity — finalized messages return cached lines.
      render: () => stableLines,
    });

    component.render(80);
    expect(paintCount).toBe(5);
    paintCount = 0;

    // Ambient ticks advance epoch; pure scroll must not re-format static paint.
    epoch = 1;
    viewport.scroll('line-up');
    component.render(80);
    epoch = 2;
    viewport.scroll('line-up');
    component.render(80);
    // At most newly revealed rows; not a full 5-line reformat every epoch.
    expect(paintCount).toBeLessThanOrEqual(6);
  });

  it('rapid page-down keeps paintLine near O(visible) not O(content)', () => {
    let paintCount = 0;
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 8,
      paintLine: (line) => {
        paintCount++;
        return line;
      },
    });
    // 50 children × 20 lines = 1000 content rows.
    for (let i = 0; i < 50; i++) {
      const label = `c${i}`;
      component.addChild({
        invalidate: () => {},
        render: () => Array.from({ length: 20 }, (_, j) => `${label}-${j}`),
      });
    }

    // Start at top so page-down walks through many children.
    component.render(80);
    viewport.scroll('top');
    component.render(80);
    paintCount = 0;

    for (let step = 0; step < 12; step++) {
      viewport.scroll('page-down');
      component.render(80);
    }
    // 12 pages × ~8 visible rows upper bound if every row were new and never
    // reused. With slice cache, cost stays near that ceiling — never near
    // 50×20 full-body format storms.
    expect(paintCount).toBeLessThanOrEqual(12 * 8);
    expect(paintCount).toBeGreaterThan(0);
  });

  it('replaceChild dirties only the slot and does not cascade sibling invalidate', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 50,
    });
    const siblingInvalidates: number[] = [];
    for (let i = 0; i < 10; i++) {
      const idx = i;
      component.addChild({
        invalidate: () => {
          siblingInvalidates[idx] = (siblingInvalidates[idx] ?? 0) + 1;
        },
        render: () => [`s${idx}`],
      });
    }
    const oldChild = {
      invalidate: () => {},
      render: () => ['old'],
    };
    component.addChild(oldChild);
    component.render(80);
    siblingInvalidates.fill(0);

    const newChild = {
      invalidate: () => {},
      render: () => ['new-a', 'new-b', 'new-c'],
    };
    expect(component.replaceChild(oldChild, newChild)).toBe(true);
    // No full invalidate cascade to historical siblings.
    expect(siblingInvalidates.every((n) => n === 0)).toBe(true);
    expect(component.contentRowCount(80)).toBe(10 + 3);
  });

  it('invalidateGeometryAndPaint does not cascade child.invalidate', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 10,
    });
    let childInvalidates = 0;
    for (let i = 0; i < 8; i++) {
      component.addChild({
        invalidate: () => {
          childInvalidates++;
        },
        render: () => ['x'],
      });
    }
    component.render(80);
    childInvalidates = 0;
    component.invalidateGeometryAndPaint();
    expect(childInvalidates).toBe(0);
    // Geometry cleared — next count remeasures.
    expect(component.contentRowCount(80)).toBe(8);
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

  it('contentRowCount probes run under transcript measure-mode isolation', () => {
    const viewport = new RendererTranscriptViewport();
    const component = new RendererTranscriptViewportComponent({
      viewport,
      getVisibleRows: () => 10,
    });
    let sawMeasure = false;
    component.addChild({
      invalidate: () => {},
      render: () => {
        if (isTranscriptMeasureMode()) sawMeasure = true;
        return ['line'];
      },
    });
    expect(component.contentRowCount(80)).toBe(1);
    expect(sawMeasure).toBe(true);
    expect(isTranscriptMeasureMode()).toBe(false);
    withTranscriptMeasureMode(() => {
      expect(isTranscriptMeasureMode()).toBe(true);
    });
    expect(isTranscriptMeasureMode()).toBe(false);
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

  it('renders a capsule thumb with rounded ends and soft track', () => {
    // Mid-scroll: content 20, viewport 5, offsetFromBottom 10 → start 5, progress 5/15.
    // track 6, thumb ~2 → rounded top/bottom when thumbRows ≥ 2.
    const glyphs = renderRendererVerticalScrollbar({
      contentRows: 20,
      viewportRows: 5,
      offsetFromBottom: 10,
      trackRows: 6,
      variant: 'capsule',
      edgeCues: false,
    });
    expect(glyphs).toHaveLength(6);
    // Soft track (not solid │)
    expect(glyphs.some((g) => g === '┊')).toBe(true);
    // Rounded or solid thumb cells present
    const thumbish = glyphs.filter((g) => g === '▀' || g === '█' || g === '▄');
    expect(thumbish.length).toBeGreaterThanOrEqual(1);
  });

  it('paints capsule edge cues when not at top/bottom', () => {
    // At top of content (offsetFromBottom = max) → no top cue, bottom cue if room.
    const atTop = renderRendererVerticalScrollbar({
      contentRows: 40,
      viewportRows: 5,
      offsetFromBottom: 35,
      trackRows: 8,
      variant: 'capsule',
      minThumbRows: 2,
    });
    expect(atTop[0]).not.toBe('▴'); // at top
    expect(atTop.at(-1)).toBe('▾'); // more below

    // At bottom
    const atBottom = renderRendererVerticalScrollbar({
      contentRows: 40,
      viewportRows: 5,
      offsetFromBottom: 0,
      trackRows: 8,
      variant: 'capsule',
      minThumbRows: 2,
    });
    expect(atBottom[0]).toBe('▴');
    expect(atBottom.at(-1)).not.toBe('▾');
  });

  it('applies paintGlyph roles for themed scrollbars', () => {
    const glyphs = renderRendererVerticalScrollbar({
      contentRows: 20,
      viewportRows: 5,
      offsetFromBottom: 10,
      trackRows: 5,
      trackChar: '.',
      thumbChar: '#',
      paintGlyph: (role, glyph) => `[${role}:${glyph}]`,
    });
    expect(glyphs.some((g) => g.startsWith('[thumb:') || g.startsWith('[track:'))).toBe(true);
    expect(glyphs.every((g) => g.startsWith('['))).toBe(true);
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

  it('keeps ANSI-styled gutter glyphs as a single cell', () => {
    const styled = '\u001B[38;2;79;168;255m█\u001B[0m';
    const lines = renderRendererRightGutterLines({
      lines: ['hello'],
      width: 8,
      glyphs: [styled],
    });
    expect(lines).toHaveLength(1);
    // Visible width stays 8 (content + pad + one display cell).
    expect(lines[0]!.replaceAll(/\u001B\[[0-9;]*m/g, '').length).toBe(8);
    expect(lines[0]).toContain('█');
    expect(lines[0]).toContain('\u001B[');
  });
});

function rowText(buffer: RendererCellBuffer, y: number): string {
  return Array.from({ length: buffer.width }, (_, x) => buffer.getCell(x, y).char).join('');
}

