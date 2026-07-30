/**
 * Prompt-input interaction clock.
 *
 * Ambient animation + Ultrawork border chase fight the editor for the event
 * loop while the user is typing. Recording a short holdoff lets pure-input
 * frames skip decorative work without permanently disabling motion.
 */

const DEFAULT_TYPING_HOLDOFF_MS = 200;

let lastInputInteractionAtMs = 0;

export function noteTUIInputInteraction(nowMs: number = Date.now()): void {
  lastInputInteractionAtMs = Math.max(0, nowMs);
}

export function lastTUIInputInteractionAtMs(): number {
  return lastInputInteractionAtMs;
}

export function isTUIInputInteractionActive(
  nowMs: number = Date.now(),
  holdoffMs: number = DEFAULT_TYPING_HOLDOFF_MS,
): boolean {
  if (lastInputInteractionAtMs <= 0) return false;
  const windowMs = Number.isFinite(holdoffMs) ? Math.max(0, holdoffMs) : DEFAULT_TYPING_HOLDOFF_MS;
  return nowMs - lastInputInteractionAtMs < windowMs;
}

/** Test helper — do not use in product paths. */
export function resetTUIInputInteractionForTests(): void {
  lastInputInteractionAtMs = 0;
}
