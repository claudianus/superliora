import type { PermissionMode } from '@moonshot-ai/kimi-code-sdk';

import {
  SwarmStartPermissionPromptComponent,
  type SwarmStartPermissionChoice,
} from '../components/dialogs/swarm-start-permission-prompt';
import { UltraworkModeMarkerComponent } from '../components/messages/ultrawork-markers';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/kimi-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';
import {
  buildUltraworkPrompt,
  parseUltraworkCommand,
  shouldAutoActivateUltrawork,
  type UltraworkActivationSource,
  type UltraworkCreateRequest,
} from './ultrawork-contract';

interface UltraworkSetupState {
  readonly planModeWasEnabled: boolean;
  readonly swarmModeWasEnabled: boolean;
  readonly ultraworkModeWasEnabled: boolean;
  readonly previousSwarmModeEntry: 'manual' | 'task' | undefined;
  planChanged: boolean;
  swarmEnabled: boolean;
}

const ULTRAWORK_ACTIVITY_TIP =
  'Ultrawork mode: UltraPlan interview first, then verifiable UltraGoal, Swarm decision, verify';

export {
  buildUltraworkPrompt,
  parseUltraworkCommand,
  shouldAutoActivateUltrawork,
  type UltraworkActivationSource,
};

export async function handleUltraworkCommand(
  host: SlashCommandHost,
  args: string,
  source: UltraworkActivationSource = 'manual',
): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const parsed = parseUltraworkCommand(args);
  if (parsed.kind === 'error') {
    if (parsed.severity === 'hint') host.showStatus(parsed.message);
    else host.showError(parsed.message);
    return;
  }

  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  if (host.state.appState.permissionMode === 'manual') {
    const commandText = source === 'auto' ? args : `/ultrawork ${args.trim()}`;
    showUltraworkStartPermissionPrompt(
      host,
      commandText,
      'Ultrawork not started.',
      async (choice) => {
        await startUltraworkWithPermission(host, parsed, source, choice);
      },
    );
    return;
  }

  await startUltrawork(host, parsed, source);
}

export async function handleUltraworkModeToggle(
  host: SlashCommandHost,
  enabled: boolean,
): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }
  try {
    if (enabled) {
      await forceUltraPlanMode(host.requireSession());
    } else {
      await host.requireSession().setPlanMode(false, false);
    }
  } catch (error) {
    host.showError(`Failed to ${enabled ? 'enable' : 'disable'} Ultrawork mode: ${formatErrorMessage(error)}`);
    return;
  }
  host.setAppState({
    planMode: enabled,
    ultraworkMode: enabled,
    activityTip: enabled ? ULTRAWORK_ACTIVITY_TIP : null,
  });
  host.showNotice(
    enabled ? 'Ultrawork mode: ON' : 'Ultrawork mode: OFF',
    enabled
      ? 'Shift-Tab routes the next task through UltraPlan before any UltraGoal or Swarm work.'
      : undefined,
  );
}

function showUltraworkStartPermissionPrompt(
  host: SlashCommandHost,
  commandText: string,
  cancelStatus: string,
  onSelect: (choice: SwarmStartPermissionChoice) => Promise<void>,
): void {
  const cancelStart = (): void => {
    host.restoreInputText(commandText);
    host.showStatus(cancelStatus);
  };
  host.mountEditorReplacement(
    new SwarmStartPermissionPromptComponent({
      onSelect: (choice) => {
        host.restoreEditor();
        void onSelect(choice);
      },
      onCancel: cancelStart,
    }),
  );
}

async function startUltraworkWithPermission(
  host: SlashCommandHost,
  request: UltraworkCreateRequest,
  source: UltraworkActivationSource,
  choice: SwarmStartPermissionChoice,
): Promise<void> {
  if ((choice === 'auto' || choice === 'yolo') && !(await setPermissionForUltrawork(host, choice))) {
    return;
  }
  await startUltrawork(host, request, source);
}

async function startUltrawork(
  host: SlashCommandHost,
  request: UltraworkCreateRequest,
  source: UltraworkActivationSource,
): Promise<void> {
  const setup: UltraworkSetupState = {
    planModeWasEnabled: host.state.appState.planMode,
    swarmModeWasEnabled: host.state.appState.swarmMode,
    ultraworkModeWasEnabled: host.state.appState.ultraworkMode ?? false,
    previousSwarmModeEntry: host.state.swarmModeEntry,
    planChanged: false,
    swarmEnabled: false,
  };
  try {
    await prepareUltraworkSetup(host, setup);
  } catch (error) {
    await rollbackUltraworkSetup(host, setup);
    host.showError(`Failed to start ultrawork: ${formatErrorMessage(error)}`);
    return;
  }

  host.track('ultrawork_start', { source, replace: request.replace });
  host.setAppState({ activityTip: ULTRAWORK_ACTIVITY_TIP });
  host.state.transcriptContainer.addChild(
    new UltraworkModeMarkerComponent('active', request.objective),
  );
  host.state.ui.requestRender();
  host.sendNormalUserInput(buildUltraworkPrompt(request.objective, source, request.replace), {
    displayText: request.objective,
  });
}

async function setPermissionForUltrawork(
  host: SlashCommandHost,
  mode: PermissionMode,
): Promise<boolean> {
  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    host.showError(`Failed to set permission mode: ${formatErrorMessage(error)}`);
    return false;
  }
  host.setAppState({ permissionMode: mode });
  return true;
}

async function prepareUltraworkSetup(
  host: SlashCommandHost,
  setup: UltraworkSetupState,
): Promise<void> {
  const session = host.requireSession();
  if (!setup.swarmModeWasEnabled) {
    await session.setSwarmMode(true, 'task');
    setup.swarmEnabled = true;
    host.setAppState({ swarmMode: true });
    host.state.swarmModeEntry = 'task';
  }
  await forceUltraPlanMode(session);
  setup.planChanged = true;
  host.setAppState({ planMode: true, ultraworkMode: true });
}

async function forceUltraPlanMode(session: ReturnType<SlashCommandHost['requireSession']>): Promise<void> {
  try {
    await session.setPlanMode(true, true);
  } catch (error) {
    if (!formatErrorMessage(error).includes('Already in plan mode')) throw error;
    await session.setPlanMode(false, false);
    await session.setPlanMode(true, true);
  }
}

async function rollbackUltraworkSetup(
  host: SlashCommandHost,
  setup: UltraworkSetupState,
): Promise<void> {
  const session = host.requireSession();
  if (setup.planChanged) {
    await session.setPlanMode(setup.planModeWasEnabled, false).catch(() => {});
    host.setAppState({
      planMode: setup.planModeWasEnabled,
      ultraworkMode: setup.ultraworkModeWasEnabled,
    });
  }
  if (setup.swarmEnabled) {
    await session.setSwarmMode(false, 'task').catch(() => {});
    host.setAppState({ swarmMode: setup.swarmModeWasEnabled });
    host.state.swarmModeEntry = setup.previousSwarmModeEntry;
  }
}
