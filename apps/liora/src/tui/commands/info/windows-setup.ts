import {
  formatWindowsSetupApply,
  formatWindowsSetupStatus,
  loadTerminalModule,
} from '#/tui/utils/terminal/windows-setup-runtime';
import { ttui } from '#/tui/utils/tui-i18n';

import type { SlashCommandHost } from '../hub/dispatch';

export { formatWindowsSetupApply, formatWindowsSetupStatus };

export async function handleWindowsSetupCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  const action = (args.trim().split(/\s+/)[0] || 'status').toLowerCase();
  if (action !== 'status' && action !== 'apply') {
    host.showError(ttui('tui.windowsSetup.usage'));
    return;
  }

  const mod = await loadTerminalModule();
  if (mod === undefined) {
    host.showError(ttui('tui.windowsSetup.missingInstaller'));
    return;
  }

  const probe = mod.probeWindowsTerminalEnv();
  if (!probe.applicable) {
    host.showNotice(ttui('tui.notice.windowsSetup.title'), ttui('tui.windowsSetup.notWindows'));
    return;
  }

  if (action === 'status') {
    host.showNotice(ttui('tui.notice.windowsSetup.title'), formatWindowsSetupStatus(probe), {
      coalesceKey: 'windows-setup',
    });
    return;
  }

  host.showStatus(ttui('tui.windowsSetup.applying'), 'info');
  try {
    const result = await mod.ensureTerminal();
    const detail = formatWindowsSetupApply(result);
    host.showNotice(ttui('tui.notice.windowsSetup.title'), detail, {
      coalesceKey: 'windows-setup',
    });
    host.showStatus(
      result.ok === false ? ttui('tui.windowsSetup.applyFailed') : ttui('tui.windowsSetup.applyOk'),
      result.ok === false ? 'warning' : 'success',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    host.showError(`${ttui('tui.windowsSetup.applyFailed')}\n${message}`);
  }
}
