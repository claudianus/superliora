/**
 * Agent Dashboard row helpers — group sessions by live operator status and
 * mask secret-like last_prompt text before it hits the TUI.
 *
 * Status is derived from optional live hints (not stored on SessionSummary yet).
 * Callers may pass an explicit status override per session id.
 */

import type { SessionSummary } from '@superliora/sdk';

/** Operator-facing live status for multi-session dashboard. */
export type DashboardSessionStatus = 'needs_input' | 'working' | 'idle';

/** Stable group order for the dashboard body (mission-critical first). */
export const DASHBOARD_GROUP_ORDER = ['needs_input', 'working', 'idle'] as const;

export type DashboardGroupId = (typeof DASHBOARD_GROUP_ORDER)[number];

/** Korean labels for dashboard groups (user-facing). */
export const DASHBOARD_GROUP_LABELS_KO: Readonly<Record<DashboardGroupId, string>> = {
  needs_input: '입력 필요',
  working: '작업 중',
  idle: '대기',
};

/** Compact badge tokens shown next to each row. */
export const DASHBOARD_STATUS_BADGE_KO: Readonly<Record<DashboardSessionStatus, string>> = {
  needs_input: '입력',
  working: '작업',
  idle: '대기',
};

export interface DashboardSessionRow {
  readonly id: string;
  readonly title: string | null;
  /** Masked last prompt — never contains raw secret-like values. */
  readonly last_prompt: string | null;
  readonly work_dir: string;
  readonly updated_at: number;
  readonly status: DashboardSessionStatus;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface DashboardGroup {
  readonly id: DashboardGroupId;
  readonly label: string;
  readonly sessions: readonly DashboardSessionRow[];
}

export type DashboardStatusHints = Readonly<Record<string, DashboardSessionStatus>>;

/**
 * Secret-like patterns in last_prompt. Match key=value / bearer tokens without
 * capturing or logging the secret value itself.
 */
const SECRET_ASSIGNMENT =
  /\b([A-Za-z_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)[A-Za-z_]*)\s*[=:]\s*([^\s'"]+)/gi;
const BEARER_TOKEN = /\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi;
const LONG_HEX_OR_B64 = /\b(?:sk|pk|rk|ghp|gho|xox[baprs])-[A-Za-z0-9\-_]{8,}\b/g;
const ENV_EXPORT =
  /\b(?:export\s+)?([A-Za-z_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Za-z_]*)\s*=\s*(['"]?)[^\s'"]+\2/gi;

const MASK = '***';

/**
 * Mask secret-like substrings in operator-visible prompt previews.
 * Never returns the original secret value.
 */
export function maskSecretLikePrompt(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  let out = trimmed;
  out = out.replace(SECRET_ASSIGNMENT, (_m, name: string) => `${name}=${MASK}`);
  out = out.replace(ENV_EXPORT, (_m, name: string) => `${name}=${MASK}`);
  out = out.replace(BEARER_TOKEN, '$1 ***');
  out = out.replace(LONG_HEX_OR_B64, MASK);
  return out;
}

/**
 * Infer dashboard status from optional metadata / live hints.
 * Priority: explicit hint → metadata.dashboardStatus → metadata.pendingApproval → idle.
 */
export function resolveDashboardStatus(
  session: SessionSummary,
  hints?: DashboardStatusHints,
): DashboardSessionStatus {
  const hinted = hints?.[session.id];
  if (hinted !== undefined) return hinted;

  const meta = session.metadata;
  if (meta !== undefined) {
    const raw = meta['dashboardStatus'] ?? meta['liveStatus'] ?? meta['status'];
    if (raw === 'needs_input' || raw === 'working' || raw === 'idle') {
      return raw;
    }
    if (meta['pendingApproval'] === true || meta['needsInput'] === true) {
      return 'needs_input';
    }
    if (
      meta['streaming'] === true ||
      meta['isWorking'] === true ||
      meta['busy'] === true
    ) {
      return 'working';
    }
  }

  return 'idle';
}

/**
 * Build flat dashboard rows from session summaries.
 * Always masks last_prompt.
 */
export function dashboardRowsFromSessions(
  sessions: readonly SessionSummary[],
  options: {
    readonly currentSessionId?: string;
    readonly currentSessionHasContent?: boolean;
    readonly statusHints?: DashboardStatusHints;
  } = {},
): DashboardSessionRow[] {
  const currentSessionId = options.currentSessionId;
  const currentSessionHasContent = options.currentSessionHasContent ?? true;

  return sessions
    .filter((session) => {
      if (currentSessionId === undefined) return true;
      if (currentSessionHasContent) return true;
      return session.id !== currentSessionId;
    })
    .map((session) => ({
      id: session.id,
      title: session.title ?? null,
      last_prompt: maskSecretLikePrompt(session.lastPrompt),
      work_dir: session.workDir,
      updated_at: session.updatedAt ?? session.createdAt ?? 0,
      status: resolveDashboardStatus(session, options.statusHints),
      metadata: session.metadata,
    }));
}

/**
 * Group rows into Needs input → Working → Idle. Empty groups are omitted
 * only when `omitEmpty` is true (default false so operators see all buckets).
 */
export function groupDashboardRows(
  rows: readonly DashboardSessionRow[],
  options: { readonly omitEmpty?: boolean; readonly labels?: Readonly<Record<DashboardGroupId, string>> } = {},
): DashboardGroup[] {
  const labels = options.labels ?? DASHBOARD_GROUP_LABELS_KO;
  const omitEmpty = options.omitEmpty ?? false;
  const buckets: Record<DashboardGroupId, DashboardSessionRow[]> = {
    needs_input: [],
    working: [],
    idle: [],
  };

  for (const row of rows) {
    buckets[row.status].push(row);
  }

  // Within each group: most recently updated first.
  for (const id of DASHBOARD_GROUP_ORDER) {
    buckets[id].sort((a, b) => b.updated_at - a.updated_at);
  }

  const groups: DashboardGroup[] = [];
  for (const id of DASHBOARD_GROUP_ORDER) {
    const sessions = buckets[id];
    if (omitEmpty && sessions.length === 0) continue;
    groups.push({ id, label: labels[id], sessions });
  }
  return groups;
}

/** Flatten groups into a single selection list (preserves group order). */
export function flattenDashboardGroups(
  groups: readonly DashboardGroup[],
): readonly DashboardSessionRow[] {
  const out: DashboardSessionRow[] = [];
  for (const group of groups) {
    out.push(...group.sessions);
  }
  return out;
}

/** Count sessions per group for the chrome summary line. */
export function dashboardGroupCounts(
  groups: readonly DashboardGroup[],
): Readonly<Record<DashboardGroupId, number>> {
  return {
    needs_input: groups.find((g) => g.id === 'needs_input')?.sessions.length ?? 0,
    working: groups.find((g) => g.id === 'working')?.sessions.length ?? 0,
    idle: groups.find((g) => g.id === 'idle')?.sessions.length ?? 0,
  };
}
