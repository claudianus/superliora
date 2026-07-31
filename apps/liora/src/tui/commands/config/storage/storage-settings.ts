/**
 * Settings → Storage — read-only home + session retention tips (SSOT §9.2).
 */

import { resolveConfigPath } from '@superliora/sdk';

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

  return {
    ...resolveStoragePaths({ homeDir, configPath, sessionDir }),
    homeFromEnv,
    logDir,
    workDir,
    sessionCount,
  };
}

export function showStorageSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Storage',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        {
          value: 'status',
          label: 'Storage status',
          description:
            'Live home paths · session dir · journal · tool-results · log dir · retention count.',
        },
        {
          value: 'tip-home',
          label: 'SUPERLIORA_HOME tip',
          description: 'Override default ~/.superliora — relocates config, sessions, cache, logs.',
        },
        {
          value: 'tip-retention',
          label: 'Session retention tip',
          description:
            'Transcripts · wire.jsonl journal · tool-results · export · manual cleanup.',
        },
        {
          value: 'tip-logs',
          label: 'Log level tip',
          description: 'TUI stderr + ~/.superliora/logs · server --log-level flag.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'status') {
          void showStorageSettingsPanel(host);
          return;
        }
        if (value === 'tip-home') {
          host.showStatus(STORAGE_HOME_TIP, 'info');
          return;
        }
        if (value === 'tip-retention') {
          host.showStatus(STORAGE_RETENTION_TIP, 'info');
          return;
        }
        if (value === 'tip-logs') {
          host.showStatus(STORAGE_LOGS_TIP, 'info');
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Storage' },
  );
}

async function showStorageSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadStorageGlance(host);
  const lines = buildStorageSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Storage ',
    enterBeatSeed: 'storage',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
