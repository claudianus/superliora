const AGENT_SWARM_MAX_CONCURRENCY_ENV = 'SUPERLIORA_AGENT_SWARM_MAX_CONCURRENCY';
export const DEFAULT_SWARM_MAX_CONCURRENCY = 16;

/** Resolve the operator-selected launch capacity, preserving the resource default. */
export function resolveSwarmMaxConcurrency(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = env[AGENT_SWARM_MAX_CONCURRENCY_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_SWARM_MAX_CONCURRENCY;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return DEFAULT_SWARM_MAX_CONCURRENCY;
  }
  return value;
}
