/**
 * Shared Ultrawork session lifecycle helpers.
 *
 * Starting, resuming, rolling back, and finishing an Ultrawork run all need to
 * mutate the same set of session flags (swarm mode, plan mode, premium quality)
 * and then restore the values those flags held before the run. Three call sites
 * — the interactive TUI (`ultrawork.ts`), the `/goal` command (`goal.ts`), and
 * the headless `-p` path (`run-prompt.ts`) — previously each carried their own
 * copy of this state machine, and the copies had already drifted (headless and
 * goal never enabled premium quality; the finish path never restored prior
 * state). This module is the single source of truth.
 *
 * The functions come in two flavours:
 *   - `*Session` operate purely on an SDK `Session`, used by headless mode.
 *   - the TUI wrappers additionally mirror the SDK state into `AppState` /
 *     `swarmModeEntry` so the editor border and footer reflect the change.
 */

import type { Session } from '@superliora/sdk';

/**
 * Snapshot of the session flags an Ultrawork run takes over, captured *before*
 * the run mutates them so rollback / finish can restore the exact prior state.
 */
export interface UltraworkSessionSnapshot {
  readonly planModeWasEnabled: boolean;
  readonly swarmModeWasEnabled: boolean;
  readonly premiumQualityWasEnabled: boolean;
  /** Set true once the run has changed plan mode (so rollback knows to revert). */
  planChanged: boolean;
  /** Set true once the run has enabled swarm mode (so rollback knows to revert). */
  swarmEnabled: boolean;
  /** Set true once the run has changed premium quality (so rollback knows to revert). */
  premiumQualityChanged: boolean;
}

export interface PrepareUltraworkOptions {
  /**
   * When true, preserve an already-active plan mode instead of resetting it.
   * Used by the `/goal` path that wants to keep an existing interview going.
   */
  readonly preservePlan?: boolean;
}

/**
 * Capture the current session flag values into a fresh snapshot. The snapshot
 * starts in the "nothing changed yet" state (`planChanged`/`swarmEnabled`/
 * `premiumQualityChanged` all false); the prepare step flips those as it mutates
 * each flag.
 */
export function captureUltraworkSnapshot(
  planMode: boolean,
  swarmMode: boolean,
  premiumQuality: boolean,
): UltraworkSessionSnapshot {
  return {
    planModeWasEnabled: planMode,
    swarmModeWasEnabled: swarmMode,
    premiumQualityWasEnabled: premiumQuality,
    planChanged: false,
    swarmEnabled: false,
    premiumQualityChanged: false,
  };
}

function isAlreadyInPlanModeError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Already in plan mode');
}

/**
 * Reset plan mode to a clean Ultra Plan interview by toggling out and back in.
 * A direct enter while already in plan mode throws; we catch that, exit, then
 * re-enter so the interview starts from a known state.
 */
export async function resetUltraPlanMode(
  session: Session,
  initialContext = '',
): Promise<void> {
  try {
    await session.setPlanMode(true, true, initialContext);
  } catch (error) {
    if (!isAlreadyInPlanModeError(error)) throw error;
    await session.setPlanMode(false, false);
    await session.setPlanMode(true, true, initialContext);
  }
}

/**
 * Enable swarm mode, force Ultra Plan mode on, and enable premium quality —
 * the three flags every Ultrawork run needs. Mutates `snapshot` to record what
 * it changed so {@link rollbackUltraworkSession} can undo exactly that.
 *
 * This is the session-only core shared by the TUI and headless paths.
 */
export async function prepareUltraworkSession(
  session: Session,
  snapshot: UltraworkSessionSnapshot,
  initialContext = '',
  options: PrepareUltraworkOptions = {},
): Promise<void> {
  try {
    if (!snapshot.swarmModeWasEnabled) {
      await session.setSwarmMode(true, 'task');
      snapshot.swarmEnabled = true;
    }
    if (options.preservePlan) {
      const status = await session.getStatus();
      if (!status.planMode) {
        await session.setPlanMode(true, true, initialContext);
        snapshot.planChanged = true;
      }
    } else {
      // Mark planChanged before the async call so rollback restores the
      // original plan state even if resetUltraPlanMode partially fails
      // (e.g. exit succeeds but re-enter throws).
      snapshot.planChanged = true;
      await resetUltraPlanMode(session, initialContext);
    }
    if (!snapshot.premiumQualityWasEnabled) {
      await session.setPremiumQuality(true);
      snapshot.premiumQualityChanged = true;
    }
  } catch (error) {
    await rollbackUltraworkSession(session, snapshot);
    throw error;
  }
}

/**
 * Restore the session flags captured in `snapshot`. Idempotent: only reverts the
 * flags the prepare step actually changed. Errors are swallowed (best-effort)
 * because rollback runs on error paths where surfacing a second failure would
 * mask the original cause.
 */
export async function rollbackUltraworkSession(
  session: Session,
  snapshot: UltraworkSessionSnapshot,
): Promise<void> {
  if (snapshot.planChanged) {
    await session.setPlanMode(snapshot.planModeWasEnabled, false).catch(() => {});
  }
  if (snapshot.swarmEnabled) {
    await session.setSwarmMode(false, 'task').catch(() => {});
  }
  if (snapshot.premiumQualityChanged) {
    await session.setPremiumQuality(snapshot.premiumQualityWasEnabled).catch(() => {});
  }
}
