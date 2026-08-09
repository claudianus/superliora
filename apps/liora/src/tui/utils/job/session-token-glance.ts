/**
 * Optional footer token glance from Conductor job card usage (F12).
 */

import { formatTokenCount } from '#/tui/utils/agent/context-working-set';
import type { ConductorJobCard } from './job-strip';

/** Sum input+output tokens across running jobs that already have usage. */
export function sumRunningJobTokens(jobs: readonly ConductorJobCard[]): number | undefined {
  let total = 0;
  let any = false;
  for (const job of jobs) {
    if (job.status !== 'running' || job.usage === undefined) continue;
    total += job.usage.input + job.usage.output;
    any = true;
  }
  return any ? total : undefined;
}

/** Compact footer fragment, e.g. `12.3k tok`. */
export function formatSessionTokenGlance(total: number | undefined): string | undefined {
  if (total === undefined || total <= 0) return undefined;
  return `${formatTokenCount(total)} tok`;
}
