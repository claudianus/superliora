import { describe, expect, it } from 'vitest';

import {
  renderModelToolSkillPrompt,
  renderSkillLoadedBlock,
  renderUserSlashSkillPrompt,
} from '../../../src/agent/skill/prompt';

const baseInput = {
  skillName: 'commit',
  skillArgs: '-m feat',
  skillContent: 'skill body',
};

describe('agent/skill/prompt.ts — renderUserSlashSkillPrompt', () => {
  it('wraps the loaded block with the user-slash trigger and surfaces skillApplicationProtocol', () => {
    const out = renderUserSlashSkillPrompt(baseInput);
    expect(out).toContain('User activated the skill "commit"');
    expect(out).toContain('skill_application_protocol');
    expect(out).toContain('<kimi-skill-loaded name="commit" trigger="user-slash"');
    expect(out).toContain('args="-m feat"');
    expect(out).toContain('skill body');
  });

  it('escapes XML-special characters in the skill name and args', () => {
    const out = renderUserSlashSkillPrompt({ ...baseInput, skillName: 'a"b&c' });
    expect(out).not.toContain('a"b&c');
    expect(out).toContain('a&quot;b&amp;c');
  });
});

describe('agent/skill/prompt.ts — renderModelToolSkillPrompt', () => {
  it('uses the model-tool trigger when requested', () => {
    const out = renderModelToolSkillPrompt({
      ...baseInput,
      trigger: 'model-tool',
    });
    expect(out).toContain('Skill tool loaded reference material');
    expect(out).toContain('trigger="model-tool"');
  });

  it('uses the nested-skill trigger when requested', () => {
    const out = renderModelToolSkillPrompt({
      ...baseInput,
      trigger: 'nested-skill',
    });
    expect(out).toContain('trigger="nested-skill"');
  });
});

describe('agent/skill/prompt.ts — renderSkillLoadedBlock', () => {
  it('emits a `<kimi-skill-loaded>` envelope with name and trigger', () => {
    const out = renderSkillLoadedBlock({ ...baseInput, trigger: 'user-slash' });
    expect(out).toBe(
      '<kimi-skill-loaded name="commit" trigger="user-slash" args="-m feat">\nskill body\n</kimi-skill-loaded>',
    );
  });

  it('emits source / dir attributes when provided (and skips them when not)', () => {
    const a = renderSkillLoadedBlock({ ...baseInput, trigger: 'user-slash', skillSource: 'plugin:foo', skillDir: '/x/y' });
    expect(a).toContain('source="plugin:foo"');
    expect(a).toContain('dir="/x/y"');

    const b = renderSkillLoadedBlock({ ...baseInput, trigger: 'user-slash' });
    expect(b).not.toContain('source=');
    expect(b).not.toContain('dir=');
  });

  it('emits an empty args attribute when args is the empty string (renderer does not strip)', () => {
    // The renderer is not responsible for trimming the `args=""` slot —
    // downstream consumers treat an empty args string the same as no args.
    const out = renderSkillLoadedBlock({ ...baseInput, skillArgs: '', trigger: 'user-slash' });
    expect(out).toContain('args=""');
  });

  it('escapes XML-special characters in attribute values', () => {
    const out = renderSkillLoadedBlock({ ...baseInput, skillArgs: 'a"b&c', trigger: 'user-slash' });
    expect(out).toContain('args="a&quot;b&amp;c"');
  });
});
