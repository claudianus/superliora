import { describe, expect, it } from 'vitest';

import { filterHubItems } from '#/tui/components/dialogs/command-hub/command-hub-filter';
import { buildDefaultCommandHubItems } from '#/tui/components/dialogs/command-hub/index';
import { commandHubNestsPicker } from '#/tui/components/dialogs/command-hub/command-hub-behavior';
import { commandHubActionToSlash } from '#/tui/utils/command/command-hub-actions';
import {
  buildSettingsJumpHubItems,
  buildSettingsJumpPaletteEntries,
} from '#/tui/commands/config/settings-hub-jumps';
import { SETTINGS_SEARCH_KEYWORDS } from '#/tui/commands/config/settings-keywords';
import { SETTINGS_OPTIONS } from '#/tui/components/dialogs/picker/settings-selector';

describe('SETTINGS_SEARCH_KEYWORDS', () => {
  it('covers every SettingsSelection value', () => {
    for (const option of SETTINGS_OPTIONS) {
      expect(SETTINGS_SEARCH_KEYWORDS).toHaveProperty(option.value);
    }
  });

  it('includes operator aliases for cache, index, security, and search', () => {
    expect(SETTINGS_SEARCH_KEYWORDS.cache).toContain('freeze');
    expect(SETTINGS_SEARCH_KEYWORDS.index).toContain('fts');
    expect(SETTINGS_SEARCH_KEYWORDS.security).toContain('redaction');
    expect(SETTINGS_SEARCH_KEYWORDS.search).toContain('ddg');
  });
});

describe('buildSettingsJumpHubItems', () => {
  it('includes browse-all and search-only pane jumps', () => {
    const items = buildSettingsJumpHubItems();
    expect(items[0]?.id).toBe('settings.open');
    expect(items.some((item) => item.id === 'settings.cache' && item.searchOnly === true)).toBe(
      true,
    );
    expect(items.some((item) => item.id === 'settings.search' && item.keywords?.includes('ddg'))).toBe(
      true,
    );
  });

  it('surfaces cache when Hub filter query is freeze', () => {
    const items = buildDefaultCommandHubItems({});
    const matched = filterHubItems(items, 'freeze');
    expect(matched.some((item) => item.id === 'settings.cache')).toBe(true);
    expect(matched.some((item) => item.id === 'settings.open')).toBe(true);
  });

  it('maps settings hub ids for slash and nested picker behavior', () => {
    expect(commandHubActionToSlash('settings.open')).toBe('/settings');
    expect(commandHubActionToSlash('settings.cache')).toBeUndefined();
    expect(commandHubNestsPicker('settings.security')).toBe(true);
  });
});

describe('buildSettingsJumpPaletteEntries', () => {
  it('builds palette rows with keyword aliases', () => {
    const entries = buildSettingsJumpPaletteEntries();
    const cache = entries.find((entry) => entry.value === 'settings:cache');
    expect(cache?.label).toContain('Cache');
    expect(cache?.aliases).toContain('freeze');
    const search = entries.find((entry) => entry.value === 'settings:search');
    expect(search?.aliases).toContain('ddg');
  });
});
