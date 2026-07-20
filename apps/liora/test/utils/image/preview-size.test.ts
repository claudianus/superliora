import { describe, expect, it } from 'vitest';

import { computePreviewCellSize } from '#/utils/image/preview-size';

describe('computePreviewCellSize', () => {
  it('fits a square image to the height cap', () => {
    expect(computePreviewCellSize(8, 8, 40, 12)).toEqual({ columns: 24, rows: 12 });
  });

  it('fits a wide image to the width cap', () => {
    expect(computePreviewCellSize(1000, 250, 40, 12)).toEqual({ columns: 40, rows: 5 });
  });

  it('fits a tall image to the height cap', () => {
    expect(computePreviewCellSize(100, 1000, 40, 12)).toEqual({ columns: 2, rows: 12 });
  });

  it('rounds odd pixel heights down to a whole cell row', () => {
    expect(computePreviewCellSize(8, 3, 40, 12)).toEqual({ columns: 40, rows: 7 });
  });

  it('clamps degenerate caps to a single cell', () => {
    expect(computePreviewCellSize(100, 100, 0, 0)).toEqual({ columns: 1, rows: 1 });
  });
});
