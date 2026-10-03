import { DEFAULT_AGENT_PROFILES } from './default';
import type { ResolvedAgentProfile } from './types';

export function resolveMainAgentProfile(): ResolvedAgentProfile {
  return DEFAULT_AGENT_PROFILES.agent;
}
