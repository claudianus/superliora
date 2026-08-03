/**
 * Pure helpers for Conductor Job footer strip (no agent-core import).
 */

export interface ConductorJobsSnapshot {
  readonly total: number;
  readonly queued: number;
  readonly running: number;
  readonly blocked: number;
  readonly needsUser: number;
  readonly interrupted: number;
  readonly failed: number;
  readonly unreadInbox: number;
}

export function emptyConductorJobsSnapshot(): ConductorJobsSnapshot {
  return {
    total: 0,
    queued: 0,
    running: 0,
    blocked: 0,
    needsUser: 0,
    interrupted: 0,
    failed: 0,
    unreadInbox: 0,
  };
}

/** Parse JobList / JobInbox tool text for best-effort strip updates. */
export function parseJobStripFromToolOutput(output: string): Partial<ConductorJobsSnapshot> | null {
  const text = output.trim();
  if (text.length === 0) return null;

  // "Jobs: 2▸ 1… inbox 3" from formatJobStripLine
  const stripMatch = text.match(/Jobs:\s*([^\n]+)/i);
  if (stripMatch) {
    const body = stripMatch[1] ?? '';
    if (/idle/i.test(body)) {
      return emptyConductorJobsSnapshot();
    }
    const running = Number((body.match(/(\d+)▸/) ?? [])[1] ?? 0);
    const queued = Number((body.match(/(\d+)…/) ?? [])[1] ?? 0);
    const blocked = Number((body.match(/(\d+)⛔/) ?? [])[1] ?? 0);
    const needsUser = Number((body.match(/(\d+)\?/) ?? [])[1] ?? 0);
    const interrupted = Number((body.match(/(\d+)⏸/) ?? [])[1] ?? 0);
    const failed = Number((body.match(/(\d+)✗/) ?? [])[1] ?? 0);
    const unreadInbox = Number((body.match(/inbox\s+(\d+)/i) ?? [])[1] ?? 0);
    const total = running + queued + blocked + needsUser + interrupted + failed;
    return {
      total,
      running,
      queued,
      blocked,
      needsUser,
      interrupted,
      failed,
      unreadInbox,
    };
  }

  // Ledger lines: `- job_xxx [running] ...`
  const lines = text.split('\n').filter((l) => /^\s*-\s+job_/i.test(l));
  if (lines.length === 0) return null;
  let running = 0;
  let queued = 0;
  let blocked = 0;
  let needsUser = 0;
  let interrupted = 0;
  let failed = 0;
  for (const line of lines) {
    const m = line.match(/\[([a-z_]+)\]/i);
    const status = (m?.[1] ?? '').toLowerCase();
    if (status === 'running') running += 1;
    else if (status === 'queued') queued += 1;
    else if (status === 'blocked') blocked += 1;
    else if (status === 'needs_user') needsUser += 1;
    else if (status === 'interrupted') interrupted += 1;
    else if (status === 'failed') failed += 1;
  }
  return {
    total: lines.length,
    running,
    queued,
    blocked,
    needsUser,
    interrupted,
    failed,
    unreadInbox: 0,
  };
}

export function mergeConductorJobsSnapshot(
  prev: ConductorJobsSnapshot | null | undefined,
  patch: Partial<ConductorJobsSnapshot>,
): ConductorJobsSnapshot {
  const base = prev ?? emptyConductorJobsSnapshot();
  return {
    total: patch.total ?? base.total,
    queued: patch.queued ?? base.queued,
    running: patch.running ?? base.running,
    blocked: patch.blocked ?? base.blocked,
    needsUser: patch.needsUser ?? base.needsUser,
    interrupted: patch.interrupted ?? base.interrupted,
    failed: patch.failed ?? base.failed,
    unreadInbox: patch.unreadInbox ?? base.unreadInbox,
  };
}
