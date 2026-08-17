import { ttui } from '#/tui/utils/tui-i18n';

export type WindowsSetupNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'windows-setup';
};

export function formatWindowsSetupHintNotice(): WindowsSetupNotice {
  return {
    title: ttui('tui.notice.windowsSetup.title'),
    detail: ttui('tui.notice.windowsSetup.detail'),
    status: ttui('tui.notice.windowsSetup.status'),
    coalesceKey: 'windows-setup',
  };
}
