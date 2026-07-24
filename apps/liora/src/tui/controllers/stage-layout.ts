import {
  resolveResponsiveLayout,
  type ResponsiveLayoutProfile,
} from './responsive-layout';

/** Max reading-column width for the centered stage (cols). */
export const STAGE_MAX_WIDTH = 90;

/**
 * Max stage height on wide terminals (rows) — the reading cap.
 * Tall / portrait terminals ignore the cap and use their full height so a
 * vertically long window is not letterboxed into a small centered band.
 */
export const STAGE_MAX_HEIGHT = 60;

export interface StageBand {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface StageLayout {
  readonly profile: ResponsiveLayoutProfile;
  readonly stage: StageBand;
  /** Left workspace dock (file explorer, etc.). */
  readonly leftDock?: StageBand;
  /** Right workspace dock (terminal, etc.). */
  readonly rightDock?: StageBand;
  /** Width of the centered bundle (the stage column). */
  readonly bundleWidth: number;
  /** Height of the centered stage band. */
  readonly bundleHeight: number;
}

export interface ResolveStageLayoutInput {
  readonly width: number;
  readonly height?: number;
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
}

/**
 * Resolve the centered stage for a terminal size.
 *
 * - Narrow / short profiles keep a full-bleed stack.
 * - Wider terminals cap the stage at {@link STAGE_MAX_WIDTH} and center it.
 * - Tall / portrait terminals (rows ≥ available cols) use the full terminal
 *   height; wider terminals cap the stage at {@link STAGE_MAX_HEIGHT} and
 *   center it vertically. Situational panels (todo / activity / queue / btw)
 *   always render in the vertical stack inside the stage column.
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
  const cappedWidth = profile === 'wide' || profile === 'ultrawide';
  const stageWidth = cappedWidth
    ? Math.min(availableCols, STAGE_MAX_WIDTH)
    : availableCols;
  // Tall / portrait terminals use the full height — letterboxing a vertically
  // long window wastes most of the screen. Wider terminals keep the reading
  // cap so the transcript does not stretch into an overlong column.
  const stageHeight = !Number.isFinite(bandRows)
    ? STAGE_MAX_HEIGHT
    : bandRows >= availableCols
      ? bandRows
      : Math.min(bandRows, STAGE_MAX_HEIGHT);
  const bundleWidth = stageWidth;
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

  return {
    profile,
    stage: { x: xOffset, y, width: stageWidth, height: stageHeight },
    leftDock,
    rightDock,
    bundleWidth,
    bundleHeight,
  };
}
