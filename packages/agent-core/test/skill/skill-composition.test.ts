import { describe, expect, it } from 'vitest';

import { composeSkillInstructions, resolveSkillWhenToUse } from '../../src/skill/skill-composition';
import type { SkillDefinition } from '../../src/skill/types';

function sampleSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: 'code-review-checklist',
    description: 'Systematic code review workflow.',
    path: 'builtin://catalog/luokai-code-review-checklist/SKILL.md',
    dir: 'builtin://catalog/luokai-code-review-checklist',
    content: '## Steps\n1. Read diff\n2. Report findings',
    metadata: {
      type: 'inline',
      category: 'quality',
      catalogSource: 'luokai',
    },
    source: 'builtin',
    ...overrides,
  };
}

describe('skill composition', () => {
  it('wraps loaded skill body with execution protocol', () => {
    const composed = composeSkillInstructions('Do the thing.', sampleSkill());
    expect(composed).toContain('<skill_execution_protocol>');
    expect(composed).not.toContain('<skill_application_protocol>');
    expect(composed).toContain('<skill_scope>');
    expect(composed).toContain('Do the thing.');
    expect(composed).toContain('Catalog source: luokai');
    expect(composed).toContain('selectively');
  });

  it('falls back whenToUse to description', () => {
    const skill = sampleSkill({ metadata: { type: 'inline' } });
    expect(resolveSkillWhenToUse(skill)).toBe('Systematic code review workflow.');
  });
});
