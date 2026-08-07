export const COMMAND_HUB_PAGE_SIZE = 8;

/** Entry scale-in settles fast — the list must be readable almost at once. */
export const HUB_ENTRY_MS = 240;
export const HUB_ENTRY_MIN_RATIO = 0.92;
/**
 * Cap the floating box so it hugs the palette instead of stretching to the
 * full center-modal ceiling (120). Long model badges still fit; wider
 * terminals just get more side margin.
 */
export const HUB_MAX_BOX_WIDTH = 92;
/** Pointer slide-in after a selection move. */
export const HUB_SLIDE_MS = 140;

export function hubClamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

export function hubEaseOutCubic(t: number): number {
  const c = hubClamp01(t);
  return 1 - Math.pow(1 - c, 3);
}
