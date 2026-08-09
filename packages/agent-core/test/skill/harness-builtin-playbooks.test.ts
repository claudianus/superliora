import { describe, expect, it } from 'vitest';

import { AGENT_JOB_SKILL } from '../../src/skill/builtin/agent-job';
import { COMPUTER_USE_SKILL } from '../../src/skill/builtin/computer-use';
import { GIT_SAFE_SKILL } from '../../src/skill/builtin/git-safe';
import { PROJECT_CHECKS_SKILL } from '../../src/skill/builtin/project-checks';
import { RESEARCH_USE_SKILL } from '../../src/skill/builtin/research-use';

describe('harness builtin playbooks', () => {
  it('registers research/computer/git/agent/checks playbooks', () => {
    expect(RESEARCH_USE_SKILL.name).toBe('research-use');
    expect(RESEARCH_USE_SKILL.content).toContain('WebSearch');
    expect(RESEARCH_USE_SKILL.content).toContain('Context7');

    expect(COMPUTER_USE_SKILL.name).toBe('computer-use');
    expect(COMPUTER_USE_SKILL.content).toContain('ComputerCapture');

    expect(GIT_SAFE_SKILL.name).toBe('git-safe');
    expect(GIT_SAFE_SKILL.content).toMatch(/user must ask/i);

    expect(AGENT_JOB_SKILL.name).toBe('agent-job');
    expect(AGENT_JOB_SKILL.content).toContain('JobCreate');

    expect(PROJECT_CHECKS_SKILL.name).toBe('project-checks');
    expect(PROJECT_CHECKS_SKILL.content).toContain('RunProjectChecks');
  });
});
