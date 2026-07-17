import { NO_ACTIVE_SESSION_MESSAGE } from '../constant/liora-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';
import { ttui } from '#/tui/utils/tui-i18n';

export async function handlePremiumQualityCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }

  const subcmd = args.trim().toLowerCase();
  const current = host.state.appState.premiumQualityMode === true;

  if (subcmd === 'on') {
    if (current) {
      host.showNotice(ttui('tui.premium.alreadyOn'));
      return;
    }
    await applyPremiumQuality(host, true);
    return;
  }

  if (subcmd === 'off') {
    if (!current) {
      host.showNotice(ttui('tui.premium.alreadyOff'));
      return;
    }
    await applyPremiumQuality(host, false);
    return;
  }

  if (subcmd === 'status' || subcmd.length === 0) {
    host.showNotice(
      current ? ttui('tui.premium.on.title') : ttui('tui.premium.off.title'),
      current ? ttui('tui.premium.on.detail') : undefined,
    );
    return;
  }

  host.showError(ttui('tui.premium.usage'));
}

export async function applyPremiumQuality(
  host: SlashCommandHost,
  enabled: boolean,
): Promise<void> {
  const session = host.session;
  if (session === undefined) {
    host.showError(NO_ACTIVE_SESSION_MESSAGE);
    return;
  }
  try {
    await session.setPremiumQuality(enabled);
    host.setAppState({ premiumQualityMode: enabled });
    host.showNotice(
      enabled ? ttui('tui.premium.on.title') : ttui('tui.premium.off.title'),
      enabled ? ttui('tui.premium.on.detail.apply') : undefined,
      { coalesceKey: 'premium-quality-mode' },
    );
  } catch (error) {
    host.showError(ttui('tui.premium.setFailed', { message: formatErrorMessage(error) }));
  }
}
