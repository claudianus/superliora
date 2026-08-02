import { describe, expect, it } from 'vitest';

import { SessionSkillRegistry, MISSION_SKILL, ULTRAWORK_SKILL, registerBuiltinSkills } from '../../src/skill';

describe('builtin skill: ultrawork / mission', () => {
  it('has the expected identity and inline metadata', () => {
    expect(MISSION_SKILL.name).toBe('mission');
    expect(ULTRAWORK_SKILL.name).toBe('ultrawork');
    expect(MISSION_SKILL.source).toBe('builtin');
    expect(MISSION_SKILL.description.length).toBeGreaterThan(0);
    expect(MISSION_SKILL.metadata.type).toBe('inline');
  });

  it('exposes mission as SSOT primary with ultrawork compat alias', () => {
    expect(MISSION_SKILL.metadata.aliases).toEqual(['ultrawork']);
    expect(MISSION_SKILL.content).toBe(ULTRAWORK_SKILL.content);
    expect(ULTRAWORK_SKILL.metadata.aliases).toEqual(['mission']);
  });

  it('is model-invocable (does not disable model invocation)', () => {
    expect(ULTRAWORK_SKILL.metadata.disableModelInvocation).not.toBe(true);
  });

  it('registers through registerBuiltinSkills and shows up as model-invocable', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    const ultrawork = registry.getSkill('ultrawork');
    expect(ultrawork).toBeDefined();
    expect(ultrawork?.metadata.disableModelInvocation).not.toBe(true);

    const mission = registry.getSkill('mission');
    expect(mission).toBeDefined();
    expect(mission?.content).toBe(ultrawork?.content);
    expect(mission?.metadata.disableModelInvocation).not.toBe(true);
  });

  it('carries the full workflow methodology the lean activation prompt no longer injects', () => {
    const content = ULTRAWORK_SKILL.content;

    // Workflow spine and activation (Mission brand; ultrawork is compat alias).
    expect(content).toContain('Research prelude -> Plan interview -> Goal');
    expect(content).toContain('Fleet decision');
    expect(content).toContain('# Mission workflow methodology');
    expect(content).toContain('Shift-Tab');
    expect(content).toContain('/mission');
    expect(content).toContain('Hard vs soft');
    expect(content).toContain('force_unverified');

    // Research / interview rules.
    expect(content).toContain('plan file + evidence root');
    expect(content).toContain('Context7');
    expect(content).toContain('Baseline + Upgrade');
    expect(content).toContain('NextPhase({ phase: "interview" })');
    expect(content).toContain('NextPhase({ phase: "design" })');

    // Plan artifacts and fleet decision.
    expect(content).toContain('Seed Spec');
    expect(content).toContain('AC Tree');
    expect(content).toContain('WorkGraph');
    expect(content).toContain('Evaluation Plan');
    expect(content).toContain('Execution Plan');
    expect(content).toContain('ENGAGE|ADAPTIVE|DEFER');

    // Evidence + quality.
    expect(content).toContain('workflow-report');
    expect(content).toContain('Definition of Done');
    expect(content).toContain('verificationStatus=passed');
    expect(content).toContain('UpdateGoal complete/blocked');
  });
});
