import { describe, expect, it } from 'vitest';

import {
  hubCategories,
  hubItemsInCategory,
  hubPreferTwoPane,
} from '#/tui/components/dialogs/command-hub/command-hub-panes';
import type { CommandHubItem } from '#/tui/components/dialogs/command-hub/command-hub-types';
import { CENTER_MODAL_MAX_WIDTH } from '#/tui/utils/ui/center-modal';

describe('hub panes', () => {
  const items: CommandHubItem[] = [
    { id: 'modes.plan', section: 'Modes', label: 'Plan', description: '' },
    { id: 'modes.swarm', section: 'Modes', label: 'Swarm', description: '' },
    { id: 'start.new', section: 'Start', label: 'New', description: '' },
  ];

  it('lists unique categories in order', () => {
    expect(hubCategories(items)).toEqual(['Modes', 'Start']);
  });

  it('filters items by category', () => {
    expect(hubItemsInCategory(items, 'Modes').map((i) => i.id)).toEqual([
      'modes.plan',
      'modes.swarm',
    ]);
  });

  it('prefers two-pane when idle and wide', () => {
    expect(hubPreferTwoPane('', 80)).toBe(true);
    expect(hubPreferTwoPane('m', 80)).toBe(false);
    expect(hubPreferTwoPane('', 40)).toBe(false);
  });
});

describe('center modal width', () => {
  it('allows wide Hub/Settings up to 120 cols', () => {
    expect(CENTER_MODAL_MAX_WIDTH).toBe(120);
  });
});
