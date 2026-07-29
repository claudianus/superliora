/**
 * Adaptive concurrency control for parallel compaction block summarization.
 *
 * Extracted from full.ts — module-level utilities with no class-state dependency.
 */

import {
  APIContextOverflowError,
  APIEmptyResponseError,
  APIStatusError,
} from '@superliora/kosong';

/** Hard ceiling for adaptive concurrency — providers rarely sustain more than this. */
export const MAX_PARALLEL_BLOCK_CONCURRENCY = 8;

/** Env override for initial parallel block concurrency (clamped 1..MAX). */
export const PARALLEL_CONCURRENCY_ENV = 'SUPERLIORA_COMPACTION_PARALLEL_CONCURRENCY';

/**
 * Adaptive concurrency controller for parallel block summarize.
 * Starts at `initial`, drops on rate-limit, gently climbs after clean successes.
 */
export class AdaptiveConcurrencyLimiter {
  private current: number;
  private successesSinceRaise = 0;

  constructor(initial: number) {
    this.current = Math.max(1, Math.min(MAX_PARALLEL_BLOCK_CONCURRENCY, initial));
  }

  get limit(): number {
    return this.current;
  }

  noteSuccess(): void {
    this.successesSinceRaise += 1;
    // Raise only after a short clean streak so we do not thrash the limit.
    if (this.successesSinceRaise >= 2 && this.current < MAX_PARALLEL_BLOCK_CONCURRENCY) {
      this.current += 1;
      this.successesSinceRaise = 0;
    }
  }

  noteRateLimit(): void {
    this.successesSinceRaise = 0;
    this.current = Math.max(1, Math.floor(this.current / 2));
  }
}

/**
 * Run async work with a fixed or adaptive concurrency limit.
 * Adaptive path polls the limiter so 429s can shrink in-flight fan-out without
 * restarting the whole parallel summarize pass.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number | AdaptiveConcurrencyLimiter,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let active = 0;
  let settled = 0;
  let fatal: unknown;
  let wake: (() => void) | undefined;

  const notify = (): void => {
    wake?.();
    wake = undefined;
  };

  const waitSlot = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  };

  const currentLimit = (): number => {
    if (typeof concurrency === 'number') {
      return Math.max(1, Math.min(concurrency, items.length));
    }
    return Math.max(1, Math.min(concurrency.limit, items.length));
  };

  const runners: Promise<void>[] = [];

  const launch = (index: number, item: T): void => {
    active += 1;
    const run = (async () => {
      try {
        if (fatal !== undefined) return;
        results[index] = await worker(item, index);
      } catch (error) {
        if (fatal === undefined) fatal = error;
      } finally {
        active -= 1;
        settled += 1;
        notify();
      }
    })();
    runners.push(run);
  };

  while (settled < items.length) {
    if (fatal !== undefined) break;
    while (active < currentLimit() && nextIndex < items.length && fatal === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) break;
      launch(index, item);
    }
    if (settled >= items.length || fatal !== undefined) break;
    if (active >= currentLimit() || nextIndex >= items.length) {
      await waitSlot();
    }
  }

  await Promise.all(runners);
  if (fatal !== undefined) {
    // oxlint-disable-next-line typescript-eslint/only-throw-error
    throw fatal;
  }
  return results;
}

export function parseEnvConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_PARALLEL_BLOCK_CONCURRENCY, n);
}

export function isRateLimitLikeError(error: unknown): boolean {
  if (error instanceof APIStatusError && error.statusCode === 429) return true;
  if (error instanceof Error && /rate.?limit|too many requests|429/i.test(error.message)) {
    return true;
  }
  return false;
}

export class CompactionTruncatedError extends Error {
  constructor() {
    super('Compaction response was truncated before producing a complete summary.');
    this.name = 'CompactionTruncatedError';
  }
}

export class CompactionQualityError extends Error {
  constructor(messages: readonly string[]) {
    super(`Compaction summary failed quality checks: ${messages.join('; ')}`);
    this.name = 'CompactionQualityError';
  }
}

export function isCompactionSummarizerError(error: unknown): boolean {
  return (
    error instanceof APIEmptyResponseError ||
    error instanceof CompactionTruncatedError ||
    error instanceof APIContextOverflowError ||
    error instanceof CompactionQualityError
  );
}
