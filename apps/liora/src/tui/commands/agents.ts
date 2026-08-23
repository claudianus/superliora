/**
 * `/jobs dock` — Worker Dock visibility. Cycles (or sets) the
 * band mode and persists it to `tui.toml` `[appearance] worker_dock`.
 */

import { saveTuiConfig } from '../config';
import { formatErrorMessage } from '../utils/event-payload';
import type { WorkerDockMode } from '../features/worker-dock/dock';
import { workerDockProductName } from '../features/worker-dock/labels';
import { currentAppearance, tuiConfigFromHost } from './config/appearance/tui-persist';
import { ttui } from '../utils/tui-i18n';
import type { SlashCommandHost } from './hub/dispatch';

const MODE_LABEL: Record<WorkerDockMode, string> = {
  auto: 'auto — appears while background workers run',
  pinned: 'pinned — always visible, even when idle',
  hidden: 'hidden — monitoring panel off',
};

export async function handleAgentsCommand(host: SlashCommandHost, rawArgs: string): Promise<void> {
  const args = rawArgs.trim().toLowerCase();
  if (args === 'auto' || args === 'pinned' || args === 'hidden') {
    await setWorkerDockMode(host, args);
    return;
  }
  if (args.length > 0) {
    host.showStatus(ttui('tui.agents.usage'), 'textMuted');
    return;
  }
  const next =
    host.workerDock.mode() === 'auto'
      ? 'pinned'
      : host.workerDock.mode() === 'pinned'
        ? 'hidden'
        : 'auto';
  await setWorkerDockMode(host, next);
}

async function setWorkerDockMode(host: SlashCommandHost, mode: WorkerDockMode): Promise<void> {
  host.workerDock.setMode(mode);
  const band = workerDockProductName();
  try {
    await saveTuiConfig(tuiConfigFromHost(host, { appearance: currentAppearance(host) }));
  } catch (error) {
    host.showStatus(ttui('tui.agents.modeSaveFailed', { band, mode, message: formatErrorMessage(error) }), 'warning');
    return;
  }
  host.showStatus(ttui('tui.agents.modeSet', { band, mode: MODE_LABEL[mode] }), 'success');
}
