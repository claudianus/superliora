/**
 * In-session Command Hub recency + frequency for Spotlight-style ranking.
 */

const MAX_RECENTS = 24;
const recentIds: string[] = [];
const useCounts = new Map<string, number>();

export function noteHubActionUse(id: string): void {
  const trimmed = id.trim();
  if (trimmed.length === 0) return;
  useCounts.set(trimmed, (useCounts.get(trimmed) ?? 0) + 1);
  const without = recentIds.filter((entry) => entry !== trimmed);
  without.unshift(trimmed);
  recentIds.length = 0;
  recentIds.push(...without.slice(0, MAX_RECENTS));
}

export function hubRecencyScore(id: string): number {
  const index = recentIds.indexOf(id);
  const recency = index === -1 ? 0 : Math.max(0, 12 - index);
  const frequency = Math.min(8, useCounts.get(id) ?? 0);
  return recency * 3 + frequency;
}

export function listRecentHubActionIds(): readonly string[] {
  return [...recentIds];
}

/** Test helper — clear session memory. */
export function resetHubRecentsForTests(): void {
  recentIds.length = 0;
  useCounts.clear();
}
