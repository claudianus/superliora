import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_PROFILES } from '../../src/profile';
import {
  resolveMainAgentProfileName,
  SOVEREIGN_CONDUCTOR_PROFILE_NAME,
} from '../../src/profile/main-profile';

/**
 * Conductor delegation-only tool-surface snapshot (meta-orchestrator v2
 * contract §2.2 b-1/b-3, V1 gate). Breaking this snapshot means the conductor
 * lane exposes direct-work tools again — merge blocker by contract.
 */
describe('conductor delegation-only tool surface', () => {
  it('excludes file-mutation tools from the conductor profile', () => {
    const tools = DEFAULT_AGENT_PROFILES['conductor']?.tools ?? [];
    expect(tools.length).toBeGreaterThan(0);
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
    expect(tools).not.toContain('ApplyPatch');
  });

  it('keeps the Job desk, lifecycle spine, and read-only waist within ≤30 tools', () => {
    const tools = DEFAULT_AGENT_PROFILES['conductor']?.tools ?? [];
    expect(tools.length).toBeLessThanOrEqual(30);
    expect(tools).toEqual(
      expect.arrayContaining([
        // Job ledger desk — the only delegation means (§2.1 item 2)
        'JobCreate',
        'JobList',
        'JobInspect',
        'JobSteer',
        'JobCancel',
        'JobResume',
        'JobInbox',
        'MergeJob',
        // Plan/goal lifecycle management (§2.1 item 5)
        'EnterPlanMode',
        'NextPhase',
        'ExitPlanMode',
        'RecordInterviewFinding',
        'CreateGoal',
        'GetGoal',
        'UpdateGoal',
        // Clarification + skills (§2.1 items 4, 6)
        'AskUserQuestion',
        'Skill',
        'SearchSkill',
        // Read-only query waist (§2.1 item 3)
        'Read',
        'Grep',
        'Glob',
        'RepoQuery',
        'TodoList',
      ]),
    );
  });

  it('hard-defaults the main profile to conductor with no mutation tools', () => {
    expect(resolveMainAgentProfileName(undefined, {})).toBe(SOVEREIGN_CONDUCTOR_PROFILE_NAME);
    const tools = DEFAULT_AGENT_PROFILES[SOVEREIGN_CONDUCTOR_PROFILE_NAME]?.tools ?? [];
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
    expect(tools).not.toContain('ApplyPatch');
  });
});
