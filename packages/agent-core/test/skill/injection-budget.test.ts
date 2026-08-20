import { describe, expect, it } from 'vitest';

import {
  budgetSkillContentForInjection,
  SKILL_INJECTION_MAX_CHARS,
} from '../../src/skill/injection-budget';

describe('budgetSkillContentForInjection', () => {
  it('returns short skill bodies unchanged', () => {
    expect(budgetSkillContentForInjection('short body', '/skills/x/SKILL.md')).toBe('short body');
  });

  it('keeps the head and points at the skill path when over budget', () => {
    const body = `${'A'.repeat(100)}BODY_HEAD${'x'.repeat(SKILL_INJECTION_MAX_CHARS)}TAIL`;
    const out = budgetSkillContentForInjection(body, '/skills/huge/SKILL.md');
    expect(out.length).toBe(SKILL_INJECTION_MAX_CHARS);
    expect(out.startsWith('A'.repeat(100) + 'BODY_HEAD')).toBe(true);
    expect(out).toContain('truncated to');
    expect(out).toContain('/skills/huge/SKILL.md');
    expect(out).not.toContain('TAIL');
  });
});
