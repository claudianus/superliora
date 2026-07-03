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

  it('keeps a minimum primary region even when fixed regions overflow', () => {
    const layout = measureRendererStackLayout({
      terminalRows: 5,
      terminalColumns: 20,
      primaryRegionId: 'main',
      fixedRegions: [{ id: 'footer', rows: 7 }],
      minPrimaryRows: 2,
    });

    expect(layout.primaryRows).toBe(2);
    expect(layout.reservedRows).toBe(7);
    expect(layout.regions[1]).toMatchObject({
      id: 'footer',
      y: 2,
      rect: { x: 0, y: 2, width: 20, height: 7 },
    });
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
});
