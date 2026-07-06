import { describe, expect, it } from 'vitest';

import { registerBuiltinSkills, registerCatalogSkills } from '../../src/skill/builtin';
import { resolveSkillCatalogDir } from '../../src/skill/catalog-loader';
import { SessionSkillRegistry } from '../../src/skill/registry';
import { shouldComposeSkill } from '../../src/skill/skill-composition';

describe('skill catalog loader', () => {
  it('registers catalog skills when catalog directory exists', async () => {
    const catalogDir = await resolveSkillCatalogDir();
    if (catalogDir === undefined) return;

    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);
    const added = await registerCatalogSkills(registry);
    expect(added).toBeGreaterThan(100);

    const sample = registry.getSkill('anthropic-pdf') ?? registry.getSkill('pdf');
    if (sample !== undefined) {
      expect(shouldComposeSkill(sample)).toBe(true);
    }
  });
});
