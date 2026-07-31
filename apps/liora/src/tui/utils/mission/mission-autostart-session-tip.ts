/**
 * Session-open status tip when mission.autoStart opt-in is ON (config only — no auto-run).
 */

import type { LioraHarness, Session } from '@superliora/sdk';

import type { ColorToken } from '#/tui/theme';
import { isActiveMissionRun } from '#/tui/utils/mission/mission-contract';
import {
  resolveMissionAutoStart,
  resolveMissionAutoStartSessionTip,
} from '#/tui/utils/mission/mission-glance';

export interface MissionAutoStartSessionTipHost {
  readonly harness: LioraHarness;
  readonly session: Session | undefined;
  showStatus(msg: string, color?: ColorToken): void;
}

/** Best-effort status bar tip after session attach when opt-in is ON and no run is active. */
export async function showMissionAutoStartSessionTipIfNeeded(
  host: MissionAutoStartSessionTipHost,
  session: Session,
): Promise<void> {
  if (host.session !== session) return;

  let autoStart = false;
  try {
    const config = await host.harness.getConfig({ reload: false });
    autoStart = resolveMissionAutoStart(config);
  } catch {
    return;
  }
  if (!autoStart) return;

  let missionAlreadyActive = false;
  try {
    const run = await session.getUltraworkRun();
    missionAlreadyActive = isActiveMissionRun(run);
  } catch {
    /* best-effort */
  }

  const tip = resolveMissionAutoStartSessionTip({ autoStart, missionAlreadyActive });
  if (tip === null) return;
  if (host.session !== session) return;
  host.showStatus(tip, 'textMuted');
}
