import { ttui } from '#/tui/utils/tui-i18n';

import type { CommandHubItem } from './command-hub-types';

/** Resolved display strings for a hub row (locale applied at call time). */
export interface ResolvedCommandHubItem extends CommandHubItem {
  readonly label: string;
  readonly description: string;
  readonly section: string;
}

export function resolveHubItem(item: CommandHubItem): ResolvedCommandHubItem {
  return {
    ...item,
    label: item.labelKey !== undefined ? ttui(item.labelKey) : item.label,
    description:
      item.descriptionKey !== undefined ? ttui(item.descriptionKey) : item.description,
    section: item.sectionKey !== undefined ? ttui(item.sectionKey) : item.section,
  };
}

/** Map hub section keys to idle-list order (stable across locales). */
export const HUB_SECTION_ORDER_KEYS = [
  'tui.hub.section.now',
  'tui.hub.section.recent',
  'tui.hub.section.modes',
  'tui.hub.section.start',
  'tui.hub.section.chat',
  'tui.hub.section.workspace',
  'tui.hub.section.extend',
  'tui.hub.section.appearance',
  'tui.hub.section.account',
  'tui.hub.section.settings',
  'tui.hub.section.commands',
  'tui.hub.section.skills',
  'tui.hub.section.help',
] as const;
