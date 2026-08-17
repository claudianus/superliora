import { ttui } from '#/tui/utils/tui-i18n';

import {
  formatHostSetupApply,
  type HostSetupModule,
} from '../terminal/host-setup-runtime';

export type HostSetupApplyHost = {
  showStatus(msg: string, color?: 'info' | 'success' | 'warning' | 'error'): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  showError?(msg: string): void;
  aborted?: boolean;
};

export async function applyHostSetup(
  host: HostSetupApplyHost,
  mod: HostSetupModule,
): Promise<void> {
  host.showStatus(ttui('tui.hostSetup.applying'), 'info');
  try {
    const result = await mod.ensureHostSetup();
    if (host.aborted) return;
    const detail = formatHostSetupApply(result);
    host.showNotice(ttui('tui.notice.hostSetup.title'), detail, {
      coalesceKey: 'host-setup',
    });
    host.showStatus(
      result.ok === false ? ttui('tui.hostSetup.applyFailed') : ttui('tui.hostSetup.applyOk'),
      result.ok === false ? 'warning' : 'success',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const text = `${ttui('tui.hostSetup.applyFailed')}\n${message}`;
    if (host.showError) host.showError(text);
    else host.showStatus(text, 'error');
  }
}
