import { describe, expect, it, vi } from 'vitest';

import { showFleetStatus } from '#/tui/commands/ops/fleet-status';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme } from '#/tui/theme';

function makeHost() {
  const session = {
    getStatus: vi.fn(async () => ({
      planMode: false,
      swarmMode: false,
      model: 'kimi-model',
      thinkingLevel: 'off',
      permission: 'auto',
    })),
  };
  const host = {
    state: {
      appState: {
        model: 'kimi-model',
        workDir: process.cwd(),
        permissionMode: 'auto',
        planMode: false,
        swarmMode: false,
        runtimeDegraded: undefined,
        lastModelRouteNotice: undefined,
        availableModels: {
          'kimi-model': { provider: 'kimi' },
        },
      },
      theme: currentTheme,
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
    },
    session,
    requireSession: () => session,
    harness: {
      listSessions: vi.fn(async () => [{ id: 'ses-1' }]),
    },
    motionBeats: { play: vi.fn() },
    showError: vi.fn(),
  } as unknown as SlashCommandHost;
  return host;
}

describe('showFleetStatus', () => {
  it('empty /fleet glance mentions Mission/Fleet, not Ultra*', async () => {
    const host = makeHost();
    await showFleetStatus(host);

    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    expect(panel).toBeInstanceOf(UsagePanelComponent);
    const lines = panel.render(80);
    const text = lines.join('\n');
    expect(text).toContain('Mission/Fleet');
    expect(text).toContain('not Ultra*');
    expect(text).not.toMatch(/UltraSwarm|Ultrawork/i);
    expect(text).toContain('/mission');
  });
});
