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

/**
 * Trigger Setup hook after SessionStart. Mirrors Claude Code semantics: the
 * Setup hook fires once during session initialization (startup), letting
 * plugins prepare the session after SessionStart has run.
 */
export async function triggerSetup(
  hookEngine: HookEngine,
  source: 'startup' | 'resume',
): Promise<void> {
  await hookEngine.trigger('Setup', {
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
