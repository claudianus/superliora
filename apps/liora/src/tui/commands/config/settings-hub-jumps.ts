/**
 * Command Hub One-search entries that jump straight into a Settings pane.
 * Everyday panes stay visible; the rest appear when you type.
 */

import type { CommandHubItem } from '../../components/dialogs/command-hub/command-hub-types';
import {
  HUB_PINNED_SETTINGS,
  SETTINGS_OPTIONS,
  type SettingsSelection,
} from '../../components/dialogs/picker/settings-selector';

import { SETTINGS_SEARCH_KEYWORDS } from './settings-keywords';

const PINNED = new Set<string>(HUB_PINNED_SETTINGS);

export function buildSettingsJumpHubItems(): CommandHubItem[] {
  const browse: CommandHubItem = {
    id: 'settings.open',
    section: 'Settings',
    label: 'All settings',
    description: 'Browse every pane · type to search freeze, DDG, FTS, redaction…',
    keywords: ['settings', 'preferences', 'config', 'customize'],
  };
  const panes = SETTINGS_OPTIONS.map((option) =>
    settingsJumpHubItem(option.value as SettingsSelection, option),
  );
  // Pinned first (stable practical order), then search-only power panes.
  const pinned = panes.filter((item) => !item.searchOnly);
  const rest = panes.filter((item) => item.searchOnly === true);
  return [browse, ...pinned, ...rest];
}

function settingsJumpHubItem(
  selection: SettingsSelection,
  option: {
    readonly label: string;
    readonly description?: string;
    readonly section?: string;
  },
): CommandHubItem {
  const pinned = PINNED.has(selection);
  return {
    id: `settings.${selection}`,
    section: pinned ? 'Settings' : 'Settings · more',
    label: option.label,
    description: option.description ?? '',
    searchOnly: !pinned,
    keywords: [
      ...(SETTINGS_SEARCH_KEYWORDS[selection] ?? []),
      ...(option.section !== undefined ? [option.section] : []),
    ],
  };
}
