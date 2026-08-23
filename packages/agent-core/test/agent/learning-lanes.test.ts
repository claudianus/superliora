import { describe, expect, it } from 'vitest';

import { LEARNING_LANES } from '../../src/agent/learning-lanes';
import { SkillCreateTool } from '../../src/tools/builtin/fleet/skill-create';
import { MemoryTool } from '../../src/tools/builtin/state/memory';

describe('LEARNING_LANES', () => {
  it('is shared by SkillCreate and Memory tool descriptions', () => {
    expect(LEARNING_LANES).toContain('Memory:');
    expect(LEARNING_LANES).toContain('Skill:');
    expect(LEARNING_LANES).toContain('AGENTS.md:');
    const skill = new SkillCreateTool({ config: { cwd: '/tmp' }, skills: null } as never);
    const memory = new MemoryTool({ isEnabled: () => false } as never);
    expect(skill.description).toContain(LEARNING_LANES);
    expect(memory.description).toContain(LEARNING_LANES);
  });
});
