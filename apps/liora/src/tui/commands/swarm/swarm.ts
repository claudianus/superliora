import type { PermissionMode } from '@superliora/sdk';

import { WarRoomExpertPickerComponent } from '../../components/dialogs/war-room-expert-picker';
import { WarRoomTranscriptPanelComponent } from '../../components/dialogs/war-room-transcript-panel';
import {
  SwarmStartPermissionPromptComponent,
  type SwarmStartPermissionChoice,
} from '../../components/dialogs/goal/swarm-start-permission-prompt';
import {
  SwarmModeMarkerComponent,
  type SwarmModeMarkerState,
} from '../../components/messages/swarm-markers';
import { LLM_NOT_SET_MESSAGE, NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import {
  resolveWarRoomReason,
  type WarRoomDockAction,
} from '../../features/agent-swarm/war-room-action';
import {
  formatSessionTraceLines,
  matchWarRoomExpert,
  warRoomExpertLabel,
  warRoomMessageMode,
  type WarRoomExpertView,
} from '../../utils/war-room-experts';
import type { SlashCommandHost } from '../hub/dispatch';

type WarRoomHost = SlashCommandHost & {
  readonly sessionEventHandler?: {
    invokeWarRoomAction?: (
      action: WarRoomDockAction,
      options?: { readonly reason?: string },
    ) => number;
    listWarRoomExperts?: () => readonly WarRoomExpertView[];
  };
};

export async function handleSwarmCommand(host: SlashCommandHost, args: string): Promise<void> {
  if (host.session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const prompt = args.trim();
  const talk = warRoomTalkSubcommand(prompt);
  if (talk !== undefined) {
    await openWarRoomTalk(host as WarRoomHost, talk.query);
    return;
  }

  const message = warRoomMessageSubcommand(prompt);
  if (message !== undefined) {
    await sendWarRoomMessage(host as WarRoomHost, message.expertQuery, message.text);
    return;
  }

  const warRoom = warRoomDockSubcommand(prompt);
  if (warRoom !== undefined) {
    invokeWarRoomDockAction(host as WarRoomHost, warRoom.action, warRoom.reason);
    return;
  }

  const mode = swarmModeSubcommand(prompt);
  if (mode !== undefined) {
    await applySwarmMode(host, mode, `/swarm ${prompt}`);
    return;
  }

  if (prompt.length === 0) {
    await applySwarmMode(host, !host.state.appState.swarmMode, '/swarm');
    return;
  }

  if (host.state.appState.model.trim().length === 0) {
    host.showError(LLM_NOT_SET_MESSAGE);
    return;
  }

  if (host.state.appState.permissionMode === 'manual') {
    showSwarmStartPermissionPrompt(host, `/swarm ${prompt}`, 'Swarm task not started.', (choice) =>
      startSwarmWithPermission(host, prompt, choice),
    );
    return;
  }

  await startSwarmTask(host, prompt);
}

function showSwarmStartPermissionPrompt(
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

async function startSwarmWithPermission(
  host: SlashCommandHost,
  prompt: string,
  choice: SwarmStartPermissionChoice,
): Promise<void> {
  if (choice === 'auto' || choice === 'yolo') {
    if (!(await setPermissionForSwarm(host, choice))) return;
  }
  await startSwarmTask(host, prompt);
}

async function setPermissionForSwarm(host: SlashCommandHost, mode: PermissionMode): Promise<boolean> {
  try {
    await host.requireSession().setPermission(mode);
  } catch (error) {
    host.showError(`Failed to set permission mode: ${formatErrorMessage(error)}`);
    return false;
  }
  host.setAppState({ permissionMode: mode });
  return true;
}

async function startSwarmTask(host: SlashCommandHost, prompt: string): Promise<void> {
  if (!host.state.appState.swarmMode && !(await setSwarmMode(host, true, 'task'))) {
    return;
  }
  renderSwarmModeMarker(host, 'active');
  host.sendNormalUserInput(prompt);
}

async function applySwarmMode(
  host: SlashCommandHost,
  enabled: boolean,
  commandText: string,
): Promise<void> {
  if (enabled && host.state.appState.swarmMode) {
    host.showStatus('Swarm mode is already on.');
    return;
  }
  if (!enabled && !host.state.appState.swarmMode) {
    host.showStatus('Swarm mode is already off.');
    return;
  }
  if (enabled && host.state.appState.permissionMode === 'manual') {
    showSwarmStartPermissionPrompt(host, commandText, 'Swarm mode not enabled.', async (choice) => {
      if ((choice === 'auto' || choice === 'yolo') && !(await setPermissionForSwarm(host, choice))) {
        return;
      }
      if (!(await setSwarmMode(host, true, 'manual'))) return;
      renderSwarmModeMarker(host, 'active');
    });
    return;
  }
  if (!(await setSwarmMode(host, enabled, 'manual'))) return;
  renderSwarmModeMarker(host, enabled ? 'active' : 'inactive');
}

async function setSwarmMode(
  host: SlashCommandHost,
  enabled: boolean,
  trigger: 'manual' | 'task',
): Promise<boolean> {
  try {
    await host.requireSession().setSwarmMode(enabled, trigger);
  } catch (error) {
    host.showError(
      `Failed to ${enabled ? 'enable' : 'disable'} swarm mode: ${formatErrorMessage(error)}`,
    );
    return false;
  }
  host.setAppState({ swarmMode: enabled });
  host.state.swarmModeEntry = enabled ? trigger : undefined;
  return true;
}

function swarmModeSubcommand(input: string): boolean | undefined {
  const command = input.toLowerCase();
  if (command === 'on') return true;
  if (command === 'off') return false;
  return undefined;
}

function warRoomTalkSubcommand(input: string): { readonly query: string } | undefined {
  const [head, ...rest] = input.split(/\s+/);
  if ((head ?? '').toLowerCase() !== 'talk') return undefined;
  return { query: rest.join(' ').trim() };
}

function warRoomMessageSubcommand(
  input: string,
): { readonly expertQuery: string; readonly text: string } | undefined {
  const [head, expertQuery, ...rest] = input.split(/\s+/);
  const command = (head ?? '').toLowerCase();
  if (command !== 'msg' && command !== 'message') return undefined;
  if (expertQuery === undefined || expertQuery.length === 0) {
    return { expertQuery: '', text: '' };
  }
  return { expertQuery, text: rest.join(' ').trim() };
}

function warRoomDockSubcommand(
  input: string,
): { readonly action: WarRoomDockAction; readonly reason: string } | undefined {
  const [head, ...rest] = input.split(/\s+/);
  const command = (head ?? '').toLowerCase();
  if (command !== 'pause' && command !== 'restaff' && command !== 'raw') return undefined;
  const freeText = rest.join(' ').trim();
  if (command === 'raw') {
    return { action: 'raw', reason: freeText };
  }
  return {
    action: command,
    reason: resolveWarRoomReason(command, freeText.length > 0 ? freeText : undefined),
  };
}

function listExperts(host: WarRoomHost): readonly WarRoomExpertView[] | undefined {
  const list = host.sessionEventHandler?.listWarRoomExperts;
  if (list === undefined) return undefined;
  return list();
}

async function openWarRoomTalk(host: WarRoomHost, query: string): Promise<void> {
  const experts = listExperts(host);
  if (experts === undefined) {
    host.showError('War Room talk is unavailable in this host.');
    return;
  }
  if (experts.length === 0) {
    host.showError('No Fleet / AgentSwarm war room experts to talk to.');
    return;
  }

  if (query.length > 0) {
    const expert = matchWarRoomExpert(experts, query);
    if (expert === undefined) {
      host.showError(`No War Room expert matches "${query}".`);
      return;
    }
    await showWarRoomTranscript(host, expert);
    return;
  }

  host.mountEditorReplacement(
    new WarRoomExpertPickerComponent({
      experts,
      onSelect: (expert) => {
        host.restoreEditor();
        void showWarRoomTranscript(host, expert);
      },
      onCancel: () => {
        host.restoreEditor();
        host.showStatus('War Room talk cancelled.');
      },
    }),
  );
}

async function showWarRoomTranscript(
  host: WarRoomHost,
  expert: WarRoomExpertView,
): Promise<void> {
  if (expert.agentId === undefined || expert.agentId.length === 0) {
    host.showError(
      `${warRoomExpertLabel(expert)} has no agent session yet — wait until they join the war room.`,
    );
    return;
  }

  const session = host.requireSession();
  let lines: readonly string[] = [];
  let loadError: string | undefined;
  try {
    const trace = await host.harness.withInteractiveAgent(expert.agentId, () =>
      session.getSessionTrace(),
    );
    lines = formatSessionTraceLines(trace.context.history);
  } catch (caught) {
    loadError = `Could not load transcript: ${formatErrorMessage(caught)}`;
  }

  host.mountEditorReplacement(
    new WarRoomTranscriptPanelComponent({
      expert,
      lines,
      error: loadError,
      onMessage: (text) => {
        host.restoreEditor();
        void deliverWarRoomMessage(host, expert, text);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

async function sendWarRoomMessage(
  host: WarRoomHost,
  expertQuery: string,
  text: string,
): Promise<void> {
  if (expertQuery.length === 0 || text.length === 0) {
    host.showError('Usage: /swarm msg <expert> <message>');
    return;
  }
  const experts = listExperts(host);
  if (experts === undefined) {
    host.showError('War Room messaging is unavailable in this host.');
    return;
  }
  if (experts.length === 0) {
    host.showError('No Fleet / AgentSwarm war room experts to message.');
    return;
  }
  const expert = matchWarRoomExpert(experts, expertQuery);
  if (expert === undefined) {
    host.showError(`No War Room expert matches "${expertQuery}".`);
    return;
  }
  await deliverWarRoomMessage(host, expert, text);
}

async function deliverWarRoomMessage(
  host: WarRoomHost,
  expert: WarRoomExpertView,
  text: string,
): Promise<void> {
  if (expert.agentId === undefined || expert.agentId.length === 0) {
    host.showError(
      `${warRoomExpertLabel(expert)} has no agent session yet — wait until they join the war room.`,
    );
    return;
  }
  const session = host.requireSession();
  const mode = warRoomMessageMode(expert.phase);
  try {
    await host.harness.withInteractiveAgent(expert.agentId, async () => {
      if (mode === 'steer') {
        await session.steer(text);
      } else {
        await session.prompt(text);
      }
    });
  } catch (error) {
    host.showError(
      `Failed to ${mode} ${warRoomExpertLabel(expert)}: ${formatErrorMessage(error)}`,
    );
    return;
  }
  host.showStatus(
    mode === 'steer'
      ? `Steered ${warRoomExpertLabel(expert)}.`
      : `Messaged ${warRoomExpertLabel(expert)}.`,
  );
}

function invokeWarRoomDockAction(
  host: WarRoomHost,
  action: WarRoomDockAction,
  reason: string,
): void {
  const invoke = host.sessionEventHandler?.invokeWarRoomAction;
  if (invoke === undefined) {
    host.showError('War Room actions are unavailable in this host.');
    return;
  }
  const count = invoke(action, reason.length > 0 ? { reason } : {});
  if (count === 0) {
    host.showError('No active Fleet / AgentSwarm war room to control.');
    return;
  }
  if (action === 'pause') {
    host.showStatus(`Paused ${String(count)} active swarm war room(s).`);
    return;
  }
  if (action === 'restaff') {
    host.showStatus(`Requested restaff on ${String(count)} active swarm war room(s).`);
    return;
  }
  host.showStatus(`Toggled raw feed on ${String(count)} active swarm war room(s).`);
}

function renderSwarmModeMarker(host: SlashCommandHost, state: SwarmModeMarkerState): void {
  host.state.transcriptContainer.addChild(
    new SwarmModeMarkerComponent(state),
  );
  requestTUILayoutRender(host.state);
}
