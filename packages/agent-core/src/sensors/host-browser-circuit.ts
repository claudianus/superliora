/**
 * Session-scoped host-browser spawn circuit.
 *
 * Windows spawn EINVAL is a host skip, not a product visual fail. After two
 * EINVAL hits in a session, BrowserStatus / VerifySurface must stop retrying.
 */

/** Host browser spawn class — EINVAL is host skip, not product visual quality. */
export type HostBrowserSensorStatus = 'einval' | 'missing' | 'ok';

export const HOST_BROWSER_EINVAL_RETRY_LIMIT = 2;

interface HostBrowserCircuitState {
  readonly status: HostBrowserSensorStatus | 'unknown';
  readonly einvalCount: number;
  readonly open: boolean;
  readonly probed: boolean;
}

const EMPTY_CIRCUIT: HostBrowserCircuitState = {
  status: 'unknown',
  einvalCount: 0,
  open: false,
  probed: false,
};

const circuits = new Map<string, HostBrowserCircuitState>();

export function resetHostBrowserCircuitsForTests(): void {
  circuits.clear();
}

export function hostBrowserCircuitSessionKey(homedir: string | undefined): string {
  const trimmed = homedir?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : 'default';
}

export function readHostBrowserCircuit(sessionKey: string): HostBrowserCircuitState {
  return circuits.get(sessionKey) ?? EMPTY_CIRCUIT;
}

export function hostBrowserCircuitShouldSkip(
  state: HostBrowserCircuitState | undefined,
): boolean {
  if (state === undefined) return false;
  return state.open === true || state.einvalCount >= HOST_BROWSER_EINVAL_RETRY_LIMIT;
}

export function recordHostBrowserCircuitHit(
  sessionKey: string,
  status: HostBrowserSensorStatus,
): HostBrowserCircuitState {
  const prev = readHostBrowserCircuit(sessionKey);
  const einvalCount = status === 'einval' ? prev.einvalCount + 1 : prev.einvalCount;
  const next: HostBrowserCircuitState = {
    status,
    einvalCount,
    probed: true,
    open: status === 'einval' && einvalCount >= HOST_BROWSER_EINVAL_RETRY_LIMIT,
  };
  circuits.set(sessionKey, next);
  return next;
}

export function markHostBrowserCircuitProbed(
  sessionKey: string,
  status: HostBrowserSensorStatus,
): HostBrowserCircuitState {
  if (status === 'einval') return recordHostBrowserCircuitHit(sessionKey, status);
  const next: HostBrowserCircuitState = {
    status,
    einvalCount: readHostBrowserCircuit(sessionKey).einvalCount,
    probed: true,
    open: false,
  };
  circuits.set(sessionKey, next);
  return next;
}

export function countHostBrowserEinvalJobs(
  jobs: readonly { readonly notes?: string; readonly resultSummary?: string }[],
): number {
  let count = 0;
  for (const job of jobs) {
    const hay = `${job.notes ?? ''}\n${job.resultSummary ?? ''}`.toLowerCase();
    if (hay.includes('host_browser=einval') || hay.includes('spawn einval')) {
      count += 1;
    }
  }
  return count;
}

export function sessionHostBrowserShouldEscalate(
  jobs: readonly { readonly notes?: string; readonly resultSummary?: string }[],
): boolean {
  return countHostBrowserEinvalJobs(jobs) >= HOST_BROWSER_EINVAL_RETRY_LIMIT;
}
