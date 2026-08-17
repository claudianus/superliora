/**
 * Session outcome board — groups Conductor jobs by user-facing goal, not job id.
 *
 * Pure helpers (no TUIState). The Job Deck / Mission Control surfaces call these
 * so the operator sees 끝남 / 남음 / 막힘 instead of a flat ledger dump.
 */

import type { ColorToken } from '#/tui/theme';
import type { ConductorJobCard } from './job-strip';

/** Outcome-level bucket for the session board. Remaining + blocked first. */
export type SessionOutcomeBucket = 'blocked' | 'remaining' | 'done';

/** One-line status shown on each outcome row. */
export type SessionOutcomeStatus =
  | 'done'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'verify_only'
  | 'code_pass_ledger_fail';

export interface SessionOutcomeChild {
  readonly id: string;
  readonly kind: string;
  readonly status: ConductorJobCard['status'];
  readonly title: string;
  readonly verifyVerdict?: ConductorJobCard['verifyVerdict'];
  readonly debugFixer?: boolean;
}

export interface SessionOutcomeRow {
  readonly id: string;
  /** User-facing title (parent/plan title, never raw job_id alone). */
  readonly title: string;
  readonly bucket: SessionOutcomeBucket;
  readonly status: SessionOutcomeStatus;
  readonly statusLabel: string;
  readonly token: ColorToken;
  /** One-line why when blocked / ledger-fail / waiting. */
  readonly reason?: string;
  readonly primaryJobId: string;
  readonly jobIds: readonly string[];
  readonly children: readonly SessionOutcomeChild[];
  readonly collapsedChildCount: number;
  readonly priority: number;
  readonly updatedAtMs: number;
}

export interface SessionOutcomeBoard {
  readonly blocked: readonly SessionOutcomeRow[];
  readonly remaining: readonly SessionOutcomeRow[];
  readonly done: readonly SessionOutcomeRow[];
  readonly totalJobs: number;
  readonly totalOutcomes: number;
}

const AUTO_CHILD_KINDS = new Set(['verify', 'merge', 'push']);

const STATUS_LABEL: Record<SessionOutcomeStatus, string> = {
  done: '끝남',
  running: '진행',
  waiting: '대기',
  blocked: '막힘',
  verify_only: '검증만 남음',
  code_pass_ledger_fail: '코드 통과·장부 실패',
};

const STATUS_TOKEN: Record<SessionOutcomeStatus, ColorToken> = {
  done: 'success',
  running: 'primary',
  waiting: 'info',
  blocked: 'error',
  verify_only: 'warning',
  code_pass_ledger_fail: 'warning',
};

const BUCKET_ORDER: readonly SessionOutcomeBucket[] = ['blocked', 'remaining', 'done'];

/** True when this card is an auto verify/debug/merge/push child of another job. */
export function isAutoOutcomeChild(card: ConductorJobCard): boolean {
  if (card.parentJobId === undefined || card.parentJobId.length === 0) return false;
  if (card.debugFixer === true) return true;
  return AUTO_CHILD_KINDS.has(card.kind);
}

/**
 * Human one-line block reason from resultSummary / effect / known host failures.
 * Never invents a reason when nothing is present.
 */
export function summarizeBlockedReason(card: ConductorJobCard): string | undefined {
  const summary = card.resultSummary?.trim() ?? '';
  const effect = card.effectPreview?.summary?.trim() ?? '';
  const haystack = `${summary}\n${effect}`.toLowerCase();

  if (haystack.includes('einval') || haystack.includes('host browser') || haystack.includes('browser-use')) {
    return '호스트 브라우저(EINVAL)';
  }
  if (
    haystack.includes('wrong repo') ||
    haystack.includes('wrong worktree') ||
    haystack.includes('ownership') ||
    haystack.includes('isolation') ||
    haystack.includes('metalslug')
  ) {
    return '잘못된 레포 착지';
  }
  if (
    haystack.includes('no origin') ||
    haystack.includes('without origin') ||
    haystack.includes('missing remote') ||
    haystack.includes('remote not') ||
    haystack.includes('no remote')
  ) {
    return '원격(origin) 없음';
  }
  if (
    haystack.includes('waiting on parent') ||
    haystack.includes('wait for parent') ||
    haystack.includes('blocked by parent') ||
    haystack.includes('parent job')
  ) {
    return '부모 작업 대기';
  }
  if (haystack.includes('needs_user') || card.status === 'needs_user') {
    return '사용자 입력 대기';
  }
  if (summary.length > 0) {
    return truncateReason(summary);
  }
  if (effect.length > 0) {
    return truncateReason(effect);
  }
  return undefined;
}

function truncateReason(text: string, max = 64): string {
  const oneLine = text.replace(/\s+/gu, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function isTerminal(status: ConductorJobCard['status']): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

function isActive(status: ConductorJobCard['status']): boolean {
  return status === 'running' || status === 'queued' || status === 'interrupted';
}

function isBlockedish(status: ConductorJobCard['status']): boolean {
  return status === 'blocked' || status === 'needs_user' || status === 'failed';
}

function childOf(
  card: ConductorJobCard,
): SessionOutcomeChild {
  return {
    id: card.id,
    kind: card.kind,
    status: card.status,
    title: card.title,
    ...(card.verifyVerdict === undefined ? {} : { verifyVerdict: card.verifyVerdict }),
    ...(card.debugFixer === undefined ? {} : { debugFixer: card.debugFixer }),
  };
}

function pickRootTitle(root: ConductorJobCard, children: readonly ConductorJobCard[]): string {
  const title = root.title.trim();
  if (title.length > 0 && !/^job[_-]/iu.test(title)) return title;
  const childTitle = children.find((c) => c.title.trim().length > 0 && !/^job[_-]/iu.test(c.title.trim()));
  if (childTitle !== undefined) return childTitle.title.trim();
  return title.length > 0 ? title : root.id;
}

function classifyOutcome(
  root: ConductorJobCard,
  children: readonly ConductorJobCard[],
): Pick<SessionOutcomeRow, 'bucket' | 'status' | 'statusLabel' | 'token' | 'reason'> {
  const all = [root, ...children];
  const hasBlocked = all.some((c) => c.status === 'blocked' || c.status === 'needs_user');
  const hasFailed = all.some((c) => c.status === 'failed');
  const hasRunning = all.some((c) => c.status === 'running');
  const hasWaiting = all.some((c) => c.status === 'queued' || c.status === 'interrupted');
  const allTerminal = all.every((c) => isTerminal(c.status));
  const allDone = all.every((c) => c.status === 'done' || c.status === 'cancelled');

  const verifyChildren = children.filter((c) => c.kind === 'verify');
  const verifyPassed =
    verifyChildren.length > 0 &&
    verifyChildren.every(
      (c) => c.verifyVerdict === 'passed' || (c.status === 'done' && c.verifyVerdict !== 'failed'),
    );
  const rootFailedButVerifyPass =
    root.status === 'failed' &&
    verifyPassed &&
    !children.some((c) => c.verifyVerdict === 'failed');

  if (rootFailedButVerifyPass) {
    return {
      bucket: 'done',
      status: 'code_pass_ledger_fail',
      statusLabel: STATUS_LABEL.code_pass_ledger_fail,
      token: STATUS_TOKEN.code_pass_ledger_fail,
      reason: '코드 통과, 장부 실패(환경)',
    };
  }

  if (hasBlocked || (hasFailed && !allDone)) {
    const blocker =
      all.find((c) => c.status === 'blocked' || c.status === 'needs_user') ??
      all.find((c) => c.status === 'failed');
    return {
      bucket: 'blocked',
      status: 'blocked',
      statusLabel: STATUS_LABEL.blocked,
      token: STATUS_TOKEN.blocked,
      reason: blocker === undefined ? undefined : summarizeBlockedReason(blocker),
    };
  }

  if (allDone || (allTerminal && !hasFailed)) {
    return {
      bucket: 'done',
      status: 'done',
      statusLabel: STATUS_LABEL.done,
      token: STATUS_TOKEN.done,
    };
  }

  // Parent done, only verify/merge still open.
  if (
    isTerminal(root.status) &&
    children.some((c) => isActive(c.status) || isBlockedish(c.status)) &&
    children.every((c) => AUTO_CHILD_KINDS.has(c.kind) || c.debugFixer === true)
  ) {
    const open = children.find((c) => !isTerminal(c.status));
    if (open?.kind === 'verify' || children.some((c) => c.kind === 'verify' && !isTerminal(c.status))) {
      return {
        bucket: 'remaining',
        status: 'verify_only',
        statusLabel: STATUS_LABEL.verify_only,
        token: STATUS_TOKEN.verify_only,
      };
    }
  }

  if (hasRunning) {
    return {
      bucket: 'remaining',
      status: 'running',
      statusLabel: STATUS_LABEL.running,
      token: STATUS_TOKEN.running,
    };
  }

  if (hasWaiting || !allTerminal) {
    return {
      bucket: 'remaining',
      status: 'waiting',
      statusLabel: STATUS_LABEL.waiting,
      token: STATUS_TOKEN.waiting,
      reason: hasWaiting ? '큐/재개 대기' : undefined,
    };
  }

  return {
    bucket: 'done',
    status: 'done',
    statusLabel: STATUS_LABEL.done,
    token: STATUS_TOKEN.done,
  };
}

function sortOutcomes(rows: SessionOutcomeRow[]): SessionOutcomeRow[] {
  return rows.toSorted(
    (a, b) => b.priority - a.priority || b.updatedAtMs - a.updatedAtMs,
  );
}

/**
 * Group flat job cards into session outcomes.
 * Auto verify/debug/merge/push children collapse under their parent.
 */
export function buildSessionOutcomeBoard(
  cards: readonly ConductorJobCard[],
): SessionOutcomeBoard {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const childrenByParent = new Map<string, ConductorJobCard[]>();
  const roots: ConductorJobCard[] = [];

  for (const card of cards) {
    if (isAutoOutcomeChild(card) && byId.has(card.parentJobId!)) {
      const list = childrenByParent.get(card.parentJobId!) ?? [];
      list.push(card);
      childrenByParent.set(card.parentJobId!, list);
      continue;
    }
    roots.push(card);
  }

  // Orphan auto-children whose parent is not in the snapshot still surface as roots.
  for (const card of cards) {
    if (!isAutoOutcomeChild(card)) continue;
    if (card.parentJobId !== undefined && byId.has(card.parentJobId)) continue;
    if (!roots.some((r) => r.id === card.id)) roots.push(card);
  }

  const outcomes: SessionOutcomeRow[] = [];
  for (const root of roots) {
    const children = childrenByParent.get(root.id) ?? [];
    const classified = classifyOutcome(root, children);
    const jobIds = [root.id, ...children.map((c) => c.id)];
    const updatedAtMs = Math.max(root.updatedAtMs, ...children.map((c) => c.updatedAtMs), 0);
    outcomes.push({
      id: root.id,
      title: pickRootTitle(root, children),
      ...classified,
      primaryJobId: root.id,
      jobIds,
      children: children.map(childOf),
      collapsedChildCount: children.length,
      priority: Math.max(root.priority, ...children.map((c) => c.priority), 0),
      updatedAtMs,
    });
  }

  const blocked = sortOutcomes(outcomes.filter((o) => o.bucket === 'blocked'));
  const remaining = sortOutcomes(outcomes.filter((o) => o.bucket === 'remaining'));
  const done = sortOutcomes(outcomes.filter((o) => o.bucket === 'done'));

  return {
    blocked,
    remaining,
    done,
    totalJobs: cards.length,
    totalOutcomes: outcomes.length,
  };
}

/** Flat ordered list for rendering: 막힘 → 남음 → 끝남. */
export function flattenSessionOutcomes(board: SessionOutcomeBoard): SessionOutcomeRow[] {
  return BUCKET_ORDER.flatMap((bucket) => board[bucket]);
}

export function sessionOutcomeBucketLabel(bucket: SessionOutcomeBucket): string {
  switch (bucket) {
    case 'blocked':
      return '막힘';
    case 'remaining':
      return '남음';
    case 'done':
      return '끝남';
  }
}

/** One plain-text line for a row (tests / ANSI-free dump). */
export function formatSessionOutcomeLine(row: SessionOutcomeRow): string {
  const child =
    row.collapsedChildCount > 0 ? ` · 자식 ${String(row.collapsedChildCount)}` : '';
  const reason = row.reason !== undefined && row.reason.length > 0 ? ` — ${row.reason}` : '';
  return `[${row.statusLabel}] ${row.title}${child}${reason}`;
}

/**
 * Whether the session board is worth opening.
 * Empty sessions and single-job sessions stay quiet (no composer takeover).
 */
export function shouldOpenSessionOutcomeBoard(jobCount: number): boolean {
  return jobCount >= 2;
}
