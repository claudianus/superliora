/**
 * Settings → Storage — home paths, volume pressure, and safe GC (SSOT §9.2).
 */

import {
  collectStorageGarbage,
  formatBytes,
  getDiskPressureSnapshot,
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

  return {
    ...resolveStoragePaths({ homeDir, configPath, sessionDir }),
    homeFromEnv,
    logDir,
    workDir,
    sessionCount,
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
      hint: '↑↓ · Enter · Esc',
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
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showStorageSettingsPanel(host);
          return;
        }
        if (value === 'gc') {
          void runStorageGcFromSettings(host);
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
