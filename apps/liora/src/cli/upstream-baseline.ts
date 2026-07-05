import { UPSTREAM_BASELINE } from '#/generated/upstream-baseline.generated';

export type UpstreamBaseline = typeof UPSTREAM_BASELINE;

export function getUpstreamBaseline(): UpstreamBaseline {
  return UPSTREAM_BASELINE;
}

export function formatUpstreamBaselineSummary(baseline: UpstreamBaseline = UPSTREAM_BASELINE): string {
  const commit = baseline.superlioraCommit.slice(0, 12);
  return `${baseline.product} ${baseline.version} @ ${baseline.ref} (sync ${baseline.syncedAt}, ${commit})`;
}
