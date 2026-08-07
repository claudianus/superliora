import {
  AGENT_SWARM_MAX_CONCURRENCY_ENV,
  DEFAULT_SWARM_MAX_CONCURRENCY,
} from './subagent-batch-constants';

export { DEFAULT_SWARM_MAX_CONCURRENCY };

/**
 * Resolve the subagent normal-phase concurrency cap from the environment.
 *
 * Unset/empty/invalid values fall back to {@link DEFAULT_SWARM_MAX_CONCURRENCY}
 * so swarms never run fully uncapped by accident. A present positive integer wins.
 */
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
