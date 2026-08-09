import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_PROFILES, type SystemPromptContext } from '../../src/profile';
import {
  resolveMainAgentProfileName,
  SOVEREIGN_CONDUCTOR_PROFILE_NAME,
} from '../../src/profile/main-profile';

const promptContext: SystemPromptContext = {
  osEnv: {
    osKind: 'macOS',
    osArch: 'arm64',
    osVersion: '0',
    shellName: 'bash',
    shellPath: '/bin/bash',
  },
  cwd: '/workspace',
  now: '2026-05-09T00:00:00.000Z',
  cwdListing: 'README.md',
  agentsMd: 'Project instructions.',
  skills: 'Available test skills.',
};

/**
 * Conductor delegation-only tool-surface snapshot (meta-orchestrator v2
 * contract §2.2 b-1/b-3, V1 gate). Breaking this snapshot means the conductor
 * lane exposes direct-work tools again — merge blocker by contract.
 */
/**
 * Tools that must never appear on the conductor whitelist (checklist V1-1):
 * file mutation, worker-lifecycle waiting, and long-running check execution —
 * the runtime guard rejects them, and the whitelist must stay consistent with
 * the guard instead of dangling as a bypass surface.
 */
const CONDUCTOR_FORBIDDEN_TOOLS = [
  'Write',
  'Edit',
  'ApplyPatch',
  'RunProjectChecks',
  'Agent',
  'Fleet',
  'TaskOutput',
  // Plan-phase engine: the playbook forbids running phases on this lane, so
  // paying for their descriptions every turn only leaves room to misfire.
  'NextPhase',
  'RecordInterviewFinding',
] as const;

/** Exact conductor whitelist snapshot (V1-1). Any list change fails here. */
const CONDUCTOR_TOOL_SNAPSHOT = [
  // Read-only query waist
  'Read',
  'Grep',
  'Glob',
  'Bash',
  'RepoQuery',
  'WebSearch',
  'FetchURL',
  'TodoList',
  // Plan/goal lifecycle spine — CreateGoal/UpdateGoal stay off so `/goal`
  // offloads to Goal Desk Jobs instead of a main-lane loop.
  'EnterPlanMode',
  'ExitPlanMode',
  'GetGoal',
  // Job ledger desk — the only delegation means
  'JobCreate',
  'JobList',
  'JobInspect',
  'JobSteer',
  'JobCancel',
  'MergeJob',
  'PushJob',
  'JobResume',
  'JobInbox',
  // Skills + self-improvement + user clarification
  'Skill',
  'SearchSkill',
  'SkillCreate',
  'Refine',
  'AskUserQuestion',
  // Connected MCP / plugin servers (access pattern)
  'mcp__*',
] as const;

describe('conductor delegation-only tool surface', () => {
  it('excludes every forbidden direct-work/wait tool from the conductor profile', () => {
    const tools = DEFAULT_AGENT_PROFILES['conductor']?.tools ?? [];
    expect(tools.length).toBeGreaterThan(0);
    for (const forbidden of CONDUCTOR_FORBIDDEN_TOOLS) {
      expect(tools, `conductor must not expose ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('pins the exact conductor whitelist snapshot (V1-1)', () => {
    const tools = DEFAULT_AGENT_PROFILES['conductor']?.tools ?? [];
    expect(tools).toEqual([...CONDUCTOR_TOOL_SNAPSHOT]);
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
        // Plan/goal lifecycle management (§2.1 item 5) — status only on this lane
        'EnterPlanMode',
        'ExitPlanMode',
        'GetGoal',
        // Clarification + skills (§2.1 items 4, 6)
        'AskUserQuestion',
        'Skill',
        'SearchSkill',
        // Read-only query waist (§2.1 item 3)
        'Read',
        'Grep',
        'Glob',
        'RepoQuery',
        'WebSearch',
        'FetchURL',
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

  it('routes multi-file discovery to explore Jobs and multi-approach work to EnterPlanMode', () => {
    const prompt = DEFAULT_AGENT_PROFILES['conductor']?.systemPrompt(promptContext);
    expect(prompt).toBeTruthy();
    expect(prompt).toContain('JobCreate(kind=explore)');
    expect(prompt).toContain('multi-file discovery');
    expect(prompt).toContain('EnterPlanMode');
    expect(prompt).toContain('do **not** open a multi-step RepoQuery/Grep/Read marathon');
    expect(prompt).toContain('Anti-pattern');
    expect(prompt).toContain('parallelizing 5+ RepoQuery/Grep/Read');
    expect(prompt).toContain('≤3 quick facts');
    // Desk wake prefers explore for research-shaped tasks.
    expect(prompt).toContain('Research-shaped user tasks');
    // Core delegation contract remains.
    expect(prompt).toContain('Never wait on workers');
    expect(prompt).toContain('Prefer `explore` → implement chain');
  });
});
