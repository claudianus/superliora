/**
 * Shared hover settle state for chrome list rows (Worker Dock, Command Hub).
 * Tracks the active region id + when the pointer entered so paint can flash
 * then rest without raw timers (PREMIUM.md §7 — appearance clock only).
 */

export type HoverRegionId = string;

export interface HoverRegionState {
  readonly regionId: HoverRegionId | undefined;
  readonly enteredAtMs: number;
}

let hoverState: HoverRegionState = { regionId: undefined, enteredAtMs: 0 };

/** Current hover region (undefined = none). */
export function getHoverRegionId(): HoverRegionId | undefined {
  return hoverState.regionId;
}

/** Wall time when the current hover region was entered (0 when none). */
export function getHoverEnteredAtMs(): number {
  return hoverState.enteredAtMs;
}

/**
 * Set the active hover region. Returns true when the id changed so callers
 * can request a content repaint. `nowMs` is the appearance / Date.now clock.
 */
export function setHoverRegion(
  regionId: HoverRegionId | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (hoverState.regionId === regionId) return false;
  hoverState =
    regionId === undefined
      ? { regionId: undefined, enteredAtMs: 0 }
      : { regionId, enteredAtMs: nowMs };
  return true;
}

/** Clear hover without a repaint decision helper. */
export function clearHoverRegion(): boolean {
  return setHoverRegion(undefined, 0);
}

/** Dock / list row region ids. */
export function missionWorkerHoverId(workerId: string): HoverRegionId {
  return `mc:worker:${workerId}`;
}

export function chromeHeaderHoverId(band: 'todo' | 'mission'): HoverRegionId {
  return `chrome:hdr:${band}`;
}

export function hubRowHoverId(index: number): HoverRegionId {
  return `hub:row:${index}`;
}

/** True when `regionId` is the active hover target. */
export function isHoverRegion(regionId: HoverRegionId): boolean {
  return hoverState.regionId === regionId;
}
