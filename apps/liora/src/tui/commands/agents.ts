/**
 * `/agents` — Mission Control visibility. Cycles (or sets) the dock mode
 * and persists it to `tui.toml` `[appearance] mission_control`.
 */

import { saveTuiConfig } from '../config';
import { formatErrorMessage } from '../utils/event-payload';
import type { MissionControlMode } from '../features/mission-control/dock';
import { currentAppearance, tuiConfigFromHost } from './config/appearance/tui-persist';
import type { SlashCommandHost } from './hub/dispatch';

const MODE_LABEL: Record<MissionControlMode, string> = {
  auto: 'auto — appears while background workers run',
  pinned: 'pinned — always visible, even when idle',
  hidden: 'hidden — monitoring panel off',
};

export async function handleAgentsCommand(host: SlashCommandHost, rawArgs: string): Promise<void> {
  const args = rawArgs.trim().toLowerCase();
  if (args === 'auto' || args === 'pinned' || args === 'hidden') {
    await setMissionControlMode(host, args);
    return;
  }
  if (args.length > 0) {
    host.showStatus('Usage: /agents [auto|pinned|hidden] — no args cycles the mode.', 'textMuted');
    return;
  }
  const next =
    host.missionControl.mode() === 'auto'
      ? 'pinned'
      : host.missionControl.mode() === 'pinned'
        ? 'hidden'
        : 'auto';
  await setMissionControlMode(host, next);
}

async function setMissionControlMode(host: SlashCommandHost, mode: MissionControlMode): Promise<void> {
  host.missionControl.setMode(mode);
  try {
    await saveTuiConfig(tuiConfigFromHost(host, { appearance: currentAppearance(host) }));
  } catch (error) {
    host.showStatus(`Mission Control ${mode} (save failed: ${formatErrorMessage(error)})`, 'warning');
    return;
  }
  host.showStatus(`Mission Control: ${MODE_LABEL[mode]}`, 'success');
}
