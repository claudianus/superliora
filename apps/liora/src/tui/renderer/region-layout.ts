import {
  measureRendererStackLayout,
  type RendererRect,
  type RendererStackFixedRegion,
} from '@harness-kit/tui-renderer';

export type RendererRegionId =
  | 'transcript'
  | 'activity'
  | 'todo'
  | 'queue'
  | 'btw'
  | 'editor'
  | 'footer'
  | 'header';

export type RendererFixedRegionId = Exclude<RendererRegionId, 'transcript'>;

export type RendererRegionHeights = Partial<Record<RendererFixedRegionId, number>>;

export interface RendererRegion {
  readonly id: RendererRegionId;
  readonly rows: number;
  readonly y: number;
  readonly rect?: RendererRect;
}

export interface RendererRegionLayout {
  readonly terminalRows: number;
  readonly terminalColumns: number;
  readonly transcriptRows: number;
  readonly reservedRows: number;
  readonly regions: readonly RendererRegion[];
}

const FIXED_REGION_IDS: readonly RendererFixedRegionId[] = [
  'activity',
  'todo',
  'queue',
  'btw',
  'editor',
  'footer',
];

/** Region IDs pinned above the transcript (top-to-bottom order). */
const TOP_FIXED_REGION_IDS: readonly RendererFixedRegionId[] = ['header'];

export function measureRendererRegions(options: {
  readonly terminalRows: number;
  readonly terminalColumns?: number;
  /** Horizontal origin for stacked regions (centered stage). */
  readonly contentX?: number;
  /** Horizontal width for stacked regions (centered stage). */
  readonly contentWidth?: number;
  /** Vertical origin for stacked regions (centered stage). */
  readonly contentY?: number;
  /** Vertical height budget for stacked regions (centered stage). */
  readonly contentHeight?: number;
  readonly heights: RendererRegionHeights;
  readonly minTranscriptRows?: number;
  /** Gap between adjacent bento tiles. @default 0 */
  readonly regionGap?: number;
}): RendererRegionLayout {
  const topRegions: Array<RendererStackFixedRegion<RendererRegionId>> = TOP_FIXED_REGION_IDS.map((id) => ({
    id,
    rows: options.heights[id],
  }));
  const fixedRegions: Array<RendererStackFixedRegion<RendererRegionId>> = FIXED_REGION_IDS.map((id) => ({
    id,
    rows: options.heights[id],
  }));
  const layout = measureRendererStackLayout<RendererRegionId>({
    terminalRows: options.terminalRows,
    terminalColumns: options.terminalColumns,
    contentX: options.contentX,
    contentWidth: options.contentWidth,
    contentY: options.contentY,
    contentHeight: options.contentHeight,
    primaryRegionId: 'transcript',
    topFixedRegions: topRegions,
    fixedRegions,
    minPrimaryRows: options.minTranscriptRows,
    regionGap: options.regionGap,
  });

  return {
    terminalRows: layout.terminalRows,
    terminalColumns: layout.terminalColumns,
    transcriptRows: layout.primaryRows,
    reservedRows: layout.reservedRows,
    regions: layout.regions,
  };
}
