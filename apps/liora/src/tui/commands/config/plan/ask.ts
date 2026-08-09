import {  NO_ACTIVE_SESSION_MESSAGE } from '../../../constant/liora-tui';
import { formatErrorMessage } from '../../../utils/event-payload';
import { ttui } from '../../../utils/tui-i18n';
import type { SlashCommandHost } from '../../hub/dispatch';

export async function handleAskCommand(host: SlashCommandHost, args: string): Promise<void> {
  const subcmd = args.trim().toLowerCase();
  let enabled: boolean;
  if (subcmd.length === 0) enabled = !host.state.appState.askMode;
  else if (subcmd === 'on') enabled = true;
  else if (subcmd === 'off') enabled = false;
  else {
    host.showError(ttui('tui.ask.unknownSub', { subcmd }));
    return;
  }
  await setAskMode(host, enabled);
}

/** Shared by `/ask` and the Shift-Tab Build/Ask cycle. */
export async function setAskMode(host: SlashCommandHost, enabled: boolean): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE());
    return;
  }
  try {
    await session.setAskMode(enabled);
  } catch (error) {
    host.showError(ttui('tui.ask.setFailed', { message: formatErrorMessage(error) }));
    return;
  }
  // Ask mode cancels plan mode on the agent side; mirror that here so the
  // footer does not keep showing a plan badge that is no longer active.
  host.setAppState(enabled ? { askMode: true, planMode: false } : { askMode: false });
  host.showNotice(
    enabled ? 'Ask mode: ON' : 'Build mode',
    enabled
      ? 'Reads, search, and web lookups only — edits and worker delegation are blocked.'
      : undefined,
  );
}
