import { describe, expect, it } from 'vitest';

import {
  AVOID_AI_WRITING_SKILL,
  NO_AI_SLOP_BUILTIN_SKILLS,
  NO_AI_SLOP_SKILL,
  SessionSkillRegistry,
  registerBuiltinSkills,
} from '../../src/skill';

describe('builtin no-ai-slop skills', () => {
  it('registers all no-ai-slop harness skills', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    for (const skill of NO_AI_SLOP_BUILTIN_SKILLS) {
      expect(registry.getSkill(skill.name)).toBeDefined();
    }
  });

  it('exposes no-ai-slop skills as model-invocable for SearchSkill', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    const invocable = registry.listInvocableSkills().map((skill) => skill.name);
    expect(invocable).toContain('no-ai-slop');
    expect(invocable).toContain('avoid-ai-writing');
    expect(invocable).toContain('no-ai-slop-korean');
    expect(invocable).toContain('no-ai-slop-ui');
    expect(invocable).toContain('no-ai-slop-changelog');
    expect(invocable).toContain('no-ai-slop-meta-prompt');
  });

  it('includes audit workflow in avoid-ai-writing content', () => {
    expect(AVOID_AI_WRITING_SKILL.content).toContain('Second-pass audit');
    expect(AVOID_AI_WRITING_SKILL.content).toContain('Tier 1');
  });

  it('routes from no-ai-slop parent content', () => {
    expect(NO_AI_SLOP_SKILL.content).toContain('avoid-ai-writing');
    expect(NO_AI_SLOP_SKILL.content).toContain('no-ai-slop-korean');
  });
});
