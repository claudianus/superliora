import type { SandboxEnforcement } from '../config/sandbox-enforcement';
import type { SandboxProfile } from '../tools/policies/path-access';

export interface SandboxPolicyUpdate {
  profile?: SandboxProfile;
  enforcement?: SandboxEnforcement;
}

/** The Agent surface this fan-out needs; kept structural so session/ does not import agent/. */
interface SandboxPolicyHost {
  setSandboxPolicy(policy: SandboxPolicyUpdate): Promise<void>;
}

/**
 * Host-side fan-out only: Agent remains standalone and owns no session graph.
 * Start every update synchronously before awaiting any probe, so existing
 * children cannot keep a ready gate while the main Agent is pending or failed.
 * RPC callers must await this before acknowledging a metadata policy update.
 */
export function applySandboxPolicyToAgents(
  agents: Iterable<SandboxPolicyHost>,
  policy: SandboxPolicyUpdate,
): Promise<void> {
  const updates: Promise<void>[] = [];
  for (const agent of agents) {
    try {
      updates.push(agent.setSandboxPolicy(policy));
    } catch (error) {
      // One host's synchronous failure must not skip invalidating later Agents.
      updates.push(Promise.reject(error));
    }
  }
  return Promise.allSettled(updates).then(results => {
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Sandbox policy activation failed for one or more Agents.');
    }
  });
}

/** Combine a child policy with the host's minimum without weakening either. */
export function sandboxPolicyAtLeast(
  policy: SandboxPolicyUpdate,
  minimum: SandboxPolicyUpdate = {},
): SandboxPolicyUpdate {
  const profiles = ['off', 'workspace', 'read-only'] as const;
  return {
    profile: profiles[Math.max(profiles.indexOf(policy.profile ?? 'off'), profiles.indexOf(minimum.profile ?? 'off'))]!,
    enforcement: policy.enforcement === 'process' || minimum.enforcement === 'process' ? 'process' : 'lexical',
  };
}
