/** Hard cap for wait_any / wait_all batch size (Grok-aligned DoS bound). */
export const MAX_MULTI_WAIT_TASKS = 20;

export class MultiWaitLimitError extends Error {
  readonly code = 'MULTI_WAIT_LIMIT' as const;
  constructor(count: number) {
    super(
      `Too many task ids for multi-wait (${String(count)}). Maximum is ${String(MAX_MULTI_WAIT_TASKS)}.`,
    );
    this.name = 'MultiWaitLimitError';
  }
}

export function normalizeMultiWaitIds(taskIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const raw of taskIds) {
    const id = raw.trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length > MAX_MULTI_WAIT_TASKS) {
    throw new MultiWaitLimitError(ids.length);
  }
  return ids;
}
