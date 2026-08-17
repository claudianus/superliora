import { describe, expect, it } from 'vitest';

import { SessionSkillRegistry } from '../../src/skill/registry';
import { WINDOWS_VIBE_SKILL, registerBuiltinSkills } from '../../src/skill/builtin';

describe('windows-vibe builtin skill', () => {
  it('registers a playbook that points at /windows-setup apply', () => {
    expect(WINDOWS_VIBE_SKILL.name).toBe('windows-vibe');
    expect(WINDOWS_VIBE_SKILL.content).toContain('/windows-setup apply');
    expect(WINDOWS_VIBE_SKILL.content).toContain('PC-bang');
    expect(WINDOWS_VIBE_SKILL.content).toMatch(/conhost/i);
    expect(WINDOWS_VIBE_SKILL.content).toContain('SUPERLIORA_AUTO_TERMINAL');
    expect(WINDOWS_VIBE_SKILL.metadata.whenToUse).toMatch(/winget/i);
  });

  it('registers through registerBuiltinSkills', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);
    expect(registry.getSkill('windows-vibe')?.name).toBe('windows-vibe');
  });
});
