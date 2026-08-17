import type { NativeRenderCause } from '#/tui/renderer';

export type FrameInvalidationIntent =
  | 'content'
  | 'layout'
  | 'palette'
  | 'animation'
  | 'scroll';

export function frameInvalidationIntentToCause(intent: FrameInvalidationIntent): NativeRenderCause {
  switch (intent) {
    case 'layout':
    case 'palette':
      return 'manual';
    case 'animation':
      return 'animation';
    case 'scroll':
      return 'transcript-scroll';
    case 'content':
      return 'request';
  }
}

/**
 * Causes that may ride along with a pure transcript scroll without forcing a
 * full clear/repaint. Ambient animation ticks frequently coalesce with wheel
 * scroll; treating that as "content force" caused clear→rewrite background
 * flicker on the stage/letterbox.
 */
const SCROLL_COMPATIBLE_CAUSES = new Set<NativeRenderCause>([
  'transcript-scroll',
  'animation',
]);

/**
 * True when this frame only moves the transcript viewport (optionally with an
 * ambient animation tick). No structural geometry change, no content append.
 */
export function isPureTranscriptScrollFrame(
  causes: readonly NativeRenderCause[],
  viewportScrolled: boolean,
  structuralShift: boolean,
): boolean {
  return (
    viewportScrolled &&
    !structuralShift &&
    causes.length > 0 &&
    causes.every((cause) => SCROLL_COMPATIBLE_CAUSES.has(cause)) &&
    causes.includes('transcript-scroll')
  );
}

/**
 * Ambient animation ticks frequently coalesce with keystrokes. Treat them as
 * pure-input-compatible so chrome reuse and damage-only paint stay on (same
 * idea as SCROLL_COMPATIBLE_CAUSES for wheel frames).
 */
const INPUT_COMPATIBLE_CAUSES = new Set<NativeRenderCause>([
  'input',
  'animation',
]);

/**
 * Pure keystroke frames only rewrite the editor surface. Layout has not
 * scrolled and chrome geometry is stable, so header/footer/queue can be
 * reused and Ultrawork perimeter paint can be skipped.
 *
 * Ambient animation may ride along without forcing a structural clear —
 * otherwise every input+animation coalesce flipped region.clear and tore
 * prompt/letterbox cells (display-only char loss with buffer still intact).
 */
export function isPureInputFrame(
  causes: readonly NativeRenderCause[],
  structuralShift: boolean,
  viewportScrolled: boolean,
): boolean {
  return (
    causes.length > 0 &&
    causes.every((cause) => INPUT_COMPATIBLE_CAUSES.has(cause)) &&
    causes.includes('input') &&
    !structuralShift &&
    !viewportScrolled
  );
}

/**
 * Whether chrome (header/footer/todo/queue/btw/activity) lines may be reused
 * from the previous frame instead of re-rendering containers.
 *
 * - Pure keystroke frames always reuse when geometry/epoch match.
 * - Idle chrome with no live goal is static → animation ticks may reuse.
 * - Live goals keep wall-clock / status pulse dynamic → do not treat as static.
 * - Explicit content/manual requests (`request` / `manual`) always rebuild so
 *   footer goal-timer ticks and setAppState patches are not trapped by cache.
 */
export function shouldReuseTUIChromeCache(options: {
  readonly hasCache: boolean;
  readonly widthMatches: boolean;
  readonly stageWidthMatches: boolean;
  readonly epochMatches: boolean;
  readonly pureInputFrame: boolean;
  /**
   * Pure transcript scroll: chrome geometry and epoch are stable; only the
   * transcript viewport moved. Reuse header/footer/panels so scroll does not
   * rebuild the chrome tree every wheel tick.
   */
  readonly pureScrollFrame?: boolean;
  readonly chromeStatic: boolean;
  readonly causes: readonly NativeRenderCause[];
}): boolean {
  if (!options.hasCache || !options.widthMatches || !options.stageWidthMatches) {
    return false;
  }
  if (!options.epochMatches) return false;
  if (options.causes.includes('request') || options.causes.includes('manual')) {
    return false;
  }
  return (
    options.pureInputFrame ||
    options.pureScrollFrame === true ||
    options.chromeStatic
  );
}

/** Activity + live-goal signature used to invalidate chrome cache. */
export function tuiChromeEpoch(options: {
  readonly streamingPhase: string;
  readonly thinking: boolean;
  readonly liveGoalId?: string;
  readonly liveGoalStatus?: string;
}): string {
  const goalPart =
    options.liveGoalId !== undefined && options.liveGoalStatus !== undefined
      ? `${options.liveGoalId}|${options.liveGoalStatus}`
      : '';
  return `${options.streamingPhase}|${options.thinking ? 1 : 0}|${goalPart}`;
}

export function isLiveGoalChromeActive(
  goal: { readonly status: string } | null | undefined,
): boolean {
  return (
    goal !== null &&
    goal !== undefined &&
    (goal.status === 'active' || goal.status === 'paused' || goal.status === 'blocked')
  );
}

/**
 * Whether present() must re-emit CUP (cursor position).
 *
 * Independent of force/clear:
 * - pure-input frames keep force=false (incremental damage) but still need
 *   forceCursor so OS IME (e.g. hangul preedit) stays on the caret;
 * - pure animation-only frames stay damage-only (force=false) and never
 *   couple that decision to cursor re-emit.
 *
 * Always true while the editor caret is live: skipping CUP lets the
 * terminal cursor drift to the last painted cell (often footer) and breaks
 * prompt IME positioning.
 */
export function shouldForceNativeCursor(
  _options: {
    readonly causes?: readonly NativeRenderCause[];
    readonly structuralShift?: boolean;
    readonly viewportScrolled?: boolean;
  } = {},
): boolean {
  return true;
}

export function shouldForceTUIStateNativeLayoutFrame(
  causes: readonly NativeRenderCause[],
  structuralShift: boolean,
  options: {
    readonly ambientAnimation?: boolean;
    readonly viewportScrolled?: boolean;
  } = {},
): boolean {
  if (
    isPureTranscriptScrollFrame(
      causes,
      options.viewportScrolled === true,
      structuralShift,
    )
  ) {
    return false;
  }

  // Pure keystroke frames must stay incremental — force/clear would repaint
  // the whole buffer and fight typing latency. forceCursor is separate.
  if (isPureInputFrame(causes, structuralShift, options.viewportScrolled === true)) {
    return false;
  }

  return (
    causes.includes('start') ||
    causes.includes('resize') ||
    causes.includes('manual') ||
    // Non-pure scroll (e.g. scroll + request content) still forces.
    causes.includes('transcript-scroll') ||
    structuralShift
  );
}

export function shouldRefreshNativeTerminalPalette(
  causes: readonly NativeRenderCause[],
  structuralShift: boolean,
  options: { readonly viewportScrolled?: boolean } = {},
): boolean {
  if (
    isPureTranscriptScrollFrame(
      causes,
      options.viewportScrolled === true,
      structuralShift,
    )
  ) {
    return false;
  }

  return (
    structuralShift ||
    causes.includes('start') ||
    causes.includes('resize') ||
    causes.includes('manual') ||
    causes.includes('transcript-scroll')
  );
}

export interface TUIStateNativeFramePolicyInput {
  readonly causes: readonly NativeRenderCause[];
  readonly viewportScrolled: boolean;
  readonly structuralShift: boolean;
  /** Editor-slot row change (prompt, replacement, unmount). Not a full-clear. */
  readonly geometryShift?: boolean;
  /** Transcript append-only growth — prefer damage-only (no full clear flash). */
  readonly contentGrew?: boolean;
  /** Transcript shrink. Region overwrite covers holes; not a full-clear. */
  readonly contentShrunk?: boolean;
  readonly priorTranscriptStart?: number;
  readonly nextTranscriptStart: number;
  readonly ambientAnimationAllowed: boolean;
}

export interface TUIStateNativeFramePolicy {
  readonly force: boolean;
  readonly clear: boolean;
  readonly refreshTerminalPalette: boolean;
  readonly clearTranscriptSelection: boolean;
}

export function resolveTUIStateNativeFramePolicy(
  input: TUIStateNativeFramePolicyInput,
): TUIStateNativeFramePolicy {
  const ambientAnimationFrame =
    input.causes.includes('animation') && input.ambientAnimationAllowed;
  const resizeFrame = input.causes.includes('resize');
  const pureScroll = isPureTranscriptScrollFrame(
    input.causes,
    input.viewportScrolled,
    input.structuralShift,
  );
  // Append-only transcript growth: still "force" present for correctness, but
  // never full-clear the buffer — that is the streaming background flicker.
  // Shrink / editor-slot geometry stay in this same no-full-clear family:
  // region overwrite covers leftover cells without a beginFrame wipe.
  const appendOnlyGrowth =
    input.contentGrew === true &&
    input.geometryShift !== true &&
    input.contentShrunk !== true;
  const shrinkOrGeometryShift =
    input.contentShrunk === true || input.geometryShift === true;
  const force = shouldForceTUIStateNativeLayoutFrame(input.causes, input.structuralShift, {
    ambientAnimation: ambientAnimationFrame,
    viewportScrolled: input.viewportScrolled,
  });
  // Animation ticks must not wipe the surface or re-blast OSC palette —
  // that flashes the terminal to black / default bg (the “black hole”
  // flicker). Pure ambient stays damage-only (force=false); clear stays
  // gated so structural force frames never clear on animation causes.
  // Resize is the exception: coalesce with animation must still clear so
  // soft buffers catch up after CSI wipe of the alternate screen.
  // Pure transcript scroll and append-only growth also never clear —
  // clear:true invalidates composition topology and blanks stage background.
  // Any viewport-only move (even when causes are not pure, e.g. scroll+request)
  // also stays clear:false when geometry is stable — fixed-height transcript
  // paint overwrites the window without a full-buffer wipe.
  const viewportOnlyScroll =
    input.viewportScrolled &&
    input.geometryShift !== true &&
    input.contentShrunk !== true &&
    (input.structuralShift === false || appendOnlyGrowth);
  const clear =
    force &&
    !pureScroll &&
    !appendOnlyGrowth &&
    !shrinkOrGeometryShift &&
    !viewportOnlyScroll &&
    (!ambientAnimationFrame || resizeFrame);
  const refreshTerminalPalette =
    force &&
    shouldRefreshNativeTerminalPalette(input.causes, input.structuralShift, {
      viewportScrolled: input.viewportScrolled,
    });
  const clearTranscriptSelection =
    input.priorTranscriptStart !== undefined &&
    input.priorTranscriptStart !== input.nextTranscriptStart;
  return {
    force,
    clear,
    refreshTerminalPalette,
    clearTranscriptSelection,
  };
}

/**
 * Whether stack regions should skip clear-fills (damage-only paint).
 *
 * Every cause except resize stays damage-only. Request/manual ticks
 * (footer, thinking, tool) used to return false, set region.clear, and
 * fillRect the whole stack before rewrite — the remaining ConPTY black
 * band. Topology changes still beginFrame-clear via the composition cache
 * miss; holes are sealed with canvas background after compose.
 */
export function shouldUseAmbientDamageOnlyPaint(input: {
  readonly structuralShift: boolean;
  readonly geometryShift?: boolean;
  readonly contentGrew?: boolean;
  readonly contentShrunk?: boolean;
  readonly viewportScrolled: boolean;
  readonly causes: readonly NativeRenderCause[];
  readonly ambientAnimationAllowed: boolean;
  readonly idleAquariumMounted: boolean;
  readonly fullscreenTakeover?: boolean;
}): boolean {
  return !input.causes.includes('resize');
}
