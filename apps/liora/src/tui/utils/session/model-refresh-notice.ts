/**
 * Loop54a — surface provider model-catalog refresh failures as named notices.
 *
 * Startup/background and /model refresh previously only flashed
 * `Skipped refreshing …` on the status line.
 */

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
    title: 'Model catalog refresh skipped',
    detail: `Could not refresh models for ${provider}: ${reason}. Existing catalog entries stay available. Check auth/network for that provider, then retry /model or restart.`,
    status: `Skipped refreshing ${provider}: ${reason}`,
    coalesceKey: `model-refresh-failed-${provider}`,
  };
}

export function formatModelRefreshErrorNotice(message: string): ModelRefreshNotice {
  const text = message.trim().length > 0 ? message.trim() : 'unknown error';
  return {
    title: 'Model catalog refresh failed',
    detail: `Refreshing provider models failed: ${text}. Existing models remain available. Fix auth/network and retry /model.`,
    status: `Skipped refreshing models: ${text}`,
    coalesceKey: 'model-refresh-failed',
  };
}
