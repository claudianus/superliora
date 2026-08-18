import { describe, expect, it, vi } from 'vitest';

import { showCommandHub } from '#/tui/controllers/dialogs/command-hub';
import { ttui } from '#/tui/utils/tui-i18n';

describe('showCommandHub', () => {
  it('explains why Hub stays closed over a workspace dialog', () => {
    const showStatus = vi.fn();
    showCommandHub(
      {
        state: { activeDialog: 'files' },
        showStatus,
      } as never,
      {} as never,
    );
    expect(showStatus).toHaveBeenCalledWith(ttui('tui.hub.dialogOpen'), 'info');
  });
});
