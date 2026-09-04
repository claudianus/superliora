/**
 * Proactive OAuth refresh helpers for long-running agent sessions.
 *
 * OAuthManager refreshes lazily on ensureFresh(); these helpers let hosts
 * poll on a timer so tokens stay warm during multi-minute runs.
 */

import type { TokenInfo } from '../types';
import { defaultRefreshThreshold } from './oauth-manager';

/** Host-side proactive ensureFresh poll interval (run-shell / run-prompt). */
export const OAUTH_PROACTIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface ProactiveRefreshOptions {
  readonly now?: (() => number) | undefined;
  readonly threshold?: ((expiresIn: number) => number) | undefined;
}

/** True when ensureFresh() would refresh the token (non-force path). */
export function tokenNeedsProactiveRefresh(
  token: TokenInfo,
  options: ProactiveRefreshOptions = {},
): boolean {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const thresholdFn = options.threshold ?? defaultRefreshThreshold;
  if (token.expiresAt === 0) return false;
  const remaining = token.expiresAt - now();
  return remaining < thresholdFn(token.expiresIn);
}

export interface ProactiveRefreshTimerHandle {
  stop(): void;
}

export interface StartProactiveRefreshTimerOptions {
  readonly onError?: ((error: unknown) => void) | undefined;
}

/**
 * Periodically calls ensureFresh during long work. Errors are swallowed unless
 * onError is provided.
 *
 * Ticks never overlap: a slow `ensureFresh` (network stall) skips subsequent
 * ticks until it settles instead of stacking concurrent refreshes against a
 * rotating refresh_token. `onError` itself is guarded so an observer cannot
 * turn a tick into an unhandled rejection.
 */
export function startProactiveRefreshTimer(
  ensureFresh: () => Promise<string>,
  intervalMs: number,
  options: StartProactiveRefreshTimerOptions = {},
): ProactiveRefreshTimerHandle {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void ensureFresh()
      .catch((error) => {
        try {
          options.onError?.(error);
        } catch {
          // Observer must not affect the refresh loop.
        }
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  // Don't hold the process open for a background warming timer.
  timer.unref?.();
  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}
