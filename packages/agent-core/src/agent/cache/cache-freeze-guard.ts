import { createHash } from 'node:crypto';

/**
 * Snapshots L1/tools prefix material at turn start and rejects mid-turn mutation.
 *
 * Wire at turn boundaries (`run-one.ts`): `freeze(material)` on start, `clear()` on end.
 * - `assertUnchanged` — hard throw (setActiveTools / strict call sites).
 * - `checkUnchanged` — soft sensor (Loop20a step-loop): records violations, no throw.
 *   Ephemeral orchestrator tools may legitimately widen the tool list mid-session;
 *   soft drift still surfaces in logs / status without killing the turn.
 */
export class CacheFreezeGuard {
  private frozenHash: string | null = null;
  private violationCount = 0;
  private lastViolationLabel: string | undefined;

  freeze(prefixMaterial: string): void {
    this.frozenHash = hashPrefixMaterial(prefixMaterial);
  }

  assertUnchanged(prefixMaterial: string, label = 'prefix material'): void {
    if (this.frozenHash === null) return;
    const next = hashPrefixMaterial(prefixMaterial);
    if (next !== this.frozenHash) {
      this.violationCount += 1;
      this.lastViolationLabel = label;
      throw new Error(
        `CacheFreezeGuard: ${label} changed mid-turn (hash ${this.frozenHash} → ${next})`,
      );
    }
  }

  /**
   * Soft check used every step. Returns false on drift and increments
   * {@link violationCount}; never throws.
   */
  checkUnchanged(prefixMaterial: string, label = 'prefix material'): boolean {
    if (this.frozenHash === null) return true;
    const next = hashPrefixMaterial(prefixMaterial);
    if (next !== this.frozenHash) {
      this.violationCount += 1;
      this.lastViolationLabel = label;
      return false;
    }
    return true;
  }

  clear(): void {
    this.frozenHash = null;
    // Keep violationCount across clear so status can report mid-session drift.
  }

  isFrozen(): boolean {
    return this.frozenHash !== null;
  }

  getViolationCount(): number {
    return this.violationCount;
  }

  getLastViolationLabel(): string | undefined {
    return this.lastViolationLabel;
  }
}

export function hashPrefixMaterial(material: string): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** Stable turn-start fingerprint from active builtin tool names. */
export function buildTurnPrefixMaterial(enabledTools: Iterable<string>): string {
  return [...enabledTools].toSorted().join('\n');
}

/**
 * Loop32a — wire `warning.code` when soft mid-turn tool-list drift is detected.
 * Status already exposes `cache_freeze_violations`; this is the live operator notice.
 */
export const CACHE_FREEZE_DRIFT_SENSOR_ORIGIN = 'cache-freeze-drift-sensor' as const;

export function formatCacheFreezeDriftTip(
  violations: number,
  label: string = 'tool list',
): string {
  return (
    `CACHE_FREEZE_DRIFT: mid-turn ${label} fingerprint changed ` +
    `(drift×${String(violations)}). Prompt-cache prefix may miss; ` +
    `setActiveTools stays rejected while frozen. code=CACHE_FREEZE_DRIFT.`
  );
}
