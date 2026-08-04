import type { Session } from '@superliora/sdk';

import { NO_ACTIVE_SESSION_MESSAGE } from '../../../constant/liora-tui';
import { formatErrorMessage } from '../../../utils/event-payload';
import type { SlashCommandHost } from '../../hub/dispatch';
import {
  isActiveMissionRun,
  missionModeDisableBlockedMessage,
} from '#/tui/utils/mission/mission-contract';

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
    if (isActiveMissionRun(run)) {
      host.showError(missionModeDisableBlockedMessage(run));
      return;
    }
  }
  try {
    await session.setPlanMode(enabled, ultra);
    if (!enabled) {
      host.setAppState({ planMode: false, ultraworkMode: false, activityTip: null });
      host.showNotice('Plan mode: OFF');
      return;
    }
    // Conductor Plan Desk: enterPlan delegates to a mission Job and does not
    // activate plan mode on the main agent — reflect that in AppState.
    const status = await session.getStatus().catch(() => null);
    const actuallyOn = status?.planMode === true;
    host.setAppState({
      planMode: actuallyOn,
      ultraworkMode: false,
      activityTip: actuallyOn
        ? null
        : 'Plan Desk: planning Job accepted — watch Job strip / inbox',
    });
    if (actuallyOn) {
      const plan = await session.getPlan().catch(() => null);
      host.showNotice(
        ultra ? 'Plan mode: ON (structured pipeline)' : 'Plan mode: ON (free-form)',
        plan?.path !== undefined ? `Plan file: ${plan.path}` : undefined,
      );
      return;
    }
    host.showNotice(
      'Plan Desk: planning delegated to a Job',
      'Conductor stays free — plan worker runs research/interview. Check Job strip / JobInbox.',
    );
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
