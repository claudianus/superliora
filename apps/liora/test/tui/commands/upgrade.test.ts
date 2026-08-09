import { describe, expect, it, vi } from 'vitest';

import { SUPERLIORA_CHANGELOG_URL, type UpgradePlan } from '#/cli/update/plan';
import type { UpgradeInstallStage } from '#/cli/update/install-stages';
import {
  handleUpgradeCommand,
  parseUpgradeSlashArgs,
} from '#/tui/commands/info/upgrade';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { findBuiltInSlashCommand } from '#/tui/commands/hub/registry';
import { UpgradeStudioComponent } from '#/tui/components/dialogs/upgrade/upgrade-studio';

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
    fromMain: false,
    ...overrides,
  };
}

function createHost(overrides: Partial<SlashCommandHost> = {}): SlashCommandHost {
  return {
    mountEditorReplacement: vi.fn(),
    mountCenterModal: vi.fn(),
    closeCenterModal: vi.fn(),
    restoreEditor: vi.fn(),
    showStatus: vi.fn(),
    track: vi.fn(),
    state: {
      appState: { version: '0.4.0' },
      centerModalStack: [],
    },
    ...overrides,
  } as unknown as SlashCommandHost;
}

async function waitForStudio(host: SlashCommandHost): Promise<UpgradeStudioComponent> {
  const mount = host.mountCenterModal as ReturnType<typeof vi.fn>;
  await vi.waitFor(() => {
    expect(mount).toHaveBeenCalled();
  });
  const studio = mount.mock.calls[0]?.[0];
  expect(studio).toBeInstanceOf(UpgradeStudioComponent);
  return studio as UpgradeStudioComponent;
}

describe('upgrade slash command', () => {
  it('registers /upgrade with /update as the same command', () => {
    const viaUpgrade = findBuiltInSlashCommand('upgrade');
    const viaUpdate = findBuiltInSlashCommand('update');
    expect(viaUpgrade?.name).toBe('upgrade');
    expect(viaUpdate?.name).toBe('upgrade');
    expect(viaUpdate).toStrictEqual(viaUpgrade);
    expect(viaUpgrade?.aliases).toContain('update');
    expect(viaUpgrade?.argumentHint).toBe('[--main]');
  });

  it('parses --main / main slash args', () => {
    expect(parseUpgradeSlashArgs('--main')).toEqual({ fromMain: true });
    expect(parseUpgradeSlashArgs('main')).toEqual({ fromMain: true });
    expect(parseUpgradeSlashArgs('')).toEqual({ fromMain: false });
  });

  it('mounts Upgrade Studio and resolves into plan mode', async () => {
    const mountCenterModal = vi.fn();
    const host = createHost({ mountCenterModal });
    const resolved = plan();
    const resolveUpgradePlan = vi.fn().mockResolvedValue(resolved);

    const pending = handleUpgradeCommand(host, {
      resolveUpgradePlan,
      getCurrentVersion: () => '0.4.0',
    });

    const studio = await waitForStudio(host);
    expect(host.track).toHaveBeenCalledWith(
      'upgrade_studio_opened',
      expect.objectContaining({ current_version: '0.4.0', from_main: false }),
    );

    await vi.waitFor(() => {
      expect(studio.currentMode).toBe('plan');
    });
    expect(resolveUpgradePlan).toHaveBeenCalledWith('0.4.0', {}, { fromMain: false });
    expect(host.track).toHaveBeenCalledWith('upgrade_command_tui_checked', {
      reason: 'update-available',
      source: 'npm-global',
      from_main: false,
    });
    expect(mountCenterModal).toHaveBeenCalledTimes(1);

    studio.handleInput(ESC);
    await pending;
  });

  it('resolves tip-of-main when opened with fromMain', async () => {
    const host = createHost();
    const resolveUpgradePlan = vi.fn().mockResolvedValue(
      plan({
        fromMain: true,
        source: 'native',
        target: { version: 'origin/main', upstream: 'origin/main' },
      }),
    );

    const pending = handleUpgradeCommand(
      host,
      { resolveUpgradePlan, getCurrentVersion: () => '0.4.0' },
      { fromMain: true },
    );

    const studio = await waitForStudio(host);
    await vi.waitFor(() => {
      expect(studio.currentMode).toBe('plan');
    });
    expect(resolveUpgradePlan).toHaveBeenCalledWith('0.4.0', {}, { fromMain: true });
    studio.handleInput(ESC);
    await pending;
  });

  it('re-plans tip of main when Install tip of main is selected', async () => {
    const host = createHost();
    const releasePlan = plan({ reason: 'up-to-date', target: null, canAutoInstall: false });
    const mainPlan = plan({
      fromMain: true,
      source: 'native',
      target: { version: 'origin/main', upstream: 'origin/main' },
      canAutoInstall: true,
    });
    const resolveUpgradePlan = vi
      .fn()
      .mockResolvedValueOnce(releasePlan)
      .mockResolvedValueOnce(mainPlan);

    const pending = handleUpgradeCommand(host, {
      resolveUpgradePlan,
      getCurrentVersion: () => '0.4.0',
    });

    const studio = await waitForStudio(host);
    await vi.waitFor(() => {
      expect(studio.currentMode).toBe('plan');
    });

    // Up-to-date actions: Install tip of main (index 0)
    studio.handleInput('\r');
    await vi.waitFor(() => {
      expect(resolveUpgradePlan).toHaveBeenCalledTimes(2);
    });
    expect(resolveUpgradePlan).toHaveBeenLastCalledWith('0.4.0', {}, { fromMain: true });
    await vi.waitFor(() => {
      expect(studio.currentPlan?.fromMain).toBe(true);
    });
    studio.handleInput(ESC);
    await pending;
  });

  it('starts observed install when Install is selected and keeps studio open', async () => {
    const showStatus = vi.fn();
    const host = createHost({ showStatus });
    const startObservedUpgradeInstall = vi.fn().mockResolvedValue({ started: true });

    const pending = handleUpgradeCommand(host, {
      resolveUpgradePlan: async () => plan(),
      startObservedUpgradeInstall,
      getCurrentVersion: () => '0.4.0',
    });

    const studio = await waitForStudio(host);
    await vi.waitFor(() => {
      expect(studio.currentMode).toBe('plan');
    });
    studio.handleInput('\r');
    await vi.waitFor(() => {
      expect(startObservedUpgradeInstall).toHaveBeenCalled();
    });
    expect(startObservedUpgradeInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        currentVersion: '0.4.0',
        targetVersion: '0.5.0',
        source: 'npm-global',
      }),
    );
    expect(studio.currentMode).toBe('installing');

    // Dismiss via failed lock path is not used; complete via onStage after start.
    const onStage = startObservedUpgradeInstall.mock.calls[0]?.[0]?.onStage as
      | ((stage: UpgradeInstallStage, detail?: string) => void)
      | undefined;
    onStage?.('done');
    await vi.waitFor(() => {
      expect(studio.currentMode).toBe('success');
    });
    studio.handleInput('\r');
    await pending;
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

    const studio = await waitForStudio(host);
    await vi.waitFor(() => expect(studio.currentMode).toBe('plan'));
    studio.handleInput('\r');
    await vi.waitFor(() => expect(onStage).toBeTypeOf('function'));

    onStage!('done');
    onStage!('done');
    const doneCalls = showStatus.mock.calls.filter((call) =>
      String(call[0]).includes('Restart SuperLiora'),
    );
    expect(doneCalls).toHaveLength(1);
    studio.handleInput('\r');
    await pending;
  });

  it('surfaces failed stage detail and manual install command', async () => {
    const showStatus = vi.fn();
    const host = createHost({ showStatus });
    let onStage: ((stage: UpgradeInstallStage, detail?: string) => void) | undefined;
    const resolved = plan();

    const pending = handleUpgradeCommand(host, {
      resolveUpgradePlan: async () => resolved,
      getCurrentVersion: () => '0.4.0',
      startObservedUpgradeInstall: async (options) => {
        onStage = options.onStage;
        return { started: true };
      },
    });

    const studio = await waitForStudio(host);
    await vi.waitFor(() => expect(studio.currentMode).toBe('plan'));
    studio.handleInput('\r');
    await vi.waitFor(() => expect(onStage).toBeTypeOf('function'));

    onStage!('failed', 'npm ERR! EACCES');
    onStage!('failed', 'npm ERR! EACCES');
    await vi.waitFor(() => expect(studio.currentMode).toBe('failed'));
    const failedCalls = showStatus.mock.calls.filter((call) =>
      String(call[0]).includes('Upgrade failed'),
    );
    expect(failedCalls).toHaveLength(1);
    expect(failedCalls[0]?.[0]).toContain('npm ERR! EACCES');
    expect(failedCalls[0]?.[0]).toContain(resolved.installCommand);
    studio.handleInput(ESC);
    await pending;
  });

  it('reports lock-held when install cannot start', async () => {
    const showStatus = vi.fn();
    const host = createHost({ showStatus });

    const pending = handleUpgradeCommand(host, {
      resolveUpgradePlan: async () => plan(),
      getCurrentVersion: () => '0.4.0',
      startObservedUpgradeInstall: async () => ({ started: false, reason: 'lock-held' }),
    });

    const studio = await waitForStudio(host);
    await vi.waitFor(() => expect(studio.currentMode).toBe('plan'));
    studio.handleInput('\r');
    await vi.waitFor(() => expect(studio.currentMode).toBe('failed'));
    expect(showStatus).toHaveBeenCalledWith('Upgrade already in progress.', 'warning');
    studio.handleInput(ESC);
    await pending;
  });
});
