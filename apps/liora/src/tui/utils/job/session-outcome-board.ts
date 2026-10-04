/**
 * Session outcome board — groups operator Jobs by their recorded parent.
 *
 * Pure helpers (no TUIState). The Job Deck / Mission Control surfaces call these
 * so the operator sees blocked / remaining / done instead of a flat ledger dump.
 */

import type { ColorToken } from '#/tui/theme';
import { ttui } from '#/tui/utils/tui-i18n';
import type { ConductorJobCard } from './job-strip';

/** Outcome-level bucket for the session board. Remaining + blocked first. */
export type SessionOutcomeBucket = 'blocked' | 'remaining' | 'done';

/** One-line status shown on each outcome row. */
export type SessionOutcomeStatus =
  | 'done'
  | 'cancelled'
  | 'running'
  | 'waiting'
  | 'blocked';

export interface SessionOutcomeChild {
  readonly id: string;
  readonly kind: string;
  readonly status: ConductorJobCard['status'];
  readonly title: string;
}

export interface SessionOutcomeRow {
  readonly id: string;
  /** User-facing recorded parent title, never raw job_id alone. */
  readonly title: string;
  readonly bucket: SessionOutcomeBucket;
  readonly status: SessionOutcomeStatus;
  readonly statusLabel: string;
  readonly token: ColorToken;
  /** Recorded one-line reason when blocked or waiting. */
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


const STATUS_LABEL_KEY: Record<SessionOutcomeStatus, string> = {
  done: 'tui.jobs.outcomeStatusDone',
  cancelled: 'tui.jobs.outcomeStatusCancelled',
  running: 'tui.jobs.outcomeStatusRunning',
  waiting: 'tui.jobs.outcomeStatusWaiting',
  blocked: 'tui.jobs.outcomeStatusBlocked',
};

const BUCKET_LABEL_KEY: Record<SessionOutcomeBucket, string> = {
  blocked: 'tui.jobs.outcomeBucketBlocked',
  remaining: 'tui.jobs.outcomeBucketRemaining',
  done: 'tui.jobs.outcomeBucketDone',
};

const STATUS_TOKEN: Record<SessionOutcomeStatus, ColorToken> = {
  done: 'success',
  cancelled: 'textDim',
  running: 'primary',
  waiting: 'info',
  blocked: 'error',
};

const BUCKET_ORDER: readonly SessionOutcomeBucket[] = ['blocked', 'remaining', 'done'];

/** True when this operator Job belongs under a parent outcome. */
export function isOutcomeChild(card: ConductorJobCard): boolean {
  return card.parentJobId !== undefined && card.parentJobId.length > 0;
}

/**
 * Recorded one-line block reason from resultSummary or effect.
 * Never invents a reason when nothing is present.
 */
export function summarizeBlockedReason(card: ConductorJobCard): string | undefined {
  const summary = card.resultSummary?.trim() ?? '';
  const effect = card.effectPreview?.summary?.trim() ?? '';
  if (summary.length > 0) {
    return truncateReason(summary);
  }
  if (effect.length > 0) {
    return truncateReason(effect);
  }
  return undefined;
}


function truncateReason(text: string, max = 64): string {
  const oneLine = text.replaceAll(/\s+/gu, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function isTerminal(status: ConductorJobCard['status']): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}


function childOf(
  card: ConductorJobCard,
): SessionOutcomeChild {
  return {
    id: card.id,
    kind: card.kind,
    status: card.status,
    title: card.title,
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
  const hasCancelled = all.some((c) => c.status === 'cancelled');


  if (hasBlocked || hasFailed) {
    const blocker =
      all.find((c) => c.status === 'blocked' || c.status === 'needs_user') ??
      all.find((c) => c.status === 'failed');
    return {
      bucket: 'blocked',
      status: 'blocked',
      statusLabel: ttui(STATUS_LABEL_KEY.blocked),
      token: STATUS_TOKEN.blocked,
      reason: blocker === undefined ? undefined : summarizeBlockedReason(blocker),
    };
  }

  if (allTerminal) {
    const status = hasCancelled ? 'cancelled' : 'done';
    return {
      bucket: 'done',
      status,
      statusLabel: ttui(STATUS_LABEL_KEY[status]),
      token: STATUS_TOKEN[status],
    };
  }


  if (hasRunning) {
    return {
      bucket: 'remaining',
      status: 'running',
      statusLabel: ttui(STATUS_LABEL_KEY.running),
      token: STATUS_TOKEN.running,
    };
  }

  return {
    bucket: 'remaining',
    status: 'waiting',
    statusLabel: ttui(STATUS_LABEL_KEY.waiting),
    token: STATUS_TOKEN.waiting,
    reason: hasWaiting ? ttui('tui.jobs.outcomeWaitingReason') : undefined,
  };
}


function sortOutcomes(rows: SessionOutcomeRow[]): SessionOutcomeRow[] {
  return rows.toSorted(
    (a, b) => b.priority - a.priority || b.updatedAtMs - a.updatedAtMs,
  );
}

/**
 * Group flat job cards into session outcomes.
 * Recorded children collapse under their parent.
 */
export function buildSessionOutcomeBoard(
  cards: readonly ConductorJobCard[],
): SessionOutcomeBoard {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const childrenByParent = new Map<string, ConductorJobCard[]>();
  const roots: ConductorJobCard[] = [];

  for (const card of cards) {
    if (isOutcomeChild(card) && byId.has(card.parentJobId!)) {
      const list = childrenByParent.get(card.parentJobId!) ?? [];
      list.push(card);
      childrenByParent.set(card.parentJobId!, list);
      continue;
    }
    roots.push(card);
  }

  // Orphan children whose parent is absent still surface as roots.
  for (const card of cards) {
    if (!isOutcomeChild(card)) continue;
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

/** Flat ordered list for rendering: blocked → remaining → done. */
export function flattenSessionOutcomes(board: SessionOutcomeBoard): SessionOutcomeRow[] {
  return BUCKET_ORDER.flatMap((bucket) => board[bucket]);
}

export function sessionOutcomeBucketLabel(bucket: SessionOutcomeBucket): string {
  return ttui(BUCKET_LABEL_KEY[bucket]);
}

/** One plain-text line for a row (tests / ANSI-free dump). */
export function formatSessionOutcomeLine(row: SessionOutcomeRow): string {
  const child =
    row.collapsedChildCount > 0
      ? ` · ${ttui('tui.jobs.outcomeChildCount', { n: row.collapsedChildCount })}`
      : '';
  const reason = row.reason !== undefined && row.reason.length > 0 ? ` — ${row.reason}` : '';
  return `[${row.statusLabel}] ${row.title}${child}${reason}`;
}
