import { afterEach, describe, expect, it } from 'vitest';

import { setExperimentalFeatures } from '#/tui/commands/experimental-flags';
import { buildDefaultCommandHubItems } from '#/tui/components/dialogs/command-hub/command-hub-items';
import { CONDUCTOR_PROJECT_MODE_POOL } from '#/tui/utils/job/intent-brief';

describe('reduce parallelism Hub action', () => {
  afterEach(() => {
    setExperimentalFeatures([]);
  });

  it('adds Reduce parallelism when conductor_ux_v2 is on', () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: true }]);
    const items = buildDefaultCommandHubItems({ conductorProjectMode: 'balanced' });
    const row = items.find((item) => item.id === 'modes.reduceParallelism');
    expect(row?.label).toBe('Reduce parallelism');
    expect(row?.description.toLowerCase()).toMatch(/hotfix/);
    expect(CONDUCTOR_PROJECT_MODE_POOL.hotfix).toBe(2);
  });

  it('hides Reduce parallelism when flag is off', () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: false }]);
    const items = buildDefaultCommandHubItems({});
    expect(items.some((item) => item.id === 'modes.reduceParallelism')).toBe(false);
  });
});
