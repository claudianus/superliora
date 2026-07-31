/**
 * Session-open status tip when mission.autoStart opt-in is ON (config only — no auto-run).
 */

import type { ColorToken } from '#/tui/theme';
import { isActiveMissionRun } from '#/tui/utils/mission/mission-contract';
import {
  resolveMissionAutoStart,
  resolveMissionAutoStartSessionTip,
} from '#/tui/utils/mission/mission-glance';

/** Minimal host/session surfaces — avoid coupling tips to the full SDK harness graph. */
export interface MissionAutoStartSessionTipHost {
  readonly harness: {
    getConfig(options?: { readonly reload?: boolean }): Promise<unknown>;
  };
  readonly session: { readonly id: string } | undefined;
  showStatus(msg: string, color?: ColorToken): void;
}

export interface MissionAutoStartSessionTipSession {
  readonly id: string;
  getUltraworkRun(): Promise<unknown>;
}

/** Best-effort status bar tip after session attach when opt-in is ON and no run is active. */
export async function showMissionAutoStartSessionTipIfNeeded(
  host: MissionAutoStartSessionTipHost,
  session: MissionAutoStartSessionTipSession,
): Promise<void> {
  if (host.session !== session) return;

  let autoStart = false;
  try {
    const config = await host.harness.getConfig({ reload: false });
    autoStart = resolveMissionAutoStart(
      config as { readonly mission?: { readonly autoStart?: boolean } } | null | undefined,
    );
  } catch {
    return;
  }
  if (!autoStart) return;

  let missionAlreadyActive = false;
  try {
    const run = await session.getUltraworkRun();
    missionAlreadyActive = isActiveMissionRun(run as Parameters<typeof isActiveMissionRun>[0]);
  } catch {
    /* best-effort */
  }

  const tip = resolveMissionAutoStartSessionTip({ autoStart, missionAlreadyActive });
  if (tip === null) return;
  if (host.session !== session) return;
  host.showStatus(tip, 'textMuted');
}
