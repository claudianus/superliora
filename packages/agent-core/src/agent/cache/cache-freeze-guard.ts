import { createHash } from 'node:crypto';

/**
 * Snapshots L1/tools prefix material at turn start and rejects mid-turn mutation.
 *
 * Wire at turn boundaries (`run-one.ts`): `freeze(material)` on start, `clear()` on end.
 * Call `assertUnchanged(material, label)` before mutating tool lists or static prefix bytes.
 */
export class CacheFreezeGuard {
  private frozenHash: string | null = null;

  freeze(prefixMaterial: string): void {
    this.frozenHash = hashPrefixMaterial(prefixMaterial);
  }

  assertUnchanged(prefixMaterial: string, label = 'prefix material'): void {
    if (this.frozenHash === null) return;
    const next = hashPrefixMaterial(prefixMaterial);
    if (next !== this.frozenHash) {
      throw new Error(
        `CacheFreezeGuard: ${label} changed mid-turn (hash ${this.frozenHash} → ${next})`,
      );
    }
  }

  clear(): void {
    this.frozenHash = null;
  }

  isFrozen(): boolean {
    return this.frozenHash !== null;
  }
}

export function hashPrefixMaterial(material: string): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/** Stable turn-start fingerprint from active builtin tool names. */
export function buildTurnPrefixMaterial(enabledTools: Iterable<string>): string {
  return [...enabledTools].toSorted().join('\n');
}
