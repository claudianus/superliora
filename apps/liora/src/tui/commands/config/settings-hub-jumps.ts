/**
 * Command Hub One-search entries that jump straight into a Settings pane.
 * Everyday panes stay visible (grouped by Settings section); the rest appear when you type.
 */

import type { CommandHubItem } from '../../components/dialogs/command-hub/command-hub-types';
import {
  HUB_PINNED_SETTINGS,
  SETTINGS_OPTIONS_BASE,
  type SettingsSelection,
} from '../../components/dialogs/picker/settings-selector';

import { SETTINGS_SEARCH_KEYWORDS } from './settings-keywords';

const PINNED = new Set<string>(HUB_PINNED_SETTINGS);

export function buildSettingsJumpHubItems(): CommandHubItem[] {
  const browse: CommandHubItem = {
    id: 'settings.open',
    sectionKey: 'tui.hub.section.settings',
    labelKey: 'tui.hub.settings.all.label',
    descriptionKey: 'tui.hub.settings.all.desc',
    section: '',
    label: '',
    description: '',
    keywords: ['settings', 'preferences', 'config', 'customize'],
  };
  const panes = SETTINGS_OPTIONS_BASE.map((option) =>
    settingsJumpHubItem(option.value, option),
  );
  const pinned = panes.filter((item) => !item.searchOnly);
  const rest = panes.filter((item) => item.searchOnly === true);
  return [browse, ...pinned, ...rest];
}

function settingsJumpHubItem(
  selection: SettingsSelection,
  option: {
    readonly labelKey: string;
    readonly descriptionKey: string;
    readonly sectionKey: string;
  },
): CommandHubItem {
  const pinned = PINNED.has(selection);
  const groupKey = option.sectionKey;
  return {
    id: `settings.${selection}`,
    sectionKey: 'tui.hub.section.settings',
    labelKey: option.labelKey,
    descriptionKey: option.descriptionKey,
    section: '',
    label: '',
    description: '',
    searchOnly: !pinned,
    keywords: [
      ...(SETTINGS_SEARCH_KEYWORDS[selection] ?? []),
      groupKey,
      'settings',
    ],
  };
}
