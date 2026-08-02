export const CACHE_FREEZE_MID_TURN_TIP =
  'Mid-turn: CacheFreezeGuard locks tool prefix — setActiveTools rejected; each step soft-checks tool list drift (logged, no throw).';

/** Live CacheFreezeGuard line when status exposes cacheFrozen (Settings + Ops). */
export function formatCacheFreezeLine(
  cacheFrozen: boolean | undefined,
  violations?: number | undefined,
): string | undefined {
  if (cacheFrozen === undefined && violations === undefined) return undefined;
  const base =
    cacheFrozen === true
      ? 'Freeze: active (mid-turn · step soft-check on)'
      : cacheFrozen === false
        ? 'Freeze: idle'
        : 'Freeze: (status unknown)';
  if (violations !== undefined && violations > 0) {
    return `${base} · drift×${String(violations)}`;
  }
  return cacheFrozen === undefined ? undefined : base;
}

/** Ops Runtime Health line from getStatus.cacheFrozen; null when facet is not wired. */
export function formatCacheFreezeOpsHealthLine(
  cacheFrozen: boolean | undefined,
  violations?: number | undefined,
): string | null {
  const line = formatCacheFreezeLine(cacheFrozen, violations);
  return line ?? null;
}
