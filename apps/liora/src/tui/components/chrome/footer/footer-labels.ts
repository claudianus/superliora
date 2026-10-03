/**
 * Human-readable status-bar labels — plain (default) vs compact.
 */

import type { FooterLabels } from '#/tui/config';

export function isPlainLabels(labels: FooterLabels): boolean {
  return labels !== 'compact';
}

export function labelModeYolo(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'YOLO' : 'yolo';
}

export function labelModeAuto(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Auto' : 'auto';
}


export function labelCompact(labels: FooterLabels, background: boolean): string {
  if (isPlainLabels(labels)) {
    return background ? 'Compacting…' : 'Compacting';
  }
  return background ? 'compact-bg' : 'compact';
}


export function labelHistoryViewport(labels: FooterLabels, rowsBehind: number): string {
  if (isPlainLabels(labels)) {
    return `History · ${String(rowsBehind)} rows up`;
  }
  return `history +${String(rowsBehind)} rows`;
}


export function labelFleetDone(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Worker done' : 'done';
}

export function labelPermissionOk(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Approved' : 'perm✓';
}

export function labelGitChurn(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Files changed' : 'diff↑';
}




export function labelCacheWarm(labels: FooterLabels, streakSpark: string): string {
  if (isPlainLabels(labels)) {
    return streakSpark.length > 0 ? `Cache warm ${streakSpark}` : 'Cache warm';
  }
  return `cache✓${streakSpark}`;
}

export function labelCacheRate(labels: FooterLabels, pct: number): string {
  return isPlainLabels(labels) ? `Cache ${String(pct)}%` : `cache ${String(pct)}%`;
}


export function labelQuota(labels: FooterLabels, pct: number): string {
  return isPlainLabels(labels) ? `Quota ${String(pct)}%` : `quota ${String(pct)}%`;
}

export function labelBackgroundBash(labels: FooterLabels, count: number): string {
  if (isPlainLabels(labels)) {
    return count === 1 ? '1 shell job' : `${String(count)} shell jobs`;
  }
  const noun = count === 1 ? 'shell job' : 'shell jobs';
  return `${String(count)} ${noun} running`;
}

export function labelBackgroundAgent(labels: FooterLabels, count: number): string {
  if (isPlainLabels(labels)) {
    return count === 1 ? '1 agent' : `${String(count)} agents`;
  }
  const noun = count === 1 ? 'agent' : 'agents';
  return `${String(count)} ${noun} running`;
}

/** Compact Conductor Job strip for footer (E1). */
export function labelConductorJobs(
  labels: FooterLabels,
  snap: {
    readonly running: number;
    readonly queued: number;
    readonly blocked: number;
    readonly needsUser: number;
    readonly interrupted: number;
    readonly failed: number;
    readonly unreadInbox: number;
    readonly maxConcurrent?: number;
  },
  extras?: {
    /** Optional session token glance when running jobs expose usage. */
    readonly tokenGlance?: string;
    /** Live session names (cap 2) for the strip. */
    readonly liveNames?: readonly string[];
  },
): string {
  const parts: string[] = [];
  const pool =
    snap.maxConcurrent !== undefined ? `pool=${String(snap.maxConcurrent)}` : undefined;
  const tok = extras?.tokenGlance;
  const names = extras?.liveNames?.filter((name) => name.trim().length > 0).slice(0, 2);
  if (isPlainLabels(labels)) {
    if (pool !== undefined) parts.push(pool);
    if (names !== undefined && names.length > 0) parts.push(names.join(', '));
    if (snap.running > 0) parts.push(`${String(snap.running)} running`);
    if (tok !== undefined) parts.push(tok);
    if (snap.queued > 0) parts.push(`${String(snap.queued)} queued`);
    if (snap.blocked > 0) parts.push(`${String(snap.blocked)} blocked`);
    if (snap.needsUser > 0) parts.push(`${String(snap.needsUser)} need you`);
    if (snap.interrupted > 0) parts.push(`${String(snap.interrupted)} paused`);
    if (snap.failed > 0) parts.push(`${String(snap.failed)} failed`);
    if (snap.unreadInbox > 0) parts.push(`${String(snap.unreadInbox)} inbox`);
    if (parts.length === 0) return 'Jobs idle';
    return `Jobs · ${parts.join(' · ')}`;
  }
  if (pool !== undefined) parts.push(pool);
  if (names !== undefined && names.length > 0) parts.push(names.join(','));
  if (snap.running > 0) parts.push(`${String(snap.running)}▸`);
  if (tok !== undefined) parts.push(tok.replaceAll(/\s/g, ''));
  if (snap.queued > 0) parts.push(`${String(snap.queued)}…`);
  if (snap.blocked > 0) parts.push(`${String(snap.blocked)}⛔`);
  if (snap.needsUser > 0) parts.push(`${String(snap.needsUser)}?`);
  if (snap.interrupted > 0) parts.push(`${String(snap.interrupted)}⏸`);
  if (snap.failed > 0) parts.push(`${String(snap.failed)}✗`);
  if (snap.unreadInbox > 0) parts.push(`i${String(snap.unreadInbox)}`);
  if (parts.length === 0) return 'jobs';
  return `jobs:${parts.join(' ')}`;
}

export function labelModelRoute(
  labels: FooterLabels,
  kind: 'failover' | 'compact' | 'complete' | 'cred' | 'via',
  fromLabel: string | undefined,
  toLabel: string,
): string {
  if (isPlainLabels(labels)) {
    if (kind === 'failover' && fromLabel !== undefined) {
      return `Failover · ${fromLabel} → ${toLabel}`;
    }
    if (kind === 'compact') return `Compact model · ${toLabel}`;
    if (kind === 'complete') return `Completing with ${toLabel}`;
    if (kind === 'cred') return `Credentials · ${toLabel}`;
    return `via ${toLabel}`;
  }
  if (kind === 'failover' && fromLabel !== undefined) {
    return `failover ${fromLabel}→${toLabel}`;
  }
  if (kind === 'compact') return `compact ${toLabel}`;
  if (kind === 'complete') return `complete ${toLabel}`;
  if (kind === 'cred') return `cred ${toLabel}`;
  return `via ${toLabel}`;
}

export function labelMenu(_labels: FooterLabels): string {
  return 'Menu ?';
}

export function labelContextPrefix(labels: FooterLabels): string {
  return isPlainLabels(labels) ? 'Context' : 'context';
}
