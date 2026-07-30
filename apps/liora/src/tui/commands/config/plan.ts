import type { Session } from '@superliora/sdk';

import { NO_ACTIVE_SESSION_MESSAGE } from '../../constant/liora-tui';
import { formatErrorMessage } from '../../utils/event-payload';
import type { SlashCommandHost } from '../hub/dispatch';
import { isActiveUltraworkRun, ultraworkModeDisableBlockedMessage } from '../ultrawork/ultrawork-contract';

export async function handlePlanCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  if (subcmd === 'clear') {
    await session.clearPlan();
    host.showNotice('Plan cleared');
    return;
  }

  let enabled: boolean;
  let ultra = false;
  if (subcmd.length === 0) enabled = !host.state.appState.planMode;
  else if (subcmd === 'on') enabled = true;
  else if (subcmd === 'off') enabled = false;
  else if (subcmd === 'ultra') {
    // Internal path for Shift+Tab shortcut; prefer /ultraplan for explicit use.
    enabled = true;
    ultra = true;
  }
  else {
    host.showError(`Unknown plan subcommand: ${subcmd}. Use on, off, or clear.`);
    return;
  }

  await applyPlanMode(host, session, enabled, ultra);
}

async function applyPlanMode(host: SlashCommandHost, session: Session, enabled: boolean, ultra = false): Promise<void> {
  if (!enabled) {
    const run = await session.getUltraworkRun();
    if (isActiveUltraworkRun(run)) {
      host.showError(ultraworkModeDisableBlockedMessage(run));
      return;
    }
  }
  try {
    await session.setPlanMode(enabled, ultra);
    host.setAppState({ planMode: enabled, ultraworkMode: false, activityTip: null });
    if (enabled) {
      const plan = await session.getPlan().catch(() => null);
      host.showNotice(
        ultra ? 'UltraPlan mode: ON (structured pipeline)' : 'Plan mode: ON (free-form)',
        plan?.path !== undefined ? `Plan file: ${plan.path}` : undefined,
      );
      return;
    }
    host.showNotice('Plan mode: OFF');
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(`Failed to set plan mode: ${msg}`);
  }
}

export async function handleCompactCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  const customInstruction = args.trim() || undefined;
  await session.compact({ instruction: customInstruction });
}
