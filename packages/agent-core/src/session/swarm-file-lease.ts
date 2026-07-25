/**
 * Swarm file lease registry — prevent concurrent Edit/Write on the same path
 * across UltraSwarm workers.
 *
 * Pure in-memory claims keyed by normalized path. Optional wire points:
 * claim before worker file mutation; release on finish; listClaims(runId).
 */

import { normalize, resolve } from 'pathe';

export interface SwarmFileLeaseClaim {
  readonly path: string;
  readonly ownerId: string;
  readonly runId: string;
  readonly claimedAt: string;
}

export type SwarmFileLeaseClaimResult =
  | { readonly ok: true; readonly claim: SwarmFileLeaseClaim }
  | {
      readonly ok: false;
      readonly conflict: {
        readonly path: string;
        readonly holder: SwarmFileLeaseClaim;
      };
    };

export interface SwarmFileLeaseRegistry {
  claim(path: string, ownerId: string, runId: string): SwarmFileLeaseClaimResult;
  release(path: string, ownerId: string): boolean;
  listClaims(runId?: string): readonly SwarmFileLeaseClaim[];
  releaseAll(runId: string): number;
  holder(path: string): SwarmFileLeaseClaim | undefined;
  clear(): void;
}

/**
 * Normalize path for lease identity. Absolute paths stay absolute;
 * relative paths resolve against optional baseDir (or process cwd).
 */
export function normalizeLeasePath(path: string, baseDir?: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.startsWith('/')) return normalize(trimmed);
  // Windows drive letter
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return normalize(trimmed);
  return normalize(resolve(baseDir ?? process.cwd(), trimmed));
}

export function createSwarmFileLeaseRegistry(options?: {
  readonly baseDir?: string;
  readonly now?: () => string;
}): SwarmFileLeaseRegistry {
  const claims = new Map<string, SwarmFileLeaseClaim>();
  const baseDir = options?.baseDir;
  const now = options?.now ?? (() => new Date().toISOString());

  return {
    claim(path: string, ownerId: string, runId: string): SwarmFileLeaseClaimResult {
      const normalized = normalizeLeasePath(path, baseDir);
      if (normalized.length === 0) {
        return {
          ok: false,
          conflict: {
            path,
            holder: {
              path,
              ownerId: '',
              runId: '',
              claimedAt: now(),
            },
          },
        };
      }
      const existing = claims.get(normalized);
      if (existing !== undefined) {
        // Idempotent re-claim by same owner within same run.
        if (existing.ownerId === ownerId && existing.runId === runId) {
          return { ok: true, claim: existing };
        }
        return {
          ok: false,
          conflict: {
            path: normalized,
            holder: existing,
          },
        };
      }
      const claim: SwarmFileLeaseClaim = {
        path: normalized,
        ownerId,
        runId,
        claimedAt: now(),
      };
      claims.set(normalized, claim);
      return { ok: true, claim };
    },

    release(path: string, ownerId: string): boolean {
      const normalized = normalizeLeasePath(path, baseDir);
      const existing = claims.get(normalized);
      if (existing === undefined) return false;
      if (existing.ownerId !== ownerId) return false;
      claims.delete(normalized);
      return true;
    },

    listClaims(runId?: string): readonly SwarmFileLeaseClaim[] {
      const all = [...claims.values()];
      if (runId === undefined) return all;
      return all.filter((claim) => claim.runId === runId);
    },

    releaseAll(runId: string): number {
      let released = 0;
      for (const [key, claim] of claims) {
        if (claim.runId !== runId) continue;
        claims.delete(key);
        released += 1;
      }
      return released;
    },

    holder(path: string): SwarmFileLeaseClaim | undefined {
      return claims.get(normalizeLeasePath(path, baseDir));
    },

    clear(): void {
      claims.clear();
    },
  };
}

/** Process-wide default registry for optional UltraSwarm worker wiring. */
let defaultRegistry: SwarmFileLeaseRegistry | undefined;

export function getDefaultSwarmFileLeaseRegistry(): SwarmFileLeaseRegistry {
  defaultRegistry ??= createSwarmFileLeaseRegistry();
  return defaultRegistry;
}

export function resetDefaultSwarmFileLeaseRegistry(): void {
  defaultRegistry?.clear();
  defaultRegistry = undefined;
}

/**
 * Optional pre-mutation check for Edit/Write tools.
 * Returns an error message when another owner holds the path; undefined when ok.
 */
export function checkSwarmFileLease(
  path: string,
  ownerId: string | undefined,
  runId: string | undefined,
  registry: SwarmFileLeaseRegistry = getDefaultSwarmFileLeaseRegistry(),
): string | undefined {
  if (ownerId === undefined || runId === undefined) return undefined;
  const result = registry.claim(path, ownerId, runId);
  if (result.ok) return undefined;
  const holder = result.conflict.holder;
  return (
    `File lease conflict on ${result.conflict.path}: held by owner=${holder.ownerId} run=${holder.runId}. ` +
    `Claimant owner=${ownerId} run=${runId} must wait or pick another path.`
  );
}
