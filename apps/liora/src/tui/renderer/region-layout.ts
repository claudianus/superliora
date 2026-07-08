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
  readonly heights: RendererRegionHeights;
  readonly minTranscriptRows?: number;
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
    primaryRegionId: 'transcript',
    topFixedRegions: topRegions,
    fixedRegions,
    minPrimaryRows: options.minTranscriptRows,
  });

  return {
    terminalRows: layout.terminalRows,
    terminalColumns: layout.terminalColumns,
    transcriptRows: layout.primaryRows,
    reservedRows: layout.reservedRows,
    regions: layout.regions,
  };
}
