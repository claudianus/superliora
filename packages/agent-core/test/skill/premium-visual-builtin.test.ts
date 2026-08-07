import { describe, expect, it } from 'vitest';

import { PREMIUM_VISUAL_SKILL } from '../../src/skill/builtin/premium-visual';
import { PREMIUM_VISUAL_HARNESS } from '../../src/premium-quality/visual-harness';

describe('builtin premium-visual skill', () => {
  it('embeds the SuperLiora harness body and anti-slop composition rules', () => {
    expect(PREMIUM_VISUAL_SKILL.name).toBe('premium-visual');
    expect(PREMIUM_VISUAL_SKILL.content).toContain('Art direction before code');
    expect(PREMIUM_VISUAL_SKILL.content).toContain('Full-bleed hero');
    expect(PREMIUM_VISUAL_SKILL.content).toContain(PREMIUM_VISUAL_HARNESS.slice(0, 80));
  });
});
