import { describe, expect, it } from 'vitest';

import {
  buildSlashJumpHubItems,
  isSlashHubActionId,
  slashNameFromHubId,
} from '#/tui/commands/hub/slash-hub-jumps';
import { filterHubItems } from '#/tui/components/dialogs/command-hub/command-hub-filter';
import { buildDefaultCommandHubItems } from '#/tui/components/dialogs/command-hub/index';
import { commandHubActionToSlash } from '#/tui/utils/command/command-hub-actions';

describe('slash hub jumps', () => {
  it('builds searchOnly slash and skill rows', () => {
    const items = buildSlashJumpHubItems(
      [
        { name: 'compact', description: 'Compact context', aliases: [] },
        { name: 'my-skill', description: 'A skill', aliases: ['ms'] },
      ],
      new Set(['my-skill']),
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'slash.compact',
      section: 'Commands',
      label: '/compact',
      searchOnly: true,
    });
    expect(items[1]).toMatchObject({
      id: 'slash.my-skill',
      section: 'Skills',
      searchOnly: true,
    });
    expect(isSlashHubActionId('slash.compact')).toBe(true);
    expect(slashNameFromHubId('slash.compact')).toBe('compact');
    expect(commandHubActionToSlash('slash.compact')).toBe('/compact');
  });

  it('surfaces slash rows via Hub fuzzy One-search', () => {
    const items = [
      ...buildDefaultCommandHubItems({}),
      ...buildSlashJumpHubItems([
        { name: 'compact', description: 'Compact context', aliases: [] },
      ]),
    ];
    expect(filterHubItems(items, '').some((item) => item.id === 'slash.compact')).toBe(false);
    const matched = filterHubItems(items, 'compct');
    expect(matched.some((item) => item.id === 'slash.compact')).toBe(true);
  });
});

