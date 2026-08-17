import { applyHostSetup } from '#/tui/utils/host-setup/apply-host-setup';
import { confirmHostSetup } from '#/tui/utils/host-setup/confirm-host-setup';
import {
  formatHostSetupApply,
  formatHostSetupStatus,
  loadHostSetupModule,
} from '#/tui/utils/terminal/host-setup-runtime';
import { ttui } from '#/tui/utils/tui-i18n';

import type { SlashCommandHost } from '../hub/dispatch';

export { formatHostSetupApply, formatHostSetupStatus };
export { applyHostSetup };

export function parseHostSetupAction(args: string): {
  readonly action: 'status' | 'apply' | 'unknown';
  readonly skipConfirm: boolean;
} {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const head = (tokens[0] ?? 'apply').toLowerCase();
  if (head === 'status') return { action: 'status', skipConfirm: false };
  if (head === 'apply' || head === 'yes' || head === '-y' || head === '--yes') {
    const rest = head === 'apply' ? tokens.slice(1) : tokens;
    const skipConfirm = rest.some((token) => {
      const value = token.toLowerCase();
      return value === 'yes' || value === '-y' || value === '--yes';
    }) || head === 'yes' || head === '-y' || head === '--yes';
    return { action: 'apply', skipConfirm };
  }
  return { action: 'unknown', skipConfirm: false };
}

export async function handleHostSetupCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const parsed = parseHostSetupAction(args);
  if (parsed.action === 'unknown') {
    host.showError(ttui('tui.hostSetup.usage'));
    return;
  }

  const mod = await loadHostSetupModule();
  if (mod === undefined) {
    host.showError(ttui('tui.hostSetup.missingInstaller'));
    return;
  }

  const plan = mod.planHostSetup();
  if (!plan.applicable) {
    host.showNotice(ttui('tui.notice.hostSetup.title'), ttui('tui.hostSetup.notSupported'));
    return;
  }

  if (parsed.action === 'status') {
    host.showNotice(ttui('tui.notice.hostSetup.title'), formatHostSetupStatus(plan), {
      coalesceKey: 'host-setup',
    });
    return;
  }

  const proceed = parsed.skipConfirm || (await confirmHostSetup(host, plan));
  if (!proceed) {
    host.showStatus(ttui('tui.hostSetup.cancelled'), 'info');
    return;
  }

  await applyHostSetup(host, mod);
}

/** @deprecated Prefer {@link handleHostSetupCommand}. */
export const handleWindowsSetupCommand = handleHostSetupCommand;
