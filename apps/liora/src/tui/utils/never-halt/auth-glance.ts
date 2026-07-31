/**
 * OAuth / auth glance for Ops Runtime Health and Never-Halt settings.
 * Reads runtimeDegraded + optional pool status fields — no live token introspection.
 */

import type { PermissionMode } from '@superliora/sdk';
import { listProviderOAuthRefs } from '@superliora/oauth';

import { formatDurationShort } from '#/tui/features/transcript/transcript-density';
import { OAUTH_PROACTIVE_REFRESH_INTERVAL_MS } from '#/utils/oauth/proactive-refresh-host';

import type { RuntimeDegradedLike } from './breaker-summary';
import { RUNTIME_DEGRADED_BADGE_TTL_MS } from './runtime-degraded';

/** Human label for the host proactive refresh poll interval. */
export function formatOAuthProactivePollLabel(
  intervalMs: number = OAUTH_PROACTIVE_REFRESH_INTERVAL_MS,
): string {
  const minutes = Math.max(1, Math.round(intervalMs / 60_000));
  return `~${String(minutes)}min`;
}

export const OAUTH_PROACTIVE_POLL_LABEL = formatOAuthProactivePollLabel();

/** Compact Ops ok-line — proactive refresh + multi-account pool. */
export const OPS_AUTH_OK_ACCOUNTS_TIP = `proactive refresh · /accounts pool`;
export const OPS_AUTH_OK_SECRETS_TIP = 'set provider keys';

/** Accounts list picker subtitle — Never-Halt OAuth resilience (W14). */
export const ACCOUNTS_POOL_RESILIENCE_HINT =
  'Proactive refresh keeps tokens warm · pool fails over on 401/quota';

/** Optional OAuth pool snapshot — SessionStatus.oauth or config-derived. */
export interface OAuthPoolGlanceLike {
  readonly poolSize?: number;
  readonly nextRefreshAtMs?: number;
}

export interface OpsAuthGlanceInput {
  readonly degraded?: RuntimeDegradedLike | null;
  /** When true, ok-line nudges toward provider/env secrets instead of /accounts. */
  readonly secretsMissing?: boolean;
  /** When true, append a one-line ok tip; default true for input objects. */
  readonly showOkTip?: boolean;
  readonly poolSize?: number;
  readonly nextRefreshAtMs?: number;
  readonly nowMs?: number;
}

/** Soft-resolve pool fields from SessionStatus-shaped objects when wired. */
export function resolveOAuthPoolGlanceFromStatus(status: unknown): OAuthPoolGlanceLike | undefined {
  if (status === null || status === undefined || typeof status !== 'object') return undefined;
  const record = status as Record<string, unknown>;
  const oauth = record.oauth;
  if (oauth !== null && oauth !== undefined && typeof oauth === 'object') {
    const fromOAuth = pickOAuthPoolGlanceFields(oauth as Record<string, unknown>);
    if (fromOAuth !== undefined) return fromOAuth;
  }
  return pickOAuthPoolGlanceFields(record);
}

/** Derive pool size from provider config when status fields are absent. */
export function resolveOAuthPoolGlanceFromConfig(
  providers: Readonly<Record<string, unknown>> | undefined,
  providerId?: string,
): OAuthPoolGlanceLike | undefined {
  if (providers === undefined) return undefined;

  if (providerId !== undefined && providerId.trim().length > 0) {
    const provider = providers[providerId];
    if (provider !== null && provider !== undefined && typeof provider === 'object') {
      const size = listProviderOAuthRefs(provider as Record<string, unknown>).length;
      return size > 0 ? { poolSize: size } : undefined;
    }
    return undefined;
  }

  let maxPool = 0;
  for (const raw of Object.values(providers)) {
    if (raw === null || raw === undefined || typeof raw !== 'object') continue;
    const size = listProviderOAuthRefs(raw as Record<string, unknown>).length;
    if (size > maxPool) maxPool = size;
  }
  return maxPool > 0 ? { poolSize: maxPool } : undefined;
}

/** Merge status-first pool glance with config fallback. */
export function resolveOAuthPoolGlance(
  status: unknown,
  providers: Readonly<Record<string, unknown>> | undefined,
  providerId?: string,
): OAuthPoolGlanceLike | undefined {
  const fromStatus = resolveOAuthPoolGlanceFromStatus(status);
  const fromConfig = resolveOAuthPoolGlanceFromConfig(providers, providerId);
  if (fromStatus === undefined) return fromConfig;
  if (fromConfig === undefined) return fromStatus;
  return { ...fromConfig, ...fromStatus };
}

/** Ops Auth SSOT — SessionStatus.oauth (+ config fallback) → Runtime Health auth line. */
export function formatOpsAuthLineFromSessionStatus(input: {
  readonly degraded?: RuntimeDegradedLike | null;
  readonly secretsMissing?: boolean;
  readonly showOkTip?: boolean;
  readonly status?: unknown;
  readonly providers?: Readonly<Record<string, unknown>>;
  readonly providerId?: string;
  readonly nowMs?: number;
}): string {
  const glance = resolveOAuthPoolGlance(input.status, input.providers, input.providerId);
  return formatOpsAuthLine({
    degraded: input.degraded,
    secretsMissing: input.secretsMissing,
    showOkTip: input.showOkTip,
    poolSize: glance?.poolSize,
    nextRefreshAtMs: glance?.nextRefreshAtMs,
    nowMs: input.nowMs,
  });
}

/** Never-Halt live OAuth row when pool / next refresh fields exist. */
export function formatNeverHaltOAuthLiveLine(
  glance: OAuthPoolGlanceLike | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  const detail = formatOAuthPoolOkDetail(glance, nowMs);
  return detail !== null ? `Live: ${detail}` : null;
}

/** Settings → Never-Halt OAuth section (SSOT §2.4). */
export function buildNeverHaltOAuthResilienceLines(
  glance?: OAuthPoolGlanceLike | null,
  nowMs: number = Date.now(),
): readonly string[] {
  const liveLine = formatNeverHaltOAuthLiveLine(glance, nowMs);
  return [
    '── OAuth proactive refresh ─────────────────',
    'Tokens refresh before expiry (packages/oauth threshold).',
    `Host polls ensureFresh every ${OAUTH_PROACTIVE_POLL_LABEL} (run-shell / run-prompt).`,
    'Multi-account pool: primary sticky → failover on 401/quota.',
    'Refresh fail: oauth↓ badge; Goal continues — /login or Settings → Accounts.',
    'Add fallback slots: /login --add · promote via Settings → Accounts.',
    ...(liveLine !== null ? [liveLine] : []),
  ];
}

/** Settings → Providers & API — OAuth resilience tips. */
export function oauthAccountsResilienceTips(): readonly string[] {
  return [
    `· Proactive refresh — host polls ensureFresh every ${OAUTH_PROACTIVE_POLL_LABEL}; oauth↓ = re-login`,
    '· Account pool — /login --add for fallback slots · Settings → Accounts to promote/label/remove',
    '· Quota/401 failover — primary sticky; runtime rotates to the next pool account automatically',
  ];
}

/** Compact permission row for Ops Runtime Health — live session SSOT when wired. */
export function formatOpsPermissionLine(
  mode: PermissionMode,
  sessionMode?: PermissionMode | undefined,
): string {
  if (sessionMode !== undefined && sessionMode !== mode) {
    return `Permission: ${mode} (TUI) · session ${sessionMode}`;
  }
  if (sessionMode !== undefined) {
    return mode === 'yolo'
      ? 'Permission: yolo · live session · trusted workspace assumed'
      : `Permission: ${mode} · live session confirms`;
  }
  return mode === 'yolo'
    ? 'Permission: yolo · trusted workspace assumed'
    : `Permission: ${mode}`;
}

/** Compact one-liner for Ops Runtime Health pane. */
export function formatOpsAuthLine(
  input: OpsAuthGlanceInput | RuntimeDegradedLike | null | undefined,
): string {
  const normalized = normalizeOpsAuthGlanceInput(input);
  const { degraded, secretsMissing, showOkTip, poolSize, nextRefreshAtMs, nowMs } = normalized;

  if (degraded?.scope === 'oauth') {
    const reason = truncate(degraded.reason, 40);
    const hint =
      degraded.hint != null && degraded.hint.trim().length > 0
        ? ` · ${truncate(degraded.hint.trim(), 32)}`
        : '';
    const ttl =
      degraded.atMs !== undefined
        ? formatOAuthDegradedTtlSuffix(degraded.atMs, nowMs ?? Date.now())
        : '';
    return `Auth: refresh due · ${reason}${hint}${ttl}`;
  }

  if (showOkTip !== true) {
    const poolDetail = formatOAuthPoolOkDetail({ poolSize, nextRefreshAtMs }, nowMs ?? Date.now());
    return poolDetail !== null ? `Auth: ok · ${poolDetail}` : 'Auth: ok';
  }

  const poolDetail = formatOAuthPoolOkDetail({ poolSize, nextRefreshAtMs }, nowMs ?? Date.now());
  if (poolDetail !== null) {
    return `Auth: ok · ${poolDetail}`;
  }

  const tip = secretsMissing === true ? OPS_AUTH_OK_SECRETS_TIP : OPS_AUTH_OK_ACCOUNTS_TIP;
  return `Auth: ok · ${tip}`;
}

function pickOAuthPoolGlanceFields(record: Record<string, unknown>): OAuthPoolGlanceLike | undefined {
  const poolSize =
    typeof record.poolSize === 'number' && Number.isFinite(record.poolSize) && record.poolSize > 0
      ? Math.floor(record.poolSize)
      : undefined;
  const nextRefreshAtMs =
    typeof record.nextRefreshAtMs === 'number' && Number.isFinite(record.nextRefreshAtMs)
      ? record.nextRefreshAtMs
      : typeof record.nextProactiveRefreshAtMs === 'number' &&
          Number.isFinite(record.nextProactiveRefreshAtMs)
        ? record.nextProactiveRefreshAtMs
        : undefined;
  if (poolSize === undefined && nextRefreshAtMs === undefined) return undefined;
  return {
    ...(poolSize !== undefined ? { poolSize } : {}),
    ...(nextRefreshAtMs !== undefined ? { nextRefreshAtMs } : {}),
  };
}

function formatOAuthPoolOkDetail(
  glance: OAuthPoolGlanceLike | null | undefined,
  nowMs: number,
): string | null {
  if (glance === null || glance === undefined) return null;
  const parts: string[] = [];
  if (glance.poolSize !== undefined && glance.poolSize > 0) {
    parts.push(`pool×${String(glance.poolSize)}`);
  }
  if (glance.nextRefreshAtMs !== undefined) {
    const delta = glance.nextRefreshAtMs - nowMs;
    parts.push(delta <= 0 ? 'refresh due' : `next refresh ${formatDurationShort(delta)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatOAuthDegradedTtlSuffix(atMs: number, nowMs: number): string {
  const remaining = RUNTIME_DEGRADED_BADGE_TTL_MS - (nowMs - atMs);
  if (remaining <= 0) return '';
  return ` · oauth↓ ${formatDurationShort(remaining)}`;
}

function normalizeOpsAuthGlanceInput(
  input: OpsAuthGlanceInput | RuntimeDegradedLike | null | undefined,
): OpsAuthGlanceInput & { readonly showOkTip: boolean | undefined; readonly nowMs: number | undefined } {
  if (input === null || input === undefined) {
    return { degraded: input, showOkTip: false, nowMs: undefined };
  }
  if ('scope' in input && 'reason' in input) {
    const nowMs =
      'nowMs' in input && typeof input.nowMs === 'number' ? input.nowMs : undefined;
    return { degraded: input, showOkTip: false, nowMs };
  }
  return {
    degraded: input.degraded,
    secretsMissing: input.secretsMissing,
    showOkTip: input.showOkTip ?? true,
    poolSize: input.poolSize,
    nextRefreshAtMs: input.nextRefreshAtMs,
    nowMs: input.nowMs,
  };
}

function truncate(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}
