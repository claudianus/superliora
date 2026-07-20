/**
 * Shared cell-size fitting for image previews.
 *
 * Fits an image into a `maxWidth` × `maxHeightRows` cell rectangle while
 * preserving aspect ratio. `rows` counts terminal cell rows; half-block
 * rendering covers two pixel rows per cell row, so the fitted pixel height
 * is always `rows * 2`.
 */

export interface PreviewCellSize {
  readonly columns: number;
  readonly rows: number;
}

export function computePreviewCellSize(
  imageWidth: number,
  imageHeight: number,
  maxWidth: number,
  maxHeightRows: number,
): PreviewCellSize {
  const widthCap = Math.max(1, maxWidth);
  const heightCap = Math.max(1, maxHeightRows);
  const scale = Math.min(widthCap / imageWidth, (heightCap * 2) / imageHeight);
  const columns = clamp(Math.round(imageWidth * scale), 1, widthCap);
  let pixelRows = clamp(Math.round(imageHeight * scale), 2, heightCap * 2);
  if (pixelRows % 2 === 1) pixelRows -= 1;
  return { columns, rows: pixelRows / 2 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
