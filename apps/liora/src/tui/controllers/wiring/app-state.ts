import type { CommandHubComponent } from '../../components/dialogs/command-hub/index';
import type { AppState, LivePaneState } from '../../types';
import { INITIAL_LIVE_PANE } from '../../types';
import type { TUIState } from '../../tui-state';
import { appearanceAnimationNow } from '../../features/appearance/appearance-effects';
import { requestTUIContentRender, requestTUILayoutRender } from '../../utils/render/frame-render';
import { isMotionTheatreActive, type MotionBeatController } from '../../utils/render/motion-beats';
import { hasPatchChanges } from '../../utils/object-patch';
import type { AppearanceController } from '../appearance/index';
import type { DialogsController } from '../dialogs/index';
import type { PromptIntelligenceController } from '../prompt/prompt-intelligence';
import type { SessionEventHandler } from '../session-event/handler';

function sameStringArrays(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Footer mode badge toggles → plan_enter/exit + mode_enter/exit (ultrawork, swarm, yolo). */
function collectFooterModeBeats(
  prev: AppState,
  patch: Partial<AppState>,
): Array<{
  readonly name: 'mode_enter' | 'mode_exit' | 'plan_enter' | 'plan_exit';
  readonly title: string;
}> {
  const beats: Array<{
    readonly name: 'mode_enter' | 'mode_exit' | 'plan_enter' | 'plan_exit';
    readonly title: string;
  }> = [];
  if ('planMode' in patch && patch.planMode !== undefined && patch.planMode !== prev.planMode) {
    beats.push({ name: patch.planMode ? 'plan_enter' : 'plan_exit', title: 'plan' });
  }
  if (
    'ultraworkMode' in patch &&
    patch.ultraworkMode !== undefined &&
    patch.ultraworkMode !== prev.ultraworkMode
  ) {
    beats.push({
      name: patch.ultraworkMode ? 'mode_enter' : 'mode_exit',
      title: 'ultrawork',
    });
  }
  if ('swarmMode' in patch && patch.swarmMode !== undefined && patch.swarmMode !== prev.swarmMode) {
    beats.push({ name: patch.swarmMode ? 'mode_enter' : 'mode_exit', title: 'swarm' });
  }
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
  readonly sessionEventHandler: SessionEventHandler;
  readonly promptIntelligence: PromptIntelligenceController;

  updateEditorBorderHighlight(text?: string): void;
  updateActivityPane(): void;
  updateQueueDisplay(): void;
  setupAutocomplete(): void;
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
    const becameIdle =
      'streamingPhase' in patch &&
      host.state.appState.streamingPhase !== 'idle' &&
      patch.streamingPhase === 'idle';
    const goalChanged = 'goal' in patch;
    const modeBeats = collectFooterModeBeats(host.state.appState, patch);
    Object.assign(host.state.appState, patch);
    if ('planMode' in patch || 'ultraworkMode' in patch) host.updateEditorBorderHighlight();
    if ('appearance' in patch) host.appearanceController.apply();
    if (
      host.openCommandHub !== undefined &&
      ('planMode' in patch ||
        'swarmMode' in patch ||
        'ultraworkMode' in patch ||
        'premiumQualityMode' in patch ||
        'permissionMode' in patch ||
        'model' in patch ||
        'thinkingLevel' in patch ||
        'streamingPhase' in patch ||
        'isCompacting' in patch)
    ) {
      host.dialogs.refreshOpenCommandHub();
    }
    const theatreActive = isMotionTheatreActive(host.state.appState);
    for (const beat of modeBeats) {
      const planBeat = beat.name === 'plan_enter' || beat.name === 'plan_exit';
      host.motionBeats.play({
        name: beat.name,
        seed: planBeat ? 'plan' : `mode:${beat.title}`,
        title: beat.title,
        nowMs: appearanceAnimationNow(),
        theatreActive,
      });
    }
    host.state.footer.setState(host.state.appState);
    host.state.header.setState(host.state.appState);
    if (goalChanged) {
      this.syncGoalMonitorPanel();
    }
    host.updateActivityPane();
    if (busyChanged) {
      host.updateQueueDisplay();
      host.sessionEventHandler.retryQueuedGoalPromotion();
    }
    if (additionalDirsChanged) host.setupAutocomplete();
    if (becameIdle) host.promptIntelligence.notifyIdle();
    requestTUIContentRender(host.state);
  }

  syncGoalMonitorPanel(): void {
    const { host } = this;
    host.state.todoPanel.setGoal(host.state.appState.goal);
    host.state.todoPanelContainer.clear();
    if (!host.state.todoPanel.isEmpty()) {
      host.state.todoPanelContainer.addChild(host.state.todoPanel);
    }
    requestTUILayoutRender(host.state);
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
    host.updateActivityPane();
    requestTUIContentRender(host.state);
  }
}
