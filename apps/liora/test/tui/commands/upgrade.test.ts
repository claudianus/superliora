import { describe, expect, it, vi } from 'vitest';

import { SUPERLIORA_CHANGELOG_URL, type UpgradePlan } from '#/cli/update/plan';
import type { UpgradeInstallStage } from '#/cli/update/install-stages';
import { handleUpgradeCommand } from '#/tui/commands/upgrade';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { findBuiltInSlashCommand } from '#/tui/commands/registry';
import { UpgradeDialogComponent } from '#/tui/components/dialogs/upgrade-dialog';

const ESC = String.fromCodePoint(27);

function plan(overrides: Partial<UpgradePlan> = {}): UpgradePlan {
  return {
    source: 'npm-global',
    currentVersion: '0.4.0',
    target: { version: '0.5.0' },
    installCommand: 'npm install -g @superliora/liora@0.5.0',
    changelogUrl: SUPERLIORA_CHANGELOG_URL,
    dirty: false,
    canAutoInstall: true,
    reason: 'update-available',
    ...overrides,
  };
}

function createHost(overrides: Partial<SlashCommandHost> = {}): SlashCommandHost {
  return {
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
    track: vi.fn(),
    state: { appState: { version: '0.4.0' } },
    ...overrides,
  } as unknown as SlashCommandHost;
}

async function waitForDialog(host: SlashCommandHost): Promise<UpgradeDialogComponent> {
  const mount = host.mountEditorReplacement as ReturnType<typeof vi.fn>;
  await vi.waitFor(() => {
    expect(mount).toHaveBeenCalled();
  });
  const dialog = mount.mock.calls[0]?.[0];
  expect(dialog).toBeInstanceOf(UpgradeDialogComponent);
  return dialog as UpgradeDialogComponent;
}

describe('upgrade slash command', () => {
  it('registers /upgrade with /update alias', () => {
    expect(findBuiltInSlashCommand('upgrade')?.name).toBe('upgrade');
    expect(findBuiltInSlashCommand('update')?.name).toBe('upgrade');
  });

  it('mounts the upgrade dialog with a resolved plan', async () => {
    const mountEditorReplacement = vi.fn();
    const host = createHost({ mountEditorReplacement });
    const resolved = plan();

    const pending = handleUpgradeCommand(host, {
      resolveUpgradePlan: async () => resolved,
      getCurrentVersion: () => '0.4.0',
    });

    expect(host.showStatus).toHaveBeenCalledWith('Checking for updates…');
    const dialog = await waitForDialog(host);
    expect(host.track).toHaveBeenCalledWith('upgrade_command_tui_checked', {
      reason: 'update-available',
      source: 'npm-global',
    });
    expect(mountEditorReplacement).toHaveBeenCalledTimes(1);
    expect(dialog).toBeInstanceOf(UpgradeDialogComponent);

    dialog.handleInput(ESC);
    await pending;
  });

  it('starts observed install when Install is selected', async () => {
    const restoreEditor = vi.fn();
    const showStatus = vi.fn();
    const host = createHost({ restoreEditor, showStatus });
    const startObservedUpgradeInstall = vi.fn().mockResolvedValue({ started: true });

    const pending = handleUpgradeCommand(host, {
      resolveUpgradePlan: async () => plan(),
      startObservedUpgradeInstall,
      getCurrentVersion: () => '0.4.0',
    });

    const dialog = await waitForDialog(host);
    dialog.handleInput('\r');
    await pending;

    expect(restoreEditor).toHaveBeenCalled();
    expect(startObservedUpgradeInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        currentVersion: '0.4.0',
        targetVersion: '0.5.0',
        source: 'npm-global',
      }),
    );
  });

  it('ignores duplicate terminal stages from onStage', async () => {
    const showStatus = vi.fn();
    const host = createHost({ showStatus });
    let onStage: ((stage: UpgradeInstallStage, detail?: string) => void) | undefined;

    const pending = handleUpgradeCommand(host, {
      resolveUpgradePlan: async () => plan(),
      getCurrentVersion: () => '0.4.0',
      startObservedUpgradeInstall: async (options) => {
        onStage = options.onStage;
        return { started: true };
      },
    });

    const dialog = await waitForDialog(host);
    dialog.handleInput('\r');
    await pending;

    expect(onStage).toBeTypeOf('function');
    onStage!('done');
    onStage!('done');
    const doneCalls = showStatus.mock.calls.filter((call) =>
      String(call[0]).includes('Upgrade: done'),
    );
    expect(doneCalls).toHaveLength(1);
  });

  it('reports lock-held when install cannot start', async () => {
    const showStatus = vi.fn();
    const host = createHost({ showStatus });

    const pending = handleUpgradeCommand(host, {
      resolveUpgradePlan: async () => plan(),
      getCurrentVersion: () => '0.4.0',
      startObservedUpgradeInstall: async () => ({ started: false, reason: 'lock-held' }),
    });

    const dialog = await waitForDialog(host);
    dialog.handleInput('\r');
    await pending;

    expect(showStatus).toHaveBeenCalledWith('Upgrade already in progress.', 'warning');
  });
});
