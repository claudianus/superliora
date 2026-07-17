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
 * - pure animation-only frames may force/clear the surface for ambient VFX
 *   without coupling that decision to cursor re-emit.
 *
 * Always true while the editor caret is live: skipping CUP lets the
 * terminal cursor drift to the last painted cell (often footer).
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
    structuralShift ||
    options.ambientAnimation === true
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
  const force = shouldForceTUIStateNativeLayoutFrame(input.causes, input.structuralShift, {
    ambientAnimation: ambientAnimationFrame,
    viewportScrolled: input.viewportScrolled,
  });
  // Any authoritative redraw clears the terminal surface; re-apply OSC palette
  // colors first so default-fg cells and indexed colors stay on-theme. Animation
  // frames force redraws too, and skipping palette refresh there was dropping
  // theme colors once agent work started and ambient ticks ramped up.
  const refreshTerminalPalette = force;
  const clearTranscriptSelection =
    input.priorTranscriptStart !== undefined &&
    input.priorTranscriptStart !== input.nextTranscriptStart;
  return {
    force,
    clear: force,
    refreshTerminalPalette,
    clearTranscriptSelection,
  };
}
