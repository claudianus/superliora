import { getVersion } from '#/cli/version';
import {
  startObservedUpgradeInstall,
  type UpgradeInstallStage,
} from '#/cli/update/preflight';
import { resolveUpgradePlan, type UpgradePlan } from '#/cli/update/plan';
import {
  UpgradeStudioComponent,
  type UpgradeStudioChoice,
} from '#/tui/components/dialogs/upgrade/upgrade-studio';
import { requestTUILayoutRender } from '#/tui/utils/render/frame-render';
import { dismissPickerDialog, mountPickerDialog } from '#/tui/utils/ui/mount-picker';
import { showUpdatePreferencePicker } from '#/tui/commands/config/upgrade/update-preference';

import type { SlashCommandHost } from '../hub/dispatch';

export interface UpgradeCommandDeps {
  readonly resolveUpgradePlan: typeof resolveUpgradePlan;
  readonly startObservedUpgradeInstall: typeof startObservedUpgradeInstall;
  readonly getCurrentVersion: () => string;
}

export interface UpgradeCommandOptions {
  /** Skip published releases; plan tip of origin/main (same as `liora upgrade --main`). */
  readonly fromMain?: boolean;
}

/** Parse `/upgrade` · `/update` args (`--main` or bare `main`). */
export function parseUpgradeSlashArgs(args: string): UpgradeCommandOptions {
  const tokens = args.trim().split(/\s+/).filter((token) => token.length > 0);
  return {
    fromMain: tokens.some((token) => token === '--main' || token === 'main'),
  };
}

/**
 * `/upgrade` — open the premium Upgrade Studio (center modal):
 * check → plan → observed install theatre → success/fail.
 * Default plan uses published releases; `--main` / Install tip of main uses origin/main.
 */
export async function handleUpgradeCommand(
  host: SlashCommandHost,
  deps: Partial<UpgradeCommandDeps> = {},
  options: UpgradeCommandOptions = {},
): Promise<void> {
  const currentVersion =
    deps.getCurrentVersion?.() ?? host.state.appState.version ?? getVersion();
  const resolvePlan = deps.resolveUpgradePlan ?? resolveUpgradePlan;
  host.track('upgrade_studio_opened', {
    current_version: currentVersion,
    from_main: options.fromMain === true,
  });

  await new Promise<void>((resolve) => {
    let settled = false;
    let lastTerminalStage: UpgradeInstallStage | undefined;
    let plan: UpgradePlan | null = null;
    let installInFlight = false;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      dismissPickerDialog(host);
      resolve();
    };

    const refresh = (): void => {
      try {
        requestTUILayoutRender(host.state);
      } catch {
        // Hosts without a full TUIState (tests) skip frame requests.
      }
    };

    const studio = new UpgradeStudioComponent({
      mode: 'checking',
      onCancel: () => {
        if (installInFlight) return;
        finish();
      },
      onSelect: (choice: UpgradeStudioChoice) => {
        void handleChoice(choice);
      },
    });

    mountPickerDialog(host, studio, { label: 'Upgrade', mode: 'replace' });
    refresh();

    const showPlan = (next: UpgradePlan): void => {
      plan = next;
      host.track('upgrade_command_tui_checked', {
        reason: next.reason,
        source: next.source,
        from_main: next.fromMain,
      });
      studio.update({ mode: 'plan', plan: next, stage: 'checking' });
      refresh();
    };

    const showCheckFailed = (reason: string): void => {
      studio.update({
        mode: 'failed',
        plan: null,
        stage: 'failed',
        detail: reason,
      });
      refresh();
      host.showStatus(`Upgrade check failed: ${reason}`, 'error');
    };

    const runInstall = async (activePlan: UpgradePlan): Promise<void> => {
      if (activePlan.target === null) return;
      installInFlight = true;
      studio.update({ mode: 'installing', stage: 'checking', detail: '' });
      refresh();
      host.track('upgrade_studio_install_started', {
        target_version: activePlan.target.version,
        source: activePlan.source,
        from_main: activePlan.fromMain,
      });

      const started = await (deps.startObservedUpgradeInstall ?? startObservedUpgradeInstall)({
        currentVersion,
        targetVersion: activePlan.target.version,
        source: activePlan.source,
        platform: process.platform,
        fromMain: activePlan.fromMain,
        checkoutRoot: activePlan.checkoutRoot,
        onStage: (stage, detail) => {
          if ((stage === 'done' || stage === 'failed') && stage === lastTerminalStage) {
            return;
          }
          if (stage === 'done' || stage === 'failed') {
            lastTerminalStage = stage;
          }
          if (stage === 'done') {
            installInFlight = false;
            studio.update({ mode: 'success', stage: 'done', detail: '' });
            refresh();
            host.showStatus(
              'Upgrade complete. Restart SuperLiora to use the new version.',
              'success',
            );
            host.track('upgrade_studio_succeeded', {
              target_version: activePlan.target!.version,
              source: activePlan.source,
              from_main: activePlan.fromMain,
            });
            return;
          }
          if (stage === 'failed') {
            installInFlight = false;
            const reason = detail?.trim() ?? 'install failed';
            studio.update({ mode: 'failed', stage: 'failed', detail: reason });
            refresh();
            host.showStatus(
              `Upgrade failed: ${reason}. Run: ${activePlan.installCommand}`,
              'error',
            );
            host.track('upgrade_studio_failed', {
              target_version: activePlan.target!.version,
              source: activePlan.source,
              reason,
              from_main: activePlan.fromMain,
            });
            return;
          }
          studio.update({
            mode: 'installing',
            stage,
            detail: detail?.trim() || undefined,
          });
          refresh();
        },
      });

      if (!started.started) {
        installInFlight = false;
        const reason =
          started.reason === 'lock-held' || started.reason === 'already-active'
            ? 'Upgrade already in progress.'
            : 'Could not start upgrade.';
        studio.update({ mode: 'failed', stage: 'failed', detail: reason });
        refresh();
        host.showStatus(reason, 'warning');
      }
    };

    const planFromMain = async (): Promise<void> => {
      studio.update({ mode: 'checking', plan: null, stage: 'checking', detail: '' });
      refresh();
      try {
        const next = await resolvePlan(currentVersion, {}, { fromMain: true });
        showPlan(next);
        if (next.reason === 'update-available' && next.canAutoInstall && next.target !== null) {
          // Opt-in tip-of-main: jump straight into confirm-ready plan; user still picks Install.
          return;
        }
      } catch (error) {
        showCheckFailed(error instanceof Error ? error.message : String(error));
      }
    };

    const handleChoice = async (choice: UpgradeStudioChoice): Promise<void> => {
      if (choice === 'later' || choice === 'dismiss') {
        finish();
        return;
      }
      if (choice === 'preferences') {
        // Keep studio under the stack; preferences push on top.
        showUpdatePreferencePicker(host);
        return;
      }
      if (choice === 'copy-command') {
        if (plan !== null) {
          host.showStatus(`Install: ${plan.installCommand}`, 'info');
        }
        return;
      }
      if (choice === 'install-main') {
        await planFromMain();
        return;
      }
      if (choice === 'install' || choice === 'retry') {
        if (plan === null || plan.target === null || !plan.canAutoInstall) {
          finish();
          return;
        }
        await runInstall(plan);
      }
    };

    void (async () => {
      try {
        const next = await resolvePlan(
          currentVersion,
          {},
          { fromMain: options.fromMain === true },
        );
        showPlan(next);
      } catch (error) {
        showCheckFailed(error instanceof Error ? error.message : String(error));
      }
    })();
  });
}
