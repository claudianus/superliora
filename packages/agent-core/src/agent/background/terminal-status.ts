import { TERMINAL_STATUSES, type BackgroundTaskStatus } from './task';

/**
 * `'lost'` is a reconcile-only terminal state. Tasks loaded from disk
 * that were marked `running` at startup but have no live KaosProcess
 * (the previous CLI process died) are reclassified as lost.
 */
export function isBackgroundTaskTerminal(status: BackgroundTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
