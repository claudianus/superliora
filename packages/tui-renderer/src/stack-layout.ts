import type { RendererRect } from './compositor';
import type { RendererFrameRegion, RendererFrameRegionContent } from './layout-frame';

export interface RendererStackFixedRegion<Id extends string = string> {
  readonly id: Id;
  readonly rows?: number;
}

export interface RendererStackLayoutOptions<Id extends string = string> {
  readonly terminalRows: number;
  readonly terminalColumns?: number;
  readonly primaryRegionId: Id;
  readonly fixedRegions: readonly RendererStackFixedRegion<Id>[];
  /**
   * Fixed regions pinned ABOVE the primary region (e.g. a header bar). They are
   * stacked top-to-bottom starting at y=0, then the primary region follows, then
   * the regular `fixedRegions` below it. Rows are reserved from the same budget
   * as `fixedRegions`. Omit (or pass an empty array) for the original behavior
   * where the primary region starts at y=0.
   */
  readonly topFixedRegions?: readonly RendererStackFixedRegion<Id>[];
  readonly minPrimaryRows?: number;
}

export interface RendererStackLayoutRegion<Id extends string = string> {
  readonly id: Id;
  readonly rows: number;
  readonly y: number;
  readonly rect?: RendererRect;
}

export interface RendererStackLayout<Id extends string = string> {
  readonly terminalRows: number;
  readonly terminalColumns: number;
  readonly primaryRows: number;
  readonly reservedRows: number;
  readonly regions: readonly RendererStackLayoutRegion<Id>[];
}

export interface RendererStackFrameRegion<Id extends string = string>
  extends Omit<RendererFrameRegion, 'id' | 'rect' | 'content'> {
  readonly id: Id;
  readonly content: RendererFrameRegionContent;
}

export function measureRendererStackLayout<Id extends string>(
  options: RendererStackLayoutOptions<Id>,
): RendererStackLayout<Id> {
  const terminalRows = normalizeTerminalRows(options.terminalRows);
  const terminalColumns = normalizeTerminalColumns(options.terminalColumns);

  if (!Number.isFinite(terminalRows)) {
    return {
      terminalRows,
      terminalColumns,
      primaryRows: Number.POSITIVE_INFINITY,
      reservedRows: 0,
      regions: [
        createRegion({
          id: options.primaryRegionId,
          y: 0,
          rows: Number.POSITIVE_INFINITY,
          columns: terminalColumns,
        }),
      ],
    };
  }

  const minPrimaryRows = normalizeMinPrimaryRows(options.minPrimaryRows);
  const topFixedRegions = (options.topFixedRegions ?? [])
    .map((region) => ({ id: region.id, rows: normalizeRegionRows(region.rows) }))
    .filter((region) => region.rows > 0);
  const fixedRegions = options.fixedRegions
    .map((region) => ({ id: region.id, rows: normalizeRegionRows(region.rows) }))
    .filter((region) => region.rows > 0);
  const topReservedRows = topFixedRegions.reduce((sum, region) => sum + region.rows, 0);
  const reservedRows = fixedRegions.reduce((sum, region) => sum + region.rows, 0);
  const primaryRows = Math.max(minPrimaryRows, terminalRows - topReservedRows - reservedRows);

  const regions: RendererStackLayoutRegion<Id>[] = [];

  // Top-pinned fixed regions (header) start at y=0.
  let y = 0;
  for (const top of topFixedRegions) {
    regions.push(createRegion({
      id: top.id,
      y,
      rows: top.rows,
      columns: terminalColumns,
    }));
    y += top.rows;
  }

  // Primary region follows the top regions.
  regions.push(createRegion({
    id: options.primaryRegionId,
    y,
    rows: primaryRows,
    columns: terminalColumns,
  }));
  y += primaryRows;

  // Bottom-pinned fixed regions follow the primary region.
  for (const fixed of fixedRegions) {
    regions.push(createRegion({
      id: fixed.id,
      y,
      rows: fixed.rows,
      columns: terminalColumns,
    }));
    y += fixed.rows;
  }

  return {
    terminalRows,
    terminalColumns,
    primaryRows,
    reservedRows: topReservedRows + reservedRows,
    regions,
  };
}

export function createRendererStackFrameRegions<Id extends string>(
  layout: { readonly regions: readonly RendererStackLayoutRegion<Id>[] },
  regions: readonly RendererStackFrameRegion<Id>[],
): readonly RendererFrameRegion[] {
  const sources = new Map(regions.map((region) => [region.id, region]));
  return layout.regions.flatMap((layoutRegion) => {
    const source = sources.get(layoutRegion.id);
    if (source === undefined || layoutRegion.rect === undefined) return [];
    return [{
      id: source.id,
      rect: layoutRegion.rect,
      content: source.content,
      zIndex: source.zIndex,
      visible: source.visible,
      scrollY: source.scrollY,
      style: source.style,
      clear: source.clear,
      background: source.background,
      vfx: source.vfx,
    }];
  });
}

function createRegion<Id extends string>(options: {
  readonly id: Id;
  readonly y: number;
  readonly rows: number;
  readonly columns: number;
}): RendererStackLayoutRegion<Id> {
  const rect = Number.isFinite(options.rows) && Number.isFinite(options.columns)
    ? { x: 0, y: options.y, width: options.columns, height: options.rows }
    : undefined;
  return {
    id: options.id,
    y: options.y,
    rows: options.rows,
    rect,
  };
}

function normalizeTerminalRows(rows: number): number {
  if (!Number.isFinite(rows) || rows <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor(rows);
}

function normalizeTerminalColumns(columns: number | undefined): number {
  if (columns === undefined || !Number.isFinite(columns) || columns <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor(columns);
}

function normalizeMinPrimaryRows(rows: number | undefined): number {
  if (rows === undefined || !Number.isFinite(rows) || rows < 1) return 1;
  return Math.floor(rows);
}

function normalizeRegionRows(rows: number | undefined): number {
  if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return 0;
  return Math.floor(rows);
}
