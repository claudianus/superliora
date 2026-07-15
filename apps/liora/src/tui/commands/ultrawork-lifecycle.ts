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

/**
 * TUI-only extensions: `swarmModeEntry` and `ultraworkMode` live in AppState /
 * host state, not on the SDK Session.
 */
export interface UltraworkTuiSetupState extends UltraworkSessionSnapshot {
  /** Prior `swarmModeEntry` so rollback can restore the TUI-only value. */
  readonly previousSwarmModeEntry: 'manual' | 'task' | 'ultrawork' | undefined;
  /** Prior `ultraworkMode` so rollback restores it instead of forcing off. */
  readonly ultraworkModeWasEnabled: boolean;
}

export interface PrepareUltraworkOptions {
  /**
   * When true, preserve an already-active plan mode instead of resetting it.
   * Used by the `/goal` path that wants to keep an existing interview going.
   */
  readonly preservePlan?: boolean;
}

/** Minimal host surface for TUI prepare/rollback (shared by Goal + Ultrawork). */
export interface UltraworkTuiHost {
  readonly state: {
    appState: {
      planMode: boolean;
      swarmMode: boolean;
      premiumQualityMode?: boolean;
      ultraworkMode?: boolean;
    };
    swarmModeEntry: 'manual' | 'task' | 'ultrawork' | undefined;
  };
  requireSession(): Session;
  setAppState(patch: Record<string, unknown>): void;
}

export interface PrepareUltraworkTuiOptions extends PrepareUltraworkOptions {
  /** Optional activity tip written into AppState after prepare. */
  readonly activityTip?: string | null;
  /**
   * When true (default), stash prior plan/swarm/premium into
   * `ultraworkPriorState` for finish-path restoration.
   */
  readonly recordPriorState?: boolean;
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

/**
 * Capture TUI-visible flags plus `swarmModeEntry` / prior ultrawork mode.
 */
export function captureUltraworkTuiSetup(host: UltraworkTuiHost): UltraworkTuiSetupState {
  return {
    ...captureUltraworkSnapshot(
      host.state.appState.planMode,
      host.state.appState.swarmMode,
      host.state.appState.premiumQualityMode ?? false,
    ),
    previousSwarmModeEntry: host.state.swarmModeEntry,
    ultraworkModeWasEnabled: host.state.appState.ultraworkMode === true,
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
      // Snapshot is captured immediately before prepare on TUI/headless paths.
      // Prefer it over getStatus so call sites do not need an extra status round-trip
      // and unit tests can exercise prepare without mocking getStatus.
      if (!snapshot.planModeWasEnabled) {
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
 * Session prepare + AppState mirror used by both `/ultrawork` and `/goal`.
 */
export async function prepareUltraworkTuiSetup(
  host: UltraworkTuiHost,
  setup: UltraworkTuiSetupState,
  initialContext = '',
  options: PrepareUltraworkTuiOptions = {},
): Promise<void> {
  const session = host.requireSession();
  try {
    await prepareUltraworkSession(session, setup, initialContext, {
      preservePlan: options.preservePlan,
    });
    const recordPriorState = options.recordPriorState !== false;
    host.setAppState({
      planMode: true,
      ultraworkMode: true,
      premiumQualityMode: true,
      ...(setup.swarmEnabled ? { swarmMode: true } : {}),
      ...(recordPriorState
        ? {
            ultraworkPriorState: {
              planMode: setup.planModeWasEnabled,
              swarmMode: setup.swarmModeWasEnabled,
              swarmModeEntry: setup.previousSwarmModeEntry,
              premiumQualityMode: setup.premiumQualityWasEnabled,
            },
          }
        : {}),
      ...(options.activityTip !== undefined ? { activityTip: options.activityTip } : {}),
    });
    if (setup.swarmEnabled) {
      host.state.swarmModeEntry = 'ultrawork';
    }
  } catch (error) {
    await rollbackUltraworkTuiSetup(host, setup);
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

/** Session rollback + AppState / swarmModeEntry restore for TUI hosts. */
export async function rollbackUltraworkTuiSetup(
  host: UltraworkTuiHost,
  setup: UltraworkTuiSetupState,
): Promise<void> {
  const session = host.requireSession();
  await rollbackUltraworkSession(session, setup);
  host.setAppState({
    planMode: setup.planModeWasEnabled,
    ultraworkMode: setup.ultraworkModeWasEnabled,
    ultraworkPriorState: null,
    ...(setup.swarmEnabled ? { swarmMode: setup.swarmModeWasEnabled } : {}),
    ...(setup.premiumQualityChanged
      ? { premiumQualityMode: setup.premiumQualityWasEnabled }
      : {}),
  });
  if (setup.swarmEnabled) {
    host.state.swarmModeEntry = setup.previousSwarmModeEntry;
  }
}
