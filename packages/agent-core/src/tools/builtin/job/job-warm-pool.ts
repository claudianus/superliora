/**
 * Warm pool for Conductor workers (config + ledger placeholders).
 * Pre-spawned live agents are a later slice; this tracks desired warm slots
 * and records readiness so schedule/backpressure can use the same config.
 */

import type { ToolStore } from '../../store';
import {
  CONDUCTOR_DEFAULT_WARM_POOL_SIZE,
  resolveConductorPoolConfig,
  type ConductorPoolConfig,
} from './job-runtime';
import { JOB_WARM_POOL_STORE_KEY } from './job-store-key';

declare module '../../store' {
  interface ToolStoreData {
    job_warm_pool: WarmPoolState;
  }
}

export interface WarmPoolState {
  readonly schemaVersion: 1;
  readonly desiredSize: number;
  readonly readySlots: number;
  readonly lastEnsuredAt?: string;
  readonly notes?: string;
}

export function emptyWarmPoolState(desired = CONDUCTOR_DEFAULT_WARM_POOL_SIZE): WarmPoolState {
  return {
    schemaVersion: 1,
    desiredSize: desired,
    readySlots: 0,
  };
}

export function readWarmPoolState(store: ToolStore): WarmPoolState {
  const raw = store.get(JOB_WARM_POOL_STORE_KEY) as WarmPoolState | undefined;
  if (raw === undefined || raw.schemaVersion !== 1) {
    return emptyWarmPoolState(resolveConductorPoolConfig().warmPoolSize);
  }
  return raw;
}

export function writeWarmPoolState(store: ToolStore, state: WarmPoolState): void {
  store.set(JOB_WARM_POOL_STORE_KEY, state);
}

/**
 * Warm worker pre-spawn callback. Implementations start a background
 * subagent (runInBackground) with a short idle prompt; resolution credits
 * the slot so the scheduler sees it ready.
 */
export type WarmPoolSpawner = (slot: number, total: number) => Promise<boolean>;

/**
 * Mark warm pool desired size; when a spawner is provided, fire pre-spawns
 * for the deficit (fire-and-forget, each resolves into a credited slot).
 * Returns how many additional live workers are still needed (deficit).
 */
export function ensureWarmPool(
  store: ToolStore,
  config: ConductorPoolConfig = resolveConductorPoolConfig(),
  spawner?: WarmPoolSpawner,
): {
  readonly state: WarmPoolState;
  readonly deficit: number;
  readonly spawned: number;
  readonly message: string;
} {
  const prev = readWarmPoolState(store);
  const deficit = Math.max(0, config.warmPoolSize - prev.readySlots);

  let spawned = 0;
  if (spawner !== undefined && deficit > 0) {
    const inFlight: Promise<boolean>[] = [];
    for (let i = 0; i < deficit; i += 1) {
      const slot = i + 1;
      const p = Promise.resolve()
        .then(() => spawner(slot, config.warmPoolSize))
        .then((ok) => {
          if (ok) {
            const fresh = readWarmPoolState(store);
            writeWarmPoolState(store, {
              ...fresh,
              readySlots: Math.min(config.warmPoolSize, fresh.readySlots + 1),
              notes: 'warm worker pre-spawned',
            });
          }
          return ok;
        })
        .catch(() => false);
      inFlight.push(p);
      spawned += 1;
    }
    // Non-blocking: scheduler must not wait for agent boots.
    void Promise.allSettled(inFlight);
  }

  const readyNow = readWarmPoolState(store).readySlots;
  const notes =
    readyNow >= config.warmPoolSize
      ? 'warm pool satisfied'
      : spawned > 0
        ? `pre-spawn requested ${spawned}; waiting for boots`
        : 'warm pre-spawn unavailable (no spawner); desired size recorded';

  const finalState: WarmPoolState = {
    schemaVersion: 1,
    desiredSize: config.warmPoolSize,
    readySlots: readyNow,
    lastEnsuredAt: new Date().toISOString(),
    notes,
  };
  writeWarmPoolState(store, finalState);
  const remaining = Math.max(0, config.warmPoolSize - finalState.readySlots);
  return {
    state: finalState,
    deficit: remaining,
    spawned,
    message:
      remaining === 0
        ? `Warm pool ready: ${finalState.readySlots}/${config.warmPoolSize}`
        : `Warm pool deficit ${remaining} (desired ${config.warmPoolSize}, ready ${finalState.readySlots})${
            spawned > 0 ? `; pre-spawned ${spawned} worker(s)` : ''
          }`,
  };
}

/** Test/helper: simulate a ready warm slot after a worker recycles. */
export function creditWarmPoolSlot(store: ToolStore, delta = 1): WarmPoolState {
  const prev = readWarmPoolState(store);
  const next: WarmPoolState = {
    ...prev,
    readySlots: Math.max(0, prev.readySlots + delta),
    lastEnsuredAt: new Date().toISOString(),
  };
  writeWarmPoolState(store, next);
  return next;
}

/**
 * Build a spawner that actually pre-spawns warm workers as background
 * subagents with an idle prompt. Boots are fire-and-forget; each success
 * credits the slot via creditWarmPoolSlot. Returns undefined when the
 * agent has no subagentHost (scheduler keeps recording desired size only).
 */
export function warmPoolSpawner(
  agent:
    | {
        subagentHost?: unknown;
        log?: { debug?: (message: string, payload?: unknown) => void };
      }
    | undefined,
): WarmPoolSpawner | undefined {
  if (agent === undefined || agent.subagentHost === undefined) {
    return undefined;
  }
  const host = agent.subagentHost as {
    spawn(options: {
      prompt: string;
      description: string;
      profileName?: string;
      runInBackground?: boolean;
      parentToolCallId?: string;
      signal?: AbortSignal;
    }): Promise<{ agentId: string }>;
  };
  return async (slot, total) => {
    try {
      const controller = new AbortController();
      const handle = await host.spawn({
        prompt: [
          `You are a warm Conductor worker ${slot}/${total} in the idle pool.`,
          'Remain ready; do not take actions or edit files.',
          'If you receive an explicit job assignment in a follow-up message, begin that work immediately.',
          'Until then, reply with a single line: "warm worker ready".',
        ].join('\n'),
        description: `warm-worker-${slot}-of-${total}`,
        profileName: 'core',
        runInBackground: true,
        parentToolCallId: `warm:${slot}`,
        signal: controller.signal,
      });
      agent.log?.debug?.('warm worker pre-spawned', { agentId: handle.agentId, slot });
      return true;
    } catch (error) {
      agent.log?.debug?.('warm worker pre-spawn failed', { slot, error });
      return false;
    }
  };
}

