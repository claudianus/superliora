/**
 * Settings → Storage — read-only home + session retention tips (SSOT §9.2).
 */

import { resolveConfigPath } from '@superliora/sdk';

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  buildStorageSettingsLines,
  resolveStoragePaths,
  type StorageGlanceInput,
} from '../../utils/storage/storage-glance';
import { SUPERLIORA_HOME_ENV } from '#/constant/app';
import { getDataDir, getLogDir } from '#/utils/paths';

import type { SlashCommandHost } from '../hub/dispatch';

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
  void showStorageSettingsPanel(host);
}

async function showStorageSettingsPanel(host: SlashCommandHost): Promise<void> {
  const glance = await loadStorageGlance(host);
  const lines = buildStorageSettingsLines(glance);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Storage ',
    enterBeatSeed: 'storage',
    requestRender: () => requestTUILayoutRender(host.state),
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
