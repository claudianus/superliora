import { describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { handleAgentsCommand } from '#/tui/commands/agents';
import { setExperimentalFeatures } from '#/tui/commands/experimental-flags';
import type { WorkerDockMode } from '#/tui/features/worker-dock/dock';

const { saveTuiConfigMock } = vi.hoisted(() => ({ saveTuiConfigMock: vi.fn() }));
vi.mock('../../../src/tui/config', async () => {
  const actual = await vi.importActual<typeof import('../../../src/tui/config.js')>(
    '../../../src/tui/config.js',
  );
  return { ...actual, saveTuiConfig: saveTuiConfigMock };
});

function createHost(mode: WorkerDockMode) {
  return {
    showStatus: vi.fn(),
    workerDock: {
      mode: vi.fn(() => mode),
      setMode: vi.fn(),
    },
    state: {
      appState: {
        theme: 'dark',
        permissionMode: 'auto',
        editorCommand: null,
        notifications: {},
        upgrade: {},
        appearance: {
          workerDock: mode,
        },
      },
    },
  } as unknown as SlashCommandHost & {
    showStatus: ReturnType<typeof vi.fn>;
    workerDock: {
      mode: ReturnType<typeof vi.fn>;
      setMode: ReturnType<typeof vi.fn>;
    };
  };
}

describe('/agents', () => {
  it('cycles auto → pinned → hidden → auto and persists', async () => {
    setExperimentalFeatures([{ id: 'conductor_ux_v2', enabled: true }]);
    saveTuiConfigMock.mockClear();
    const host = createHost('auto');
    await handleAgentsCommand(host, '');
    expect(host.workerDock.setMode).toHaveBeenCalledWith('pinned');
    expect(saveTuiConfigMock).toHaveBeenCalledTimes(1);
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('Worker Dock:'),
      'success',
    );

    const host2 = createHost('pinned');
    await handleAgentsCommand(host2, '');
    expect(host2.workerDock.setMode).toHaveBeenCalledWith('hidden');

    const host3 = createHost('hidden');
    await handleAgentsCommand(host3, '');
    expect(host3.workerDock.setMode).toHaveBeenCalledWith('auto');
  });

  it('accepts an explicit mode', async () => {
    saveTuiConfigMock.mockClear();
    const host = createHost('auto');
    await handleAgentsCommand(host, 'hidden');
    expect(host.workerDock.setMode).toHaveBeenCalledWith('hidden');
  });

  it('rejects unknown args with usage', async () => {
    const host = createHost('auto');
    await handleAgentsCommand(host, 'banana');
    expect(host.workerDock.setMode).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('Usage: /jobs dock'),
      'textMuted',
    );
  });
});
