/**
 * Idle Command Hub two-pane helpers — categories (left) + section items (right).
 */

import type { CommandHubItem } from './command-hub-types';

/** Unique section labels in first-seen order (idle filtered list). */
export function hubCategories(items: readonly CommandHubItem[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item.section)) continue;
    seen.add(item.section);
    out.push(item.section);
  }
  return out;
}

export function hubItemsInCategory(
  items: readonly CommandHubItem[],
  category: string,
): CommandHubItem[] {
  return items.filter((item) => item.section === category);
}

/** Prefer wide two-pane when idle and the modal is wide enough. */
export function hubPreferTwoPane(query: string, width: number): boolean {
  return query.length === 0 && width >= 64;
}

export const HUB_CATEGORY_COL_WIDTH = 18;
