/**
 * `/agents` — Worker Dock / Mission Control visibility. Cycles (or sets) the
 * band mode and persists it to `tui.toml` `[appearance] mission_control`.
 */

import { saveTuiConfig } from '../config';
import { formatErrorMessage } from '../utils/event-payload';
import type { MissionControlMode } from '../features/mission-control/dock';
import { missionBandProductName } from '../features/mission-control/labels';
import { currentAppearance, tuiConfigFromHost } from './config/appearance/tui-persist';
import { ttui } from '../utils/tui-i18n';
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
    host.showStatus(ttui('tui.agents.usage'), 'textMuted');
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
  const band = missionBandProductName();
  try {
    await saveTuiConfig(tuiConfigFromHost(host, { appearance: currentAppearance(host) }));
  } catch (error) {
    host.showStatus(ttui('tui.agents.modeSaveFailed', { band, mode, message: formatErrorMessage(error) }), 'warning');
    return;
  }
  host.showStatus(ttui('tui.agents.modeSet', { band, mode: MODE_LABEL[mode] }), 'success');
}
