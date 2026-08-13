/** Clamp page-scroll progress to [0, 1]. */
export function clampScrollProgress(
  scrollY: number,
  scrollHeight: number,
  innerHeight: number,
): number {
  const max = scrollHeight - innerHeight;
  if (!(max > 0) || !Number.isFinite(scrollY)) return 0;
  if (scrollY <= 0) return 0;
  if (scrollY >= max) return 1;
  return scrollY / max;
}

/** True when decorative motion/hover/reward effects may run. */
export function motionEnabled(prefersReducedMotion: boolean): boolean {
  return prefersReducedMotion !== true;
}
