import {
  SwarmStartPermissionPromptComponent,
  type SwarmStartPermissionChoice,
} from '../components/dialogs/swarm-start-permission-prompt';
import {
  UltraSwarmModeMarkerComponent,
} from '../components/messages/ultra-swarm-markers';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../constant/kimi-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

export async function handleUltraSwarmCommand(host: SlashCommandHost, args: string): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const prompt = args.trim();
  if (prompt.length === 0) {
    host.showError('Usage: /ultraswarm <task description> — e.g., /ultraswarm "Design a React component with accessibility and proper testing"');
    return;
  }

  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  if (host.state.appState.permissionMode === 'manual') {
    showUltraSwarmStartPermissionPrompt(host, `/ultraswarm ${prompt}`, 'UltraSwarm task not started.', (choice) =>
      startUltraSwarmWithPermission(host, prompt, choice),
    );
    return;
  }

  await startUltraSwarmTask(host, prompt);
}

function showUltraSwarmStartPermissionPrompt(
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

async function startUltraSwarmWithPermission(
  host: SlashCommandHost,
  prompt: string,
  choice: SwarmStartPermissionChoice,
): Promise<void> {
  if (choice === 'auto' || choice === 'yolo') {
    if (!(await setPermissionForUltraSwarm(host, choice))) return;
  }
  await startUltraSwarmTask(host, prompt);
}

async function setPermissionForUltraSwarm(host: SlashCommandHost, mode: 'auto' | 'yolo'): Promise<boolean> {
  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    host.showError(`Failed to set permission mode: ${formatErrorMessage(error)}`);
    return false;
  }
  host.setAppState({ permissionMode: mode });
  return true;
}

async function startUltraSwarmTask(host: SlashCommandHost, prompt: string): Promise<void> {
  if (!host.state.appState.swarmMode) {
    // Enable swarm mode for the UltraSwarm task
    try {
      await host.requireSession().setSwarmMode(true, 'task');
      host.setAppState({ swarmMode: true });
    } catch (error) {
      host.showError(`Failed to enable swarm mode: ${formatErrorMessage(error)}`);
      return;
    }
  }
  renderUltraSwarmModeMarker(host, 'active', prompt);
  host.sendNormalUserInput(`Summon UltraSwarm: ${prompt}`);
}


function renderUltraSwarmModeMarker(
  host: SlashCommandHost,
  state: 'active' | 'ended',
  taskDescription: string,
): void {
  host.state.transcriptContainer.addChild(
    new UltraSwarmModeMarkerComponent(state, 0, taskDescription),
  );
  host.state.ui.requestRender();
}
