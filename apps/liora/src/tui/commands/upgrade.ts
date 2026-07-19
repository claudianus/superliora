import { getVersion } from '#/cli/version';
import {
  startObservedUpgradeInstall,
  type UpgradeInstallStage,
} from '#/cli/update/preflight';
import { resolveUpgradePlan } from '#/cli/update/plan';
import {
  UpgradeDialogComponent,
  type UpgradeDialogChoice,
} from '#/tui/components/dialogs/upgrade-dialog';

import type { SlashCommandHost } from './dispatch';

export interface UpgradeCommandDeps {
  readonly resolveUpgradePlan: typeof resolveUpgradePlan;
  readonly startObservedUpgradeInstall: typeof startObservedUpgradeInstall;
  readonly getCurrentVersion: () => string;
}

/**
 * `/upgrade` — resolve an update plan, show the premium dialog, and optionally
 * start an observed background install. Settings → Upgrade remains the
 * auto-install preference picker (`showUpdatePreferencePicker`).
 */
export async function handleUpgradeCommand(
  host: SlashCommandHost,
  deps: Partial<UpgradeCommandDeps> = {},
): Promise<void> {
  host.showStatus('Checking for updates…');
  const currentVersion = deps.getCurrentVersion?.() ?? host.state.appState.version ?? getVersion();
  const plan = await (deps.resolveUpgradePlan ?? resolveUpgradePlan)(currentVersion);
  host.track('upgrade_command_tui_checked', { reason: plan.reason, source: plan.source });

  await new Promise<void>((resolve) => {
    const dialog = new UpgradeDialogComponent({
      plan,
      onCancel: () => {
        host.restoreEditor();
        resolve();
      },
      onSelect: (choice: UpgradeDialogChoice) => {
        host.restoreEditor();
        if (choice !== 'install' || plan.target === null || !plan.canAutoInstall) {
          resolve();
          return;
        }
        void (async () => {
          let lastTerminalStage: UpgradeInstallStage | undefined;
          const started = await (deps.startObservedUpgradeInstall ?? startObservedUpgradeInstall)({
            currentVersion,
            targetVersion: plan.target!.version,
            source: plan.source,
            platform: process.platform,
            onStage: (stage, detail) => {
              if ((stage === 'done' || stage === 'failed') && stage === lastTerminalStage) {
                return;
              }
              if (stage === 'done' || stage === 'failed') {
                lastTerminalStage = stage;
              }
              if (stage === 'done') {
                host.showStatus(
                  'Upgrade complete. Restart SuperLiora to use the new version.',
                  'success',
                );
                return;
              }
              if (stage === 'failed') {
                const reason = detail?.trim() || 'install failed';
                host.showStatus(
                  `Upgrade failed: ${reason}. Run: ${plan.installCommand}`,
                  'error',
                );
                return;
              }
              host.showStatus(`Upgrade: ${stage}${detail ? ` — ${detail}` : ''}`);
            },
          });
          if (!started.started) {
            host.showStatus(
              started.reason === 'lock-held' || started.reason === 'already-active'
                ? 'Upgrade already in progress.'
                : 'Could not start upgrade.',
              'warning',
            );
          }
          resolve();
        })();
      },
    });
    host.mountEditorReplacement(dialog);
  });
}
