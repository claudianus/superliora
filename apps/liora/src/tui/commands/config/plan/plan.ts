import type { Session } from '@superliora/sdk';

import {  NO_ACTIVE_SESSION_MESSAGE } from '../../../constant/liora-tui';
import { formatErrorMessage } from '../../../utils/event-payload';
import type { SlashCommandHost } from '../../hub/dispatch';
import { resolvePlanActivation } from '#/tui/utils/plan-activation';
import { ttui } from '../../../utils/tui-i18n';

export async function handlePlanCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE());
    return;
  }

  const subcmd = args.trim().toLowerCase();
  if (subcmd === 'clear') {
    await session.clearPlan();
    host.showNotice(ttui('tui.plan.cleared'));
    return;
  }

  let enabled: boolean;
  let ultra = false;
  if (subcmd.length === 0) enabled = !host.state.appState.planMode;
  else if (subcmd === 'on') enabled = true;
  else if (subcmd === 'off') enabled = false;
  else if (subcmd === 'ultra') {
    enabled = true;
    ultra = true;
  }
  else {
    host.showError(ttui('tui.plan.unknownSub', { subcmd }));
    return;
  }

  await applyPlanMode(host, session, enabled, ultra);
}

async function applyPlanMode(host: SlashCommandHost, session: Session, enabled: boolean, ultra = false): Promise<void> {
  try {
    await session.setPlanMode(enabled, ultra);
    if (!enabled) {
      host.setAppState({ planMode: false, activityTip: null });
      host.showNotice(ttui('tui.plan.off'));
      return;
    }
    // Conductor Plan Desk: enterPlan with task context delegates to a mission
    // Job instead of activating plan mode here — reflect that in AppState.
    const activation = await resolvePlanActivation(session);
    host.setAppState({
      // An unreadable status counts as on: `setPlanMode` already succeeded, and
      // a stale `false` would make the next bare `/plan` re-enter instead of
      // toggling off.
      planMode: activation !== 'delegated',
      activityTip:
        activation === 'delegated'
          ? 'Plan Desk: planning Job accepted — watch Job strip / inbox'
          : null,
    });
    if (activation === 'inline') {
      const plan = await session.getPlan().catch(() => null);
      host.showNotice(
        ultra ? 'Plan mode: ON (structured pipeline)' : 'Plan mode: ON (free-form)',
        plan?.path !== undefined ? `Plan file: ${plan.path}` : undefined,
      );
      return;
    }
    if (activation === 'unknown') {
      host.showNotice(
        'Plan mode requested',
        'Could not read session status — check the footer or /status for where planning landed.',
      );
      return;
    }
    host.showNotice(
      'Plan Desk: planning delegated to a Job',
      'Conductor stays free — plan worker runs research/interview. Check Job strip / JobInbox.',
    );
  } catch (error) {
    const msg = formatErrorMessage(error);
    host.showError(ttui('tui.plan.setFailed', { message: msg }));
  }
}

export async function handleCompactCommand(host: SlashCommandHost, args: string): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE());
    return;
  }
  const customInstruction = args.trim() || undefined;
  await session.compact({ instruction: customInstruction });
}
