/**
 * Never-Halt circuit breaker visibility — Ops + Settings formatting.
 * Reads optional SessionStatus.circuitBreakers; falls back to runtimeDegraded.
 */

export interface RuntimeDegradedLike {
  readonly scope: string;
  readonly reason: string;
  readonly hint?: string;
  /** Footer/Ops TTL anchor when sourced from runtimeDegraded AppState. */
  readonly atMs?: number;
}

export interface CircuitBreakerScopeLike {
  readonly id: string;
  readonly state: string;
  readonly failures: number;
  readonly lastTripReason?: string;
}

export interface CircuitBreakerStatusLike {
  readonly closed: number;
  readonly open: number;
  readonly halfOpen: number;
  readonly scopes?: ReadonlyArray<CircuitBreakerScopeLike>;
  readonly lastTripReason?: string;
}

const NEVER_HALT_BREAKER_HINT = 'breakers: see /settings never-halt';

/** Compact one-liner for Ops Runtime Health pane. */
export function formatOpsBreakerLine(
  breakers: CircuitBreakerStatusLike | undefined,
  degraded: RuntimeDegradedLike | null | undefined,
): string {
  if (breakers !== undefined) {
    const { closed, open, halfOpen } = breakers;
    const parts = [`${String(open)} open`];
    if (halfOpen > 0) {
      parts.push(`${String(halfOpen)} half`);
    }
    parts.push(`${String(closed)} closed`);
    const trip =
      breakers.lastTripReason ??
      breakers.scopes?.find((s) => s.state !== 'closed')?.lastTripReason;
    const tripSuffix = trip != null && trip.trim().length > 0 ? ` · last: ${truncate(trip, 36)}` : '';
    return `Breakers: ${parts.join(' · ')}${tripSuffix}`;
  }

  if (degraded != null) {
    return `Breakers: ${degraded.scope}↓ · ${truncate(degraded.reason, 40)} · ${NEVER_HALT_BREAKER_HINT}`;
  }

  return `Breakers: (no trips) · ${NEVER_HALT_BREAKER_HINT}`;
}

/** Detail lines for Settings → Never-Halt circuit breaker section. */
export function formatNeverHaltBreakerLines(
  breakers: CircuitBreakerStatusLike | undefined,
  degraded: RuntimeDegradedLike | null | undefined,
): string[] {
  if (breakers !== undefined) {
    const lines = [
      `Counts: ${String(breakers.open)} open · ${String(breakers.halfOpen)} half · ${String(breakers.closed)} closed`,
    ];
    const scopes = breakers.scopes ?? [];
    if (scopes.length === 0) {
      lines.push('Scopes: (none tripped yet)');
    } else {
      for (const scope of scopes) {
        const reason =
          scope.lastTripReason != null && scope.lastTripReason.trim().length > 0
            ? ` · ${truncate(scope.lastTripReason, 48)}`
            : '';
        lines.push(`  · ${scope.id}: ${scope.state} (fail×${String(scope.failures)})${reason}`);
      }
    }
    const lastTrip =
      breakers.lastTripReason ??
      scopes.find((s) => s.lastTripReason != null)?.lastTripReason;
    if (lastTrip != null && lastTrip.trim().length > 0) {
      lines.push(`Last trip: ${truncate(lastTrip, 64)}`);
    }
    return lines;
  }

  const lines: string[] = [];
  if (degraded != null) {
    lines.push(`Last trip (${degraded.scope}): ${truncate(degraded.reason, 64)}`);
    if (degraded.hint != null && degraded.hint.trim().length > 0) {
      lines.push(`Hint: ${truncate(degraded.hint.trim(), 64)}`);
    }
  } else {
    lines.push('Scopes: (no live breaker status)');
  }
  lines.push(NEVER_HALT_BREAKER_HINT);
  return lines;
}

function truncate(text: string, max: number): string {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}
