import { describe, expect, it } from 'vitest';

import {
  CAVEMAN_SKILL,
  I_HAVE_ADHD_SKILL,
  SessionSkillRegistry,
  registerBuiltinSkills,
} from '../../src/skill';

describe('builtin skill: caveman', () => {
  it('has the expected identity and inline metadata', () => {
    expect(CAVEMAN_SKILL.name).toBe('caveman');
    expect(CAVEMAN_SKILL.source).toBe('builtin');
    expect(CAVEMAN_SKILL.description.length).toBeGreaterThan(0);
    expect(CAVEMAN_SKILL.metadata.type).toBe('inline');
  });

  it('is model-invocable and carries the compression rules', () => {
    expect(CAVEMAN_SKILL.metadata.disableModelInvocation).not.toBe(true);
    expect(CAVEMAN_SKILL.content).toContain('## Persistence');
    expect(CAVEMAN_SKILL.content).toContain('wenyan-full');
  });

  it('registers through registerBuiltinSkills and shows up as model-invocable', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    expect(registry.getSkill('caveman')).toBeDefined();
    expect(registry.listInvocableSkills().some((skill) => skill.name === 'caveman')).toBe(true);
  });
});

describe('builtin skill: i-have-adhd', () => {
  it('has the expected identity and inline metadata', () => {
    expect(I_HAVE_ADHD_SKILL.name).toBe('i-have-adhd');
    expect(I_HAVE_ADHD_SKILL.source).toBe('builtin');
    expect(I_HAVE_ADHD_SKILL.description.length).toBeGreaterThan(0);
    expect(I_HAVE_ADHD_SKILL.metadata.type).toBe('inline');
  });

  it('is slash-only (model invocation disabled) and carries the output rules', () => {
    expect(I_HAVE_ADHD_SKILL.metadata.disableModelInvocation).toBe(true);
    expect(I_HAVE_ADHD_SKILL.content).toContain('Lead with the next action');
    expect(I_HAVE_ADHD_SKILL.content).toContain('## Pre-send check');
  });

  it('registers through registerBuiltinSkills but stays out of the model skill listing', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    expect(registry.getSkill('i-have-adhd')).toBeDefined();
    expect(registry.listInvocableSkills().some((skill) => skill.name === 'i-have-adhd')).toBe(false);
  });
});
