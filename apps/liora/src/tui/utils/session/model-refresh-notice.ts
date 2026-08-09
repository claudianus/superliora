/**
 * Loop54a — surface provider model-catalog refresh failures as named notices.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export type ModelRefreshFailure = {
  readonly provider: string;
  readonly reason: string;
};

export type ModelRefreshNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: string;
};

export function formatModelRefreshFailureNotice(
  failure: ModelRefreshFailure,
): ModelRefreshNotice {
  const provider =
    failure.provider.trim().length > 0 ? failure.provider.trim() : 'provider';
  const reason =
    failure.reason.trim().length > 0 ? failure.reason.trim() : 'unknown error';
  return {
    title: ttui('tui.notice.modelRefreshSkipped.title'),
    detail: ttui('tui.notice.modelRefreshSkipped.detail', { provider, reason }),
    status: ttui('tui.notice.modelRefreshSkipped.status', { provider, reason }),
    coalesceKey: `model-refresh-failed-${provider}`,
  };
}

export function formatModelRefreshErrorNotice(message: string): ModelRefreshNotice {
  const text = message.trim().length > 0 ? message.trim() : 'unknown error';
  return {
    title: ttui('tui.notice.modelRefreshFailed.title'),
    detail: ttui('tui.notice.modelRefreshFailed.detail', { message: text }),
    status: ttui('tui.notice.modelRefreshFailed.status', { message: text }),
    coalesceKey: 'model-refresh-failed',
  };
}
