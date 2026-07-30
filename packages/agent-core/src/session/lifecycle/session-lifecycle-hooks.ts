/**
 * Session lifecycle hooks — extracted from Session class.
 */

import type { HookEngine } from '../hooks';

export async function triggerSessionStart(
  hookEngine: HookEngine,
  source: 'startup' | 'resume',
): Promise<void> {
  await hookEngine.trigger('SessionStart', {
    matcherValue: source,
    inputData: { source },
  });
}

export async function triggerSessionEnd(
  hookEngine: HookEngine,
  reason: 'exit',
): Promise<void> {
  await hookEngine.trigger('SessionEnd', {
    matcherValue: reason,
    inputData: { reason },
  });
}
