import {
  resolveResponsiveLayout,
  type ResponsiveLayoutProfile,
} from './responsive-layout';

/** Max reading-column width for the centered stage (cols). */
export const STAGE_MAX_WIDTH = 90;

/**
 * Max stage height on tall / fullscreen terminals (rows).
 * Paired with {@link STAGE_MAX_WIDTH} as a 90×50 reading stage (cell units).
 */
export const STAGE_MAX_HEIGHT = 50;

/** Default situational rail width (cols). */
export const RAIL_WIDTH = 36;

/**
 * Narrower rail used in full-bleed docked layouts when the center band cannot
 * host {@link RAIL_WIDTH} without starving the transcript column.
 */
export const COMPACT_RAIL_WIDTH = 28;

/** Gap between stage and rail when both are shown (cols). */
export const STAGE_RAIL_GAP = 2;

/**
 * Minimum terminal width (cols) at which the situational rail may open.
 * Below this threshold the panels stay in the vertical stack even when they
 * have content, so narrow windows keep the full width for the transcript.
 */
export const RAIL_MIN_COLS = 120;

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
  /** Left workspace dock (file explorer, etc.). */
  readonly leftDock?: StageBand;
  /** Right workspace dock (terminal, etc.). Overrides rail when present. */
  readonly rightDock?: StageBand;
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
  /** Width of the left workspace dock (0 or undefined = no dock). */
  readonly leftDockWidth?: number;
  /** Width of the right workspace dock (0 or undefined = no dock). */
  readonly rightDockWidth?: number;
  /**
   * Shell-aware workspace center band (e.g. `measureWorkspaceLayout(...).center`).
   * Already excludes dock widths, dock gaps, and shell inset — when set, the
   * stage resolves inside this band instead of subtracting
   * `leftDockWidth`/`rightDockWidth` from the raw terminal edges.
   */
  readonly workspaceCenter?: { x: number; y: number; width: number; height: number };
  /**
   * Full-bleed bento mode: skip the centered reading-column cap so the stage
   * fills the workspace center band edge-to-edge (dashboard composition).
   */
  readonly fullBleed?: boolean;
}

/**
 * Resolve the centered stage (and optional situational rail) for a terminal size.
 *
 * - Narrow / short profiles keep a full-bleed stack.
 * - Wider terminals cap the stage at {@link STAGE_MAX_WIDTH} and center it.
 * - Tall terminals cap the stage at {@link STAGE_MAX_HEIGHT} and center it.
 * - A right rail opens on `wide`/`ultrawide` terminals with at least
 *   {@link RAIL_MIN_COLS} columns when content exists; the stage narrows so
 *   the fixed-width rail always fits. Below that threshold, or without rail
 *   content, panels stay in the vertical stack.
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

  // A shell-aware workspace center band replaces the legacy edge-subtraction
  // below: it already excludes dock widths, dock gaps, and shell inset, so
  // docks are no longer assumed to sit flush against the terminal edges.
  const workspaceCenter = input.workspaceCenter;
  const originX = workspaceCenter ? Math.max(0, Math.floor(workspaceCenter.x)) : 0;
  const originY = workspaceCenter ? Math.max(0, Math.floor(workspaceCenter.y)) : 0;
  // Workspace docks consume horizontal space from the edges inward.
  const leftDockW = workspaceCenter ? 0 : input.leftDockWidth ?? 0;
  const rightDockW = workspaceCenter ? 0 : input.rightDockWidth ?? 0;
  const availableCols = workspaceCenter
    ? Math.max(0, Math.floor(workspaceCenter.width))
    : Math.max(0, cols - leftDockW - rightDockW);
  const bandRows = workspaceCenter ? Math.max(0, Math.floor(workspaceCenter.height)) : rows;

  // Only wide+ terminals get a capped, centered reading column. Narrower
  // profiles stay full-bleed so small windows do not lose horizontal space.
  // Bento shell mode always full-bleeds — the grid owns composition, not a
  // floating reading column with letterbox sky.
  const fullBleed = input.fullBleed === true || workspaceCenter !== undefined;
  const railEligible = profile === 'wide' || profile === 'ultrawide';
  // Full-bleed / workspace-center bands are already dock-shrunk — require only
  // enough room for a usable transcript column + rail, not the raw 120-col
  // terminal threshold (which would never open beside docks). When the center
  // is too tight for the full rail, fall back to a compact rail width.
  const standardRailBudget = STAGE_RAIL_GAP + RAIL_WIDTH + 40;
  // Shell-bento center is a few cols tighter than the raw workspace center —
  // keep the compact floor at docked ~140×40 (≈58 cols) so Context still opens.
  const compactRailBudget = STAGE_RAIL_GAP + COMPACT_RAIL_WIDTH + 28;
  const railWidth =
    fullBleed && availableCols < standardRailBudget && availableCols >= compactRailBudget
      ? COMPACT_RAIL_WIDTH
      : RAIL_WIDTH;
  const railMinCols = fullBleed
    ? railWidth === COMPACT_RAIL_WIDTH
      ? compactRailBudget
      : standardRailBudget
    : RAIL_MIN_COLS;
  const wantsRail = input.hasRailContent && railEligible && availableCols >= railMinCols;
  // Once the rail opens, narrow the stage so the fixed-width rail always
  // fits; stack mode keeps the capped reading column (unless full-bleed).
  const stageWidth = fullBleed
    ? wantsRail
      ? Math.max(1, availableCols - (STAGE_RAIL_GAP + railWidth))
      : availableCols
    : wantsRail
      ? Math.min(STAGE_MAX_WIDTH, availableCols - (STAGE_RAIL_GAP + railWidth))
      : railEligible
        ? Math.min(availableCols, STAGE_MAX_WIDTH)
        : availableCols;
  const stageHeight = fullBleed
    ? Number.isFinite(bandRows)
      ? bandRows
      : STAGE_MAX_HEIGHT
    : Number.isFinite(bandRows)
      ? Math.min(bandRows, STAGE_MAX_HEIGHT)
      : STAGE_MAX_HEIGHT;
  const railBundle = stageWidth + STAGE_RAIL_GAP + railWidth;
  const mode: StageLayoutMode = wantsRail && railBundle <= availableCols ? 'rail' : 'stack';
  const bundleWidth = mode === 'rail' ? railBundle : stageWidth;
  const bundleHeight = stageHeight;
  // Center the bundle within the available band (between docks, or inside
  // the workspace center rect).
  const xOffset =
    originX + leftDockW + (availableCols > bundleWidth ? Math.floor((availableCols - bundleWidth) / 2) : 0);
  const y =
    originY +
    (Number.isFinite(bandRows) && bandRows > bundleHeight
      ? Math.floor((bandRows - bundleHeight) / 2)
      : 0);

  // Build dock bands
  const leftDock: StageBand | undefined = leftDockW > 0
    ? { x: 0, y: 0, width: leftDockW, height: Number.isFinite(rows) ? rows : stageHeight }
    : undefined;
  const rightDock: StageBand | undefined = rightDockW > 0
    ? { x: cols - rightDockW, y: 0, width: rightDockW, height: Number.isFinite(rows) ? rows : stageHeight }
    : undefined;

  if (mode === 'rail') {
    return {
      profile,
      mode,
      stage: { x: xOffset, y, width: stageWidth, height: stageHeight },
      rail: {
        x: xOffset + stageWidth + STAGE_RAIL_GAP,
        y,
        width: railWidth,
        height: stageHeight,
      },
      leftDock,
      rightDock,
      bundleWidth,
      bundleHeight,
    };
  }

  return {
    profile,
    mode,
    stage: { x: xOffset, y, width: stageWidth, height: stageHeight },
    leftDock,
    rightDock,
    bundleWidth,
    bundleHeight,
  };
}
