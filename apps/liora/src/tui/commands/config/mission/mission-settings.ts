/**
 * Settings → Mission / Goals — glance + autoStart toggle (SSOT §9.2).
 */

import { ChoicePickerComponent } from '../../../components/dialogs/picker/choice-picker';
import { UsagePanelComponent } from '../../../components/messages/usage-panel/index';
import { readGoalQueue } from '../../../goal-queue-store';
import { requestTUILayoutRender } from '../../../utils/render/frame-render';
import {
  buildMissionAutoStartConfigPatch,
  buildMissionSettingsLines,
  resolveMissionAutoStart,
  type MissionSessionGlance,
} from '#/tui/utils/mission/mission-glance';
import { isActiveMissionRun } from '#/tui/utils/mission/mission-contract';
import { MISSION_PRESETS } from '#/tui/utils/settings/mission-presets';
import { SETTINGS_PRESETS_ROW, showSettingPresetsPicker } from '#/tui/utils/settings/show-setting-presets';
import { dismissPickerDialog, mountPickerDialog } from '../../../utils/ui/mount-picker';

import type { SlashCommandHost } from '../../hub/dispatch';

export {
  MISSION_EVIDENCE_SENSOR_TIPS,
  MISSION_IMPORT_PATH_TIPS,
  MISSION_PROTOCOL_ALIAS_TIPS,
  MISSION_RESUME_E2E_TIP,
  missionDualEmitStatusLine,
  missionMdArtifactTip,
} from '#/tui/utils/mission/mission-glance';

export function showMissionSettings(host: SlashCommandHost): void {
  mountPickerDialog(
    host,
    new ChoicePickerComponent({
      title: 'Mission / Goals',
      hint: '↑↓ · Enter · Esc',
      searchable: true,
      options: [
        SETTINGS_PRESETS_ROW,
        {
          value: 'status',
          label: 'Mission status',
          description: 'Live run · goal queue · auto-start · evidence / protocol tips.',
        },
        {
          value: 'auto-on',
          label: 'Auto-start ON (opt-in)',
          description:
            'harness.setConfig → mission.autoStart = true · still requires /mission to run.',
        },
        {
          value: 'auto-off',
          label: 'Auto-start OFF (default)',
          description: 'mission.autoStart = false · no session-open Mission invent.',
        },
      ],
      onSelect: (value) => {
        dismissPickerDialog(host);
        if (value === 'presets') {
          showSettingPresetsPicker(host, {
            title: 'Mission presets',
            catalog: MISSION_PRESETS,
            onApply: async (preset) => {
              await setMissionAutoStart(host, preset.patch.autoStart);
            },
          });
          return;
        }
        if (value === 'status') {
          void showMissionSettingsPanel(host);
          return;
        }
        if (value === 'auto-on') {
          void setMissionAutoStart(host, true);
          return;
        }
        if (value === 'auto-off') {
          void setMissionAutoStart(host, false);
        }
      },
      onCancel: () => {
        dismissPickerDialog(host);
      },
    }),
    { label: 'Mission' },
  );
}

async function setMissionAutoStart(host: SlashCommandHost, enabled: boolean): Promise<void> {
  try {
    await host.harness.setConfig(buildMissionAutoStartConfigPatch(enabled));
    host.showStatus(
      enabled
        ? 'Mission auto-start opt-in ON — still start with /mission <objective> or /mission resume.'
        : 'Mission auto-start OFF (default).',
      'success',
    );
  } catch (error) {
    host.showStatus(
      `Failed to update mission.autoStart: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

async function loadMissionSessionGlance(host: SlashCommandHost): Promise<MissionSessionGlance> {
  const workDir = host.state.appState.workDir ?? process.cwd();
  const ultraworkMode = host.state.appState.ultraworkMode === true;
  let autoStart = false;
  try {
    const config = await host.harness.getConfig({ reload: true });
    autoStart = resolveMissionAutoStart(config);
  } catch {
    /* default false */
  }

  const base: MissionSessionGlance = {
    ultraworkMode,
    workDir,
    goal: host.state.appState.goal ?? null,
    appState: host.state.appState,
    autoStart,
  };

  try {
    const session = host.requireSession();
    const needsRemoteGoal = base.goal == null;

    const [run, goalResult, queue] = await Promise.all([
      session.getUltraworkRun().catch(() => null),
      needsRemoteGoal
        ? session.getGoal().catch(() => ({ goal: null }))
        : Promise.resolve({ goal: base.goal ?? null }),
      readGoalQueue(session).catch(() => undefined),
    ]);

    const goal = goalResult.goal ?? base.goal;
    const missionRun =
      run != null
        ? {
            active: isActiveMissionRun(run),
            status: run.status,
            stage: run.stage,
            objective: run.objective,
          }
        : ultraworkMode
          ? { active: false as const, status: 'awaiting' as const }
          : undefined;

    return {
      ...base,
      goal,
      ...(missionRun !== undefined ? { missionRun } : {}),
      ...(queue != null ? { goalQueueCount: queue.goals.length } : {}),
    };
  } catch {
    return { ...base, sessionUnavailable: true };
  }
}

async function showMissionSettingsPanel(host: SlashCommandHost): Promise<void> {
  const session = await loadMissionSessionGlance(host);
  const lines = buildMissionSettingsLines(session);

  const panel = new UsagePanelComponent({
    buildLines: (_fillProgress: number) => [...lines],
    borderToken: 'primary',
    title: ' Mission ',
    enterBeatSeed: 'mission',
    requestRender: () => {
      requestTUILayoutRender(host.state);
    },
  });
  host.state.transcriptContainer.addChild(panel);
  requestTUILayoutRender(host.state);
}
