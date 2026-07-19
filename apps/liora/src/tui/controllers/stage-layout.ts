import {
  resolveResponsiveLayout,
  type ResponsiveLayoutProfile,
} from './responsive-layout';

/** Max reading-column width for the centered stage (cols). */
export const STAGE_MAX_WIDTH = 50;

/**
 * Max stage height on tall / fullscreen terminals (rows).
 * Paired with {@link STAGE_MAX_WIDTH} as a portrait 50×90 reading stage.
 */
export const STAGE_MAX_HEIGHT = 90;

/** Default situational rail width (cols). */
export const RAIL_WIDTH = 36;

/** Gap between stage and rail when both are shown (cols). */
export const STAGE_RAIL_GAP = 2;

export type StageLayoutMode = 'stack' | 'rail';

export interface StageBand {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StageLayout {
  readonly profile: ResponsiveLayoutProfile;
  readonly mode: StageLayoutMode;
  readonly stage: StageBand;
  readonly rail?: StageBand;
  /** Width of the centered bundle (stage, or stage+gap+rail). */
  readonly bundleWidth: number;
  /** Height of the centered stage band. */
  readonly bundleHeight: number;
}

export interface ResolveStageLayoutInput {
  readonly width: number;
  readonly height?: number;
  /** True when todo/activity/queue/btw would paint at least one row. */
  readonly hasRailContent: boolean;
}

/**
 * Resolve the centered stage (and optional situational rail) for a terminal size.
 *
 * - Narrow / short profiles keep a full-bleed stack.
 * - Wider terminals cap the stage at {@link STAGE_MAX_WIDTH} and center it.
 * - Tall terminals cap the stage at {@link STAGE_MAX_HEIGHT} and center it.
 * - A right rail opens only on `wide`/`ultrawide` when content exists and the
 *   stage+gap+rail bundle still fits; otherwise panels stay in the vertical stack.
 */
export function resolveStageLayout(input: ResolveStageLayoutInput): StageLayout {
  const cols = Math.max(0, Math.floor(input.width));
  const rows =
    input.height === undefined || !Number.isFinite(input.height) || input.height <= 0
      ? Number.POSITIVE_INFINITY
      : Math.floor(input.height);
  const profile = resolveResponsiveLayout({
    width: cols,
    height: Number.isFinite(rows) ? rows : undefined,
  });
  // Only wide+ terminals get a capped, centered reading column. Narrower
  // profiles stay full-bleed so small windows do not lose horizontal space.
  const railEligible = profile === 'wide' || profile === 'ultrawide';
  const stageWidth = railEligible ? Math.min(cols, STAGE_MAX_WIDTH) : cols;
  const stageHeight = Number.isFinite(rows) ? Math.min(rows, STAGE_MAX_HEIGHT) : STAGE_MAX_HEIGHT;
  const wantsRail = input.hasRailContent && railEligible;
  const railBundle = stageWidth + STAGE_RAIL_GAP + RAIL_WIDTH;
  const mode: StageLayoutMode = wantsRail && railBundle <= cols ? 'rail' : 'stack';
  const bundleWidth = mode === 'rail' ? railBundle : stageWidth;
  const bundleHeight = stageHeight;
  const x = cols > bundleWidth ? Math.floor((cols - bundleWidth) / 2) : 0;
  const y =
    Number.isFinite(rows) && rows > bundleHeight
      ? Math.floor((rows - bundleHeight) / 2)
      : 0;

  if (mode === 'rail') {
    return {
      profile,
      mode,
      stage: { x, y, width: stageWidth, height: stageHeight },
      rail: {
        x: x + stageWidth + STAGE_RAIL_GAP,
        y,
        width: RAIL_WIDTH,
        height: stageHeight,
      },
      bundleWidth,
      bundleHeight,
    };
  }

  return {
    profile,
    mode,
    stage: { x, y, width: stageWidth, height: stageHeight },
    bundleWidth,
    bundleHeight,
  };
}
