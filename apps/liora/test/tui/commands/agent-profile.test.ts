import { describe, expect, it, vi } from 'vitest';

import { handleProfileCommand } from '#/tui/commands/config/harness/agent-profile';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

function makeHost() {
  return {
    showError: vi.fn(),
    showNotice: vi.fn(),
    harness: {
      getConfig: vi.fn(async () => ({})),
      setConfig: vi.fn(async () => undefined),
    },
  } as unknown as SlashCommandHost;
}

describe('handleProfileCommand', () => {
  it('surfaces Core waist in /profile help', async () => {
    const host = makeHost();
    await handleProfileCommand(host, 'help');
    const notice = String((host.showNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
    expect(notice).toContain('/profile');
    expect(notice).toContain('Core≤12 is the product waist');
  });
});
