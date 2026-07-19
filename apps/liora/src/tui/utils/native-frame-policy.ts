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

export function isPureTranscriptScrollFrame(
  causes: readonly NativeRenderCause[],
  viewportScrolled: boolean,
  structuralShift: boolean,
): boolean {
  return (
    viewportScrolled &&
    !structuralShift &&
    causes.length === 1 &&
    causes[0] === 'transcript-scroll'
  );
}

/**
 * Pure keystroke frames only rewrite the editor surface. Layout has not
 * scrolled and chrome geometry is stable, so header/footer/queue can be
 * reused and Ultrawork perimeter paint can be skipped.
 */
export function isPureInputFrame(
  causes: readonly NativeRenderCause[],
  structuralShift: boolean,
  viewportScrolled: boolean,
): boolean {
  return (
    causes.length > 0 &&
    causes.every((cause) => cause === 'input') &&
    !structuralShift &&
    !viewportScrolled
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
  const clear = force && (!ambientAnimationFrame || resizeFrame);
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
 * Idle Jewel Tank + Welcome must stay damage-only even on request-only ticks
 * (thinking footer), otherwise clear:true rewrites the whole transcript every
 * status update and tears into black horizontal bands inside the stage.
 */
export function shouldUseAmbientDamageOnlyPaint(input: {
  readonly structuralShift: boolean;
  readonly viewportScrolled: boolean;
  readonly causes: readonly NativeRenderCause[];
  readonly ambientAnimationAllowed: boolean;
  readonly idleAquariumMounted: boolean;
  readonly fullscreenTakeover?: boolean;
}): boolean {
  if (input.structuralShift || input.viewportScrolled || input.causes.includes('resize')) {
    return false;
  }
  // Jewel Tank + Welcome must stay damage-only whenever the idle stage is
  // mounted — even if ambientAnimationAllowed is false (selection holdoff,
  // quality gate). Otherwise clear:true rewrites the transcript and tears
  // into black bands while letterbox particles keep animating.
  if (input.idleAquariumMounted) return true;
  if (!input.causes.includes('animation')) return false;
  return input.ambientAnimationAllowed || input.fullscreenTakeover === true;
}
