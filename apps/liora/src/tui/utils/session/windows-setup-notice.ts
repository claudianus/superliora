import { ttui } from '#/tui/utils/tui-i18n';

export type HostSetupNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: 'host-setup';
};

export function formatHostSetupHintNotice(): HostSetupNotice {
  return {
    title: ttui('tui.notice.hostSetup.title'),
    detail: ttui('tui.notice.hostSetup.detail'),
    status: ttui('tui.notice.hostSetup.status'),
    coalesceKey: 'host-setup',
  };
}

/** @deprecated Prefer {@link formatHostSetupHintNotice}. */
export const formatWindowsSetupHintNotice = formatHostSetupHintNotice;
