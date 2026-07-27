import { describe, expect, it } from 'vitest';

import {
  CENTER_MODAL_REGION_ID,
  centerModalBreadcrumb,
  centerModalContentWidth,
  createCenterModalOverlayRegion,
  type CenterModalEntry,
} from '#/tui/utils/center-modal';

describe('centerModalContentWidth', () => {
  it('caps at 72 and leaves margin', () => {
    expect(centerModalContentWidth(120)).toBe(72);
    expect(centerModalContentWidth(40)).toBe(36);
    expect(centerModalContentWidth(20)).toBe(24);
  });
});

describe('createCenterModalOverlayRegion', () => {
  it('returns undefined for an empty stack', () => {
    expect(
      createCenterModalOverlayRegion([], { x: 0, y: 0, width: 80, height: 24 }),
    ).toBeUndefined();
  });

  it('renders the top panel into a center region', () => {
    const panel = {
      render: (width: number) => [`w=${String(width)}`, 'body'],
      handleInput: () => {},
      focused: false,
    };
    const stack: CenterModalEntry[] = [
      {
        id: 'center-modal:1',
        panel: panel as unknown as CenterModalEntry['panel'],
        disposeInput: () => {},
      },
    ];
    const region = createCenterModalOverlayRegion(stack, {
      x: 0,
      y: 0,
      width: 80,
      height: 24,
    });
    expect(region?.id).toBe(CENTER_MODAL_REGION_ID);
    expect(region?.rect.width).toBeGreaterThan(0);
    expect(region?.rect.height).toBeGreaterThan(0);
    expect(Array.isArray(region?.content)).toBe(true);
  });

  it('builds Hub › child breadcrumbs from stack labels', () => {
    expect(
      centerModalBreadcrumb([
        {
          id: 'a',
          panel: { render: () => [], handleInput: () => {}, focused: false } as never,
          disposeInput: () => {},
          label: 'Hub',
        },
        {
          id: 'b',
          panel: { render: () => [], handleInput: () => {}, focused: false } as never,
          disposeInput: () => {},
          label: 'Model',
        },
      ]),
    ).toBe('Hub › Model');
  });
});
