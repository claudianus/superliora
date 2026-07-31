export const CACHE_FREEZE_MID_TURN_TIP =
  'Mid-turn: CacheFreezeGuard locks tool prefix — setActiveTools rejected until turn ends';

/** Live CacheFreezeGuard line when status exposes cacheFrozen (Settings + Ops). */
export function formatCacheFreezeLine(cacheFrozen: boolean | undefined): string | undefined {
  if (cacheFrozen === undefined) return undefined;
  return cacheFrozen ? 'Freeze: active (mid-turn)' : 'Freeze: idle';
}

/** Ops Runtime Health line from getStatus.cacheFrozen; null when facet is not wired. */
export function formatCacheFreezeOpsHealthLine(
  cacheFrozen: boolean | undefined,
): string | null {
  const line = formatCacheFreezeLine(cacheFrozen);
  return line ?? null;
}
