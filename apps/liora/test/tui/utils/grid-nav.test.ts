import { describe, expect, it } from 'vitest';

import {
  gridMoveDown,
  gridMoveLeft,
  gridMoveRight,
  gridMoveUp,
  resolveGridColumns,
} from '#/tui/utils/ui/grid-nav';
import { SearchableList } from '#/tui/utils/ui/searchable-list';

describe('grid-nav', () => {
  it('resolves multi-column layouts only when width and count allow', () => {
    expect(resolveGridColumns({ width: 40, itemCount: 10, preferGrid: true })).toBe(1);
    expect(resolveGridColumns({ width: 90, itemCount: 10, preferGrid: true })).toBeGreaterThan(1);
    expect(resolveGridColumns({ width: 120, itemCount: 10, preferGrid: false })).toBe(1);
  });

  it('moves by columns on up/down and within row on left/right', () => {
    const state = { index: 4, count: 9, columns: 3 };
    expect(gridMoveUp(state)).toBe(1);
    expect(gridMoveDown(state)).toBe(7);
    expect(gridMoveLeft(state)).toBe(3);
    expect(gridMoveRight(state)).toBe(5);
  });

  it('clamps at edges', () => {
    expect(gridMoveUp({ index: 1, count: 9, columns: 3 })).toBe(1);
    expect(gridMoveLeft({ index: 3, count: 9, columns: 3 })).toBe(3);
    expect(gridMoveRight({ index: 5, count: 9, columns: 3 })).toBe(5);
    expect(gridMoveDown({ index: 7, count: 9, columns: 3 })).toBe(7);
  });
});

describe('SearchableList pageStride', () => {
  it('multiplies pageSize by columns for multi-column pages', () => {
    const list = new SearchableList({
      items: Array.from({ length: 40 }, (_, i) => ({ id: String(i) })),
      toSearchText: (item) => item.id,
      pageSize: 10,
      columns: 1,
    });
    expect(list.pageStride()).toBe(10);
    list.setColumns(3);
    expect(list.pageStride()).toBe(30);
  });
});
