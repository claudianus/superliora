import { describe, expect, it } from 'vitest';

import {
  renderModelToolSkillPrompt,
  renderSkillLoadedBlock,
  renderUserSlashSkillPrompt,
} from '#/agent/skill/prompt';

describe('agent/skill/prompt — renderUserSlashSkillPrompt', () => {
  it('emits a user-slash skill prompt with the wrapped <liora-skill-loaded> block', () => {
    const result = renderUserSlashSkillPrompt({
      skillName: 'demo',
      skillArgs: '',
      skillContent: 'do the thing',
    });
    expect(result).toContain('User activated the skill "demo"');
    expect(result).toContain('<liora-skill-loaded');
    expect(result).toContain('name="demo"');
    expect(result).toContain('trigger="user-slash"');
    expect(result).toContain('do the thing');
    expect(result).toContain('</liora-skill-loaded>');
  });
});

describe('agent/skill/prompt — renderModelToolSkillPrompt', () => {
  it('emits a model-tool skill prompt with trigger=model-tool', () => {
    const result = renderModelToolSkillPrompt({
      skillName: 'demo',
      skillArgs: '',
      skillContent: 'do the thing',
      trigger: 'model-tool',
    });
    expect(result).toContain('Skill tool loaded reference material');
    expect(result).toContain('trigger="model-tool"');
    expect(result).toContain('do the thing');
  });

  it('emits a nested-skill prompt with trigger=nested-skill', () => {
    const result = renderModelToolSkillPrompt({
      skillName: 'inner',
      skillArgs: 'arg',
      skillContent: 'inner body',
      trigger: 'nested-skill',
    });
    expect(result).toContain('trigger="nested-skill"');
    expect(result).toContain('args="arg"');
  });
});

describe('agent/skill/prompt — renderSkillLoadedBlock', () => {
  it('escapes xml-special characters in the skill attributes', () => {
    const result = renderSkillLoadedBlock({
      skillName: '<bad>name',
      skillArgs: 'a & b',
      skillContent: 'do it',
      trigger: 'model-tool',
    });
    expect(result).toContain('&lt;bad&gt;name');
    expect(result).toContain('a &amp; b');
    expect(result).not.toContain('<bad>name');
  });

  it('inlines the body and closes the block', () => {
    const result = renderSkillLoadedBlock({
      skillName: 'demo',
      skillArgs: '',
      skillContent: 'do the thing',
      trigger: 'user-slash',
    });
    expect(result).toContain('do the thing');
    expect(result).toMatch(/<\/liora-skill-loaded>/);
  });

  it('omits undefined source / dir attributes', () => {
    const result = renderSkillLoadedBlock({
      skillName: 'demo',
      skillArgs: '',
      skillContent: 'body',
      trigger: 'user-slash',
    });
    expect(result).not.toContain('source="');
    expect(result).not.toContain('dir="');
  });
});
