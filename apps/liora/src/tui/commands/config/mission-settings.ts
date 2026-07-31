/**
 * Settings → Mission / Goals — read-only glance + tips (SSOT §9.2).
 * No fake persist toggles until Mission config schema lands.
 */

import { UsagePanelComponent } from '../../components/messages/usage-panel/index';
import { readGoalQueue } from '../../goal-queue-store';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  buildMissionSettingsLines,
  type MissionSessionGlance,
} from '#/tui/utils/mission/mission-glance';
import { isActiveMissionRun } from '#/tui/utils/mission/mission-contract';

import type { SlashCommandHost } from '../hub/dispatch';

export {
  MISSION_EVIDENCE_SENSOR_TIPS,
  MISSION_IMPORT_PATH_TIPS,
  MISSION_PROTOCOL_ALIAS_TIPS,
  MISSION_RESUME_E2E_TIP,
  missionDualEmitStatusLine,
  missionMdArtifactTip,
} from '#/tui/utils/mission/mission-glance';

export function showMissionSettings(host: SlashCommandHost): void {
  void showMissionSettingsPanel(host);
}

async function loadMissionSessionGlance(host: SlashCommandHost): Promise<MissionSessionGlance> {
  const workDir = host.state.appState.workDir ?? process.cwd();
  const ultraworkMode = host.state.appState.ultraworkMode === true;
  const glance: MissionSessionGlance = {
    ultraworkMode,
    workDir,
    goal: host.state.appState.goal ?? null,
    appState: host.state.appState,
  };

  try {
    const session = host.requireSession();
    const needsRemoteGoal = glance.goal == null;

    const [run, goalResult, queue] = await Promise.all([
      session.getUltraworkRun().catch(() => null),
      needsRemoteGoal
        ? session.getGoal().catch(() => ({ goal: null as const }))
        : Promise.resolve({ goal: glance.goal ?? null }),
      readGoalQueue(session).catch(() => undefined),
    ]);

    if (goalResult.goal != null) {
      glance.goal = goalResult.goal;
    }

    if (run != null) {
      glance.missionRun = {
        active: isActiveMissionRun(run),
        status: run.status,
        stage: run.stage,
        objective: run.objective,
      };
    } else if (ultraworkMode) {
      glance.missionRun = { active: false, status: 'awaiting' };
    }

    if (queue != null) {
      glance.goalQueueCount = queue.goals.length;
    }
  } catch {
    glance.sessionUnavailable = true;
  }

  return glance;
}

async function showMissionSettingsPanel(host: SlashCommandHost): Promise<void> {
  const session = await loadMissionSessionGlance(host);
  const lines = buildMissionSettingsLines(session);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Mission ',
    enterBeatSeed: 'mission',
    requestRender: () =>{  requestTUILayoutRender(host.state); },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
