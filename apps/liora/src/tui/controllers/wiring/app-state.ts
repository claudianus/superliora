import type { CommandHubComponent } from '../../components/dialogs/command-hub/index';
import type { AppState, LivePaneState } from '../../types';
import { EMPTY_TURN_ACTIVITY, INITIAL_LIVE_PANE } from '../../types';
import type { TUIState } from '../../tui-state';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import { requestTUIContentRender } from '../../utils/render/frame-render';
import type { MotionBeatController } from '../../utils/render/motion-beats';
import { hasPatchChanges } from '../../utils/object-patch';
import type { AppearanceController } from '../appearance/index';
import { DEFAULT_APPEARANCE_PREFERENCES, DEFAULT_PERFORMANCE_MODE } from '../../config';
import { resolveEffectiveAppearance } from '../../features/appearance/performance-mode';
import type { TranscriptDetailLevel } from '../../types';
import type { DialogsController } from '../dialogs/index';
import { syncTranscriptRegion } from '../../features/control-tower/timeline';

function sameStringArrays(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Permission badge transitions share the existing mode motion cues. */
function collectFooterModeBeats(
  prev: AppState,
  patch: Partial<AppState>,
): Array<{
  readonly name: 'mode_enter' | 'mode_exit';
  readonly title: string;
}> {
  const beats: Array<{
    readonly name: 'mode_enter' | 'mode_exit';
    readonly title: string;
  }> = [];
  if (
    'permissionMode' in patch &&
    patch.permissionMode !== undefined &&
    patch.permissionMode !== prev.permissionMode
  ) {
    const wasYolo = prev.permissionMode === 'yolo';
    const nowYolo = patch.permissionMode === 'yolo';
    if (wasYolo !== nowYolo) {
      beats.push({ name: nowYolo ? 'mode_enter' : 'mode_exit', title: 'yolo' });
    }
  }
  return beats;
}

/** Host surface required by app-state mutation and live-pane accessors. */
export interface AppStateHost {
  state: TUIState;
  openCommandHub: CommandHubComponent | undefined;
  readonly motionBeats: MotionBeatController;
  readonly appearanceController: AppearanceController;
  readonly dialogs: DialogsController;
  readonly workerDock: { pushView(): void; syncPreferences(): void };
  readonly jobBoardController?: { openDeck(jobId?: string): void };
  setAppState(patch: Partial<AppState>): void;

  updateEditorBorderHighlight(text?: string): void;
  updateActivityPane(): void;
  updateQueueDisplay(): void;
  setupAutocomplete(): void;
  setTranscriptDetail(level: TranscriptDetailLevel): void;
  setNeatMode(enabled: boolean): void;
}

/**
 * App-state patching, live-pane updates, and footer mode-beat side effects.
 * LioraTUI keeps thin public delegates so call sites stay stable.
 */
export class AppStateController {
  constructor(private readonly host: AppStateHost) {}

  supportsCurrentModelCapability(capability: string): boolean {
    const capabilities =
      this.host.state.appState.availableModels[this.host.state.appState.model]?.capabilities;
    if (capabilities === undefined) return true;
    return capabilities.includes(capability);
  }

  setAppState(patch: Partial<AppState>): void {
    const { host } = this;
    if (!hasPatchChanges(host.state.appState, patch)) return;
    const additionalDirsChanged =
      'additionalDirs' in patch &&
      !sameStringArrays(host.state.appState.additionalDirs, patch.additionalDirs ?? []);
    const busyChanged = 'streamingPhase' in patch || 'isCompacting' in patch;
    const conductorJobsChanged = 'conductorJobs' in patch;
    // Pure job-board telemetry (progress / liveActivity) should not rebuild
    // header, activity pane, autocomplete, or mode beats on every heartbeat.
    const onlyConductorJobs =
      conductorJobsChanged &&
      Object.keys(patch).every((key) => key === 'conductorJobs');
    const modeBeats = onlyConductorJobs
      ? []
      : collectFooterModeBeats(host.state.appState, patch);
    Object.assign(host.state.appState, patch);
    if (onlyConductorJobs) {
      host.workerDock.pushView();
      host.state.footer.setState(host.state.appState);
      host.appearanceController.refreshAmbientSchedule();
      requestTUIContentRender(host.state);
      return;
    }
    if ('appearance' in patch || 'performanceMode' in patch) {
      host.appearanceController.apply();
      // `mission_control` rides the appearance prefs; keep the panel's
      // pinned placeholder in sync no matter which command set it.
      host.workerDock.syncPreferences();
      // Mirror the boot-time overlay sync: when the performance mode flips
      // through a bare setAppState (config reload, session restore), the
      // effective density/neat must follow the overlay, not just the motion
      // pack. /performance goes through setTranscriptDetail itself; this
      // covers every other writer.
      if ('performanceMode' in patch) {
        const stored = host.state.appState.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;
        const mode = host.state.appState.performanceMode ?? DEFAULT_PERFORMANCE_MODE;
        const effective = resolveEffectiveAppearance(mode, stored);
        host.setTranscriptDetail(effective.transcriptDetail);
        host.setNeatMode(effective.neat);
      }
    }
    if ('transcriptRegionMode' in patch) {
      syncTranscriptRegion(host);
      host.state.persistSessionUiState?.();
    }
    // Resync ambient schedule when busy state flips so live clocks keep ticking
    // (and stop) without waiting for an appearance change.
    if (busyChanged) host.appearanceController.apply();
    if (
      host.openCommandHub !== undefined &&
      ('permissionMode' in patch ||
        'model' in patch ||
        'thinkingLevel' in patch ||
        'streamingPhase' in patch ||
        'isCompacting' in patch)
    ) {
      host.dialogs.refreshOpenCommandHub();
    }
    for (const beat of modeBeats) {
      host.motionBeats.play({
        name: beat.name,
        seed: `mode:${beat.title}`,
        title: beat.title,
        nowMs: appearanceAnimationNow(),
      });
    }
    host.state.footer.setState(host.state.appState);
    host.state.header.setState(host.state.appState);
    if (conductorJobsChanged) {
      // Job lanes live in Mission Control now — push the new ledger snapshot.
      host.workerDock.pushView();
      host.appearanceController.refreshAmbientSchedule();
    }
    host.updateActivityPane();
    if (busyChanged) {
      host.updateQueueDisplay();
    }
    if (additionalDirsChanged) host.setupAutocomplete();
    requestTUIContentRender(host.state);
  }


  patchLivePane(patch: Partial<LivePaneState>): void {
    const { host } = this;
    if (!hasPatchChanges(host.state.livePane, patch)) return;
    Object.assign(host.state.livePane, patch);
    host.updateActivityPane();
    requestTUIContentRender(host.state);
  }

  resetLivePane(): void {
    const { host } = this;
    host.state.livePane = { ...INITIAL_LIVE_PANE };
    host.state.turnActivity = { ...EMPTY_TURN_ACTIVITY };
    host.updateActivityPane();
    requestTUIContentRender(host.state);
  }
}
