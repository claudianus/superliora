export interface DependencyWaveItem {
  readonly expertId: string;
  readonly dependsOn?: readonly string[];
}

export function buildDependencyWaves<T extends DependencyWaveItem>(
  items: readonly T[],
): readonly (readonly T[])[] {
  if (items.length <= 1) return [items];
  const byExpertId = new Map(items.map((item) => [item.expertId, item] as const));
  const remaining = new Set(items.map((item) => item.expertId));
  const waves: T[][] = [];

  while (remaining.size > 0) {
    const wave: T[] = [];
    for (const expertId of remaining) {
      const item = byExpertId.get(expertId);
      if (item === undefined) continue;
      const dependencies = item.dependsOn ?? [];
      const blocked = dependencies.some((dependencyId) => remaining.has(dependencyId));
      if (!blocked) wave.push(item);
    }
    if (wave.length === 0) {
      return [items];
    }
    for (const item of wave) {
      remaining.delete(item.expertId);
    }
    waves.push(wave);
  }

  return waves;
}

export function phaseHasDependencyWaves(items: readonly DependencyWaveItem[]): boolean {
  return buildDependencyWaves(items).length > 1;
}
