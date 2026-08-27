/**
 * Settings → Storage — home paths, volume pressure, and safe GC (SSOT §9.2).
 */

import {
  collectStorageGarbage,
  formatBytes,
  getDiskPressureSnapshot,
  listVolumeSpaces,
  measureStorageBytes,
  probeVolumeSpace,
  resolveConfigPath,
} from '@superliora/sdk';

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildStorageSettingsLines,
  resolveStoragePaths,
  STORAGE_HOME_TIP,
  STORAGE_LOGS_TIP,
  STORAGE_RETENTION_TIP,
  type StorageGlanceInput,
} from '../../../utils/storage/storage-glance';
import { SUPERLIORA_HOME_ENV } from '#/constant/app';
import { relocateLioraHome, suggestedHomeOnVolume } from '#/utils/liora-home';
import { getDataDir, getLogDir } from '#/utils/paths';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';
import { ttui } from '../../../utils/tui-i18n';

export { STORAGE_HOME_TIP, STORAGE_LOGS_TIP, STORAGE_RETENTION_TIP };

async function loadStorageGlance(host: SlashCommandHost): Promise<StorageGlanceInput> {
  const homeDir = host.harness.homeDir ?? getDataDir();
  const homeFromEnv = (process.env[SUPERLIORA_HOME_ENV]?.trim().length ?? 0) > 0;
  const configPath = host.harness.configPath ?? resolveConfigPath({ homeDir });
  const logDir = getLogDir();
  let workDir = host.state.appState.workDir;
  let sessionDir: string | undefined;
  let sessionCount: number | undefined;

  try {
    const session = host.requireSession();
    sessionDir = session.summary?.sessionDir;
    const dir = session.workDir ?? session.summary?.workDir ?? workDir;
    workDir = dir;
    if (dir !== undefined && typeof host.harness.listSessions === 'function') {
      const sessions = await host.harness.listSessions({ workDir: dir });
      sessionCount = sessions.length;
    }
  } catch {
    /* optional */
  }

  const volume = await probeVolumeSpace(homeDir).catch(() => undefined);
  const pressure = getDiskPressureSnapshot();
  const usage = await measureStorageBytes(homeDir).catch(() => undefined);

  return {
    ...resolveStoragePaths({ homeDir, configPath, sessionDir }),
    homeFromEnv,
    logDir,
    workDir,
    sessionCount,
    ...(usage !== undefined ? { worktreesBytes: usage.worktreesBytes } : {}),
    ...(volume !== undefined
      ? { volumeFreeBytes: volume.freeBytes, volumeTotalBytes: volume.totalBytes }
      : {}),
    ...(pressure.level !== 'ok' ? { pressureLevel: pressure.level } : {}),
    ...(pressure.lastGc !== undefined ? { lastGcFreedBytes: pressure.lastGc.freedBytes } : {}),
  };
}

export function showStorageSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.storage.title'),
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Storage status',
          description:
            'Live home paths · volume free · session dir · journal · tool-results · log dir.',
        },
        {
          value: 'gc',
          label: 'Run storage GC',
          description: 'Reclaim cache, idle wires, worktree tmp, and old logs. Never deletes active sessions.',
        },
        {
          value: 'move',
          label: ttui('tui.settings.pane.storage.move'),
          description: ttui('tui.settings.pane.storage.moveDesc'),
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showStorageSettingsPanel(host);
          return;
        }
        if (value === 'gc') {
          void runStorageGcFromSettings(host);
          return;
        }
        if (value === 'move') {
          void showMoveDataHomePicker(host);
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.storage.title') },
  );
}

async function showStorageSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadStorageGlance(host);
  const lines = buildStorageSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ttui('tui.settings.pane.storage.panelTitle'),
    enterBeatSeed: 'storage',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}

async function showMoveDataHomePicker(host: SlashCommandHost): Promise<void> {
  const homeDir = host.harness.homeDir ?? getDataDir();
  const volumes = await listVolumeSpaces().catch(() => []);
  const options = volumes.map((volume) => {
    const dest = suggestedHomeOnVolume(volume.path);
    return {
      value: dest,
      label: dest,
      description: `${formatBytes(volume.freeBytes)} free / ${formatBytes(volume.totalBytes)} total`,
    };
  });
  if (options.length === 0) {
    host.showStatus(ttui('tui.settings.pane.storage.moveNone'), 'warning');
    return;
  }
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: ttui('tui.settings.pane.storage.move'),
      searchable: true,
      options,
      onSelect: (value) => {
        dismissPickerDialog(host);
        void (async () => {
          try {
            const result = await relocateLioraHome({ from: homeDir, to: value });
            host.showStatus(
              ttui('tui.settings.pane.storage.moveDone', { path: result.to }),
              'success',
            );
          } catch (error) {
            host.showStatus(error instanceof Error ? error.message : String(error), 'error');
          }
        })();
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: ttui('tui.settings.pane.storage.move') },
  );
}

async function runStorageGcFromSettings(host: SlashCommandHost): Promise<void> {
  const homeDir = host.harness.homeDir ?? getDataDir();
  try {
    const report = await collectStorageGarbage({ homeDir });
    host.showStatus(
      `GC: compressed=${String(report.compressed)} deleted=${String(report.deleted)} freed=${formatBytes(report.freedBytes)}`,
      'info',
    );
    await showStorageSettingsPanel(host);
  } catch (error) {
    host.showStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}
