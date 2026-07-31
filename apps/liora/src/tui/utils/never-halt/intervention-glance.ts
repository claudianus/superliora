/**
 * Permission intervention queue glance for Ops tray and Never-Halt tips.
 */

import { formatDurationShort } from '#/tui/features/transcript/transcript-density';

/** Soft status tip when a non-blocking approval enters the queue. */
export const INTERVENTION_NEVER_HALT_TIP =
  'Never-Halt: approval queued — Goal continues while you decide';

/** Env var referenced from Settings → Never-Halt for orphan tray cleanup. */
export const PERMISSION_AUTO_EXPIRE_ENV = 'SUPERLIORA_PERMISSION_AUTO_EXPIRE_MS';

/** Never-Halt contract note — independent tools fan out while one approval waits. */
export const INTERVENTION_PARALLEL_TOOLS_NOTE =
  'Independent tool_calls proceed in parallel; only conflicting resources serialize.';

/** Read opt-in orphan TTL from env (mirrors agent-core permission SSOT). */
export function parsePermissionAutoExpireMs(): number | undefined {
  const raw = process.env[PERMISSION_AUTO_EXPIRE_ENV]?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/** Remaining ms until the oldest queued entry hits {@link PERMISSION_AUTO_EXPIRE_ENV}. */
export function interventionAutoExpireRemainingMs(
  oldestAgeMs: number | undefined,
  autoExpireMs: number | undefined = parsePermissionAutoExpireMs(),
): number | undefined {
  if (
    autoExpireMs === undefined ||
    oldestAgeMs === undefined ||
    !Number.isFinite(oldestAgeMs) ||
    oldestAgeMs < 0
  ) {
    return undefined;
  }
  return autoExpireMs - oldestAgeMs;
}

/** Compact countdown for Never-Halt live + Ops tray when auto-expire is configured. */
export function formatInterventionAutoExpireCountdown(
  oldestAgeMs: number | undefined,
  autoExpireMs: number | undefined = parsePermissionAutoExpireMs(),
): string | null {
  const remainingMs = interventionAutoExpireRemainingMs(oldestAgeMs, autoExpireMs);
  if (remainingMs === undefined) return null;
  if (remainingMs <= 0) return 'orphan drop imminent';
  return `orphan drop in ${formatDurationShort(remainingMs)}`;
}

/** Compact age for Ops/Never-Halt queue glance. */
export function formatInterventionAgeMs(ageMs: number | undefined): string {
  if (ageMs === undefined || !Number.isFinite(ageMs) || ageMs < 0) return '?';
  return formatDurationShort(ageMs);
}

/** Ops/Never-Halt line: queue depth + oldest wait age (+ optional stale×N). */
export function formatInterventionQueueOpsLine(
  count: number,
  oldestAgeMs: number | undefined,
  staleCount = 0,
): string | null {
  if (count <= 0) return null;
  const age = formatInterventionAgeMs(oldestAgeMs);
  const staleSuffix = staleCount > 0 ? ` · stale×${String(staleCount)}` : '';
  return `Never-Halt queue: ${String(count)} pending · oldest ${age}${staleSuffix}`;
}

/** Settings → Never-Halt live queue depth from session.getStatus(). */
export function formatInterventionQueueSettingsLine(input: {
  readonly pendingInterventions?: number;
  readonly oldestInterventionAgeMs?: number;
  readonly staleInterventions?: number;
  readonly sessionUnavailable?: boolean;
}): string {
  if (input.sessionUnavailable) {
    return 'Live queue: (session unavailable)';
  }
  const count = input.pendingInterventions ?? 0;
  if (count <= 0) {
    return 'Live queue: (clear) · Goal/Mission/Fleet continue';
  }
  const base =
    formatInterventionQueueOpsLine(
      count,
      input.oldestInterventionAgeMs,
      input.staleInterventions ?? 0,
    ) ?? `Live queue: ${String(count)} pending`;
  const countdown = formatInterventionAutoExpireCountdown(input.oldestInterventionAgeMs);
  return countdown != null ? `${base} · ${countdown}` : base;
}

/** Ops intervention tray hint when entries age past the stale threshold. */
export function formatInterventionAutoExpireOpsHint(
  staleCount: number,
  oldestAgeMs?: number,
): string | null {
  if (staleCount <= 0) return null;
  const countdown = formatInterventionAutoExpireCountdown(oldestAgeMs);
  if (countdown != null) {
    return `Orphans: ${countdown}`;
  }
  return `Orphans: ${PERMISSION_AUTO_EXPIRE_ENV} (Settings → Never-Halt)`;
}
