import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

export async function handleOrchestratorCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  const current = host.state.appState.orchestratorMode === true;

  if (subcmd === 'on') {
    if (current) {
      host.showNotice('Orchestrator mode is already on.');
      return;
    }
    await applyOrchestratorMode(host, true);
    return;
  }

  if (subcmd === 'off') {
    if (!current) {
      host.showNotice('Orchestrator mode is already off.');
      return;
    }
    await applyOrchestratorMode(host, false);
    return;
  }

  if (subcmd === 'status' || subcmd.length === 0) {
    host.showNotice(
      current
        ? 'Orchestrator mode is ON — work is delegated to background workers.'
        : 'Orchestrator mode is OFF — the agent handles tasks directly.',
      current
        ? 'Use /orchestrator off to return to direct mode.'
        : 'Use /orchestrator on to delegate work to parallel workers.',
    );
    return;
  }

  host.showError('Usage: /orchestrator [on|off|status]');
}

async function applyOrchestratorMode(
  host: SlashCommandHost,
  enabled: boolean,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  try {
    await session.setOrchestratorMode(enabled);
    host.setAppState({ orchestratorMode: enabled });
    host.showNotice(
      enabled
        ? 'Orchestrator mode enabled — tasks will be delegated to background workers.'
        : 'Orchestrator mode disabled — returning to direct execution.',
      enabled
        ? 'The agent will classify intent, spawn workers in isolated worktrees, and report back.'
        : undefined,
      { coalesceKey: 'orchestrator-mode' },
    );
  } catch (error) {
    host.showError(
      `Failed to ${enabled ? 'enable' : 'disable'} orchestrator mode: ${formatErrorMessage(error)}`,
    );
  }
}
