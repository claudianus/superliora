import { fuzzyFilter } from '#/tui/renderer';
import { hubRecencyScore, listRecentHubActionIds } from '#/tui/utils/command/hub-recents';

import type { CommandHubActionId, CommandHubItem } from './command-hub-types';

const SECTION_ORDER = [
  'Now',
  'Recent',
  'Modes',
  'Start',
  'Chat',
  'Workspace',
  'Extend',
  'Appearance',
  'Account',
  'Settings',
  'Commands',
  'Skills',
  'Help',
] as const;

function hubItemSearchText(item: CommandHubItem): string {
  return [
    item.label,
    item.description,
    item.section,
    item.id,
    ...(item.keywords ?? []),
  ].join(' ');
}

/**
 * One-search filter for the Command Hub.
 * Uses the same `fuzzyFilter` as Settings / SearchableList; recency breaks ties.
 */
export function filterHubItems(items: readonly CommandHubItem[], query: string): CommandHubItem[] {
  const needle = query.trim();
  if (needle.length > 0) {
    const matched = fuzzyFilter([...items], needle, hubItemSearchText);
    // Stable re-sort: recency first; preserve fuzzyFilter score order otherwise.
    matched.sort((a, b) => {
      const ra = hubRecencyScore(a.id);
      const rb = hubRecencyScore(b.id);
      if (ra !== rb) return rb - ra;
      return 0;
    });
    return matched;
  }

  // Idle: pin a Recent strip (deduped), then keep authoring order within sections.
  const byId = new Map(items.map((item) => [item.id, item]));
  const authoredIndex = new Map(items.map((item, index) => [item.id, index]));
  const recent: CommandHubItem[] = [];
  for (const id of listRecentHubActionIds()) {
    if (recent.length >= 3) break;
    const src = byId.get(id as CommandHubActionId);
    if (src === undefined) continue;
    // Skip mode toggles in Recent — they already live in the status strip / Modes.
    if (src.kind === 'toggle' || src.kind === 'cycle') continue;
    recent.push({ ...src, section: 'Recent' });
  }
  const recentIds = new Set(recent.map((item) => item.id));
  const rest = items
    .filter((item) => !recentIds.has(item.id) && item.searchOnly !== true)
    .toSorted((a, b) => {
      const sa = SECTION_ORDER.indexOf(a.section as (typeof SECTION_ORDER)[number]);
      const sb = SECTION_ORDER.indexOf(b.section as (typeof SECTION_ORDER)[number]);
      const oa = sa === -1 ? 99 : sa;
      const ob = sb === -1 ? 99 : sb;
      if (oa !== ob) return oa - ob;
      return (authoredIndex.get(a.id) ?? 0) - (authoredIndex.get(b.id) ?? 0);
    });
  return [...recent, ...rest];
}
