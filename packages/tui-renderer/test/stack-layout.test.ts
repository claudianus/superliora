import { describe, expect, it } from 'vitest';

import { createRendererStackFrameRegions, measureRendererStackLayout } from '../src';

describe('measureRendererStackLayout', () => {
  it('assigns the primary region to remaining rows and stacks fixed regions below it', () => {
    const layout = measureRendererStackLayout({
      terminalRows: 12,
      terminalColumns: 80,
      primaryRegionId: 'main',
      fixedRegions: [
        { id: 'status', rows: 2 },
        { id: 'input', rows: 3 },
      ],
    });

    expect(layout).toMatchObject({
      terminalRows: 12,
      terminalColumns: 80,
      primaryRows: 7,
      reservedRows: 5,
    });
    expect(layout.regions).toEqual([
      {
        id: 'main',
        rows: 7,
        y: 0,
        rect: { x: 0, y: 0, width: 80, height: 7 },
      },
      {
        id: 'status',
        rows: 2,
        y: 7,
        rect: { x: 0, y: 7, width: 80, height: 2 },
      },
      {
        id: 'input',
        rows: 3,
        y: 9,
        rect: { x: 0, y: 9, width: 80, height: 3 },
      },
    ]);
  });

  it('drops overflowing trailing fixed regions to protect the primary minimum', () => {
    const layout = measureRendererStackLayout({
      terminalRows: 5,
      terminalColumns: 20,
      primaryRegionId: 'main',
      fixedRegions: [{ id: 'footer', rows: 7 }],
      minPrimaryRows: 2,
    });

    // A 7-row footer cannot coexist with minPrimaryRows=2 on a 5-row band —
    // drop the trailing fixed region so the primary keeps the viewport.
    expect(layout.primaryRows).toBe(5);
    expect(layout.reservedRows).toBe(0);
    expect(layout.regions).toEqual([
      {
        id: 'main',
        rows: 5,
        y: 0,
        rect: { x: 0, y: 0, width: 20, height: 5 },
      },
    ]);
  });

  it('treats unknown terminal height as an unbounded primary region', () => {
    const layout = measureRendererStackLayout({
      terminalRows: 0,
      primaryRegionId: 'main',
      fixedRegions: [{ id: 'footer', rows: 2 }],
    });

    expect(layout.primaryRows).toBe(Number.POSITIVE_INFINITY);
    expect(layout.reservedRows).toBe(0);
    expect(layout.regions).toEqual([
      {
        id: 'main',
        rows: Number.POSITIVE_INFINITY,
        y: 0,
        rect: undefined,
      },
    ]);
  });

  it('honors contentX/contentWidth for a centered content column', () => {
    const layout = measureRendererStackLayout({
      terminalRows: 10,
      terminalColumns: 200,
      contentX: 46,
      contentWidth: 108,
      primaryRegionId: 'main',
      fixedRegions: [{ id: 'footer', rows: 2 }],
    });

    expect(layout.regions).toEqual([
      {
        id: 'main',
        rows: 8,
        y: 0,
        rect: { x: 46, y: 0, width: 108, height: 8 },
      },
      {
        id: 'footer',
        rows: 2,
        y: 8,
        rect: { x: 46, y: 8, width: 108, height: 2 },
      },
    ]);
  });

  it('honors contentY/contentHeight for a vertically centered content band', () => {
    const layout = measureRendererStackLayout({
      terminalRows: 80,
      terminalColumns: 100,
      contentY: 20,
      contentHeight: 40,
      primaryRegionId: 'main',
      fixedRegions: [{ id: 'footer', rows: 2 }],
    });

    expect(layout.primaryRows).toBe(38);
    expect(layout.regions).toEqual([
      {
        id: 'main',
        rows: 38,
        y: 20,
        rect: { x: 0, y: 20, width: 100, height: 38 },
      },
      {
        id: 'footer',
        rows: 2,
        y: 58,
        rect: { x: 0, y: 58, width: 100, height: 2 },
      },
    ]);
  });

  it('maps measured stack regions into native frame regions', () => {
    const layout = measureRendererStackLayout({
      terminalRows: 4,
      terminalColumns: 10,
      primaryRegionId: 'main',
      fixedRegions: [
        { id: 'empty', rows: 1 },
        { id: 'footer', rows: 1 },
      ],
    });

    expect(createRendererStackFrameRegions(layout, [
      { id: 'main', content: [] },
      { id: 'footer', content: ['ok'], zIndex: 2 },
    ])).toEqual([
      {
        id: 'main',
        rect: { x: 0, y: 0, width: 10, height: 2 },
        content: [],
        zIndex: undefined,
        visible: undefined,
        scrollY: undefined,
        style: undefined,
        clear: undefined,
        background: undefined,
      },
      {
        id: 'footer',
        rect: { x: 0, y: 3, width: 10, height: 1 },
        content: ['ok'],
        zIndex: 2,
        visible: undefined,
        scrollY: undefined,
        style: undefined,
        clear: undefined,
        background: undefined,
      },
    ]);
  });

  it('inserts regionGap between stacked tiles and reserves it from primary', () => {
    const layout = measureRendererStackLayout({
      terminalRows: 12,
      terminalColumns: 40,
      primaryRegionId: 'main',
      topFixedRegions: [{ id: 'header', rows: 2 }],
      fixedRegions: [{ id: 'footer', rows: 2 }],
      regionGap: 1,
    });

    // header(2) + gap(1) + main + gap(1) + footer(2) = 12 → main = 6
    expect(layout.primaryRows).toBe(6);
    expect(layout.regions.map((r) => ({ id: r.id, y: r.y, rows: r.rows }))).toEqual([
      { id: 'header', y: 0, rows: 2 },
      { id: 'main', y: 3, rows: 6 },
      { id: 'footer', y: 10, rows: 2 },
    ]);
  });
});
