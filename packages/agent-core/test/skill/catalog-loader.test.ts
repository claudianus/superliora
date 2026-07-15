import { describe, expect, it } from 'vitest';

import { registerBuiltinSkills, registerCatalogSkills } from '../../src/skill/builtin';
import {
  resolveSkillCatalogDir,
  resolveSkillCatalogSearchIndexPath,
} from '../../src/skill/catalog-loader';
import { SessionSkillRegistry } from '../../src/skill/registry';
import { shouldComposeSkill } from '../../src/skill/skill-composition';

describe('skill catalog loader', () => {
  it('registers catalog skills from the search index when available', async () => {
    const catalogDir = await resolveSkillCatalogDir();
    if (catalogDir === undefined) return;

    const indexPath = await resolveSkillCatalogSearchIndexPath();
    expect(indexPath).toBeDefined();

    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);
    const started = performance.now();
    const added = await registerCatalogSkills(registry);
    const elapsedMs = performance.now() - started;

    expect(added).toBeGreaterThan(1000);
    // Index load must stay far cheaper than walking thousands of skill dirs.
    expect(elapsedMs).toBeLessThan(5_000);

    const sample = registry.getSkill('anthropic-pdf') ?? registry.getSkill('pdf');
    if (sample !== undefined) {
      expect(shouldComposeSkill(sample)).toBe(true);
      expect(sample.content).toBe('');
      expect(sample.loadContent).toBeTypeOf('function');
      const body = await sample.loadContent!();
      expect(body.trim().length).toBeGreaterThan(0);
    }

    const hits = await registry.searchByQuery('pdf document processing', 5);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('defers catalog registration until ensureCatalogLoaded/search', async () => {
    const catalogDir = await resolveSkillCatalogDir();
    if (catalogDir === undefined) return;

    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    const before = registry.listSkills().length;
    expect(before).toBeGreaterThan(0); // builtins only

    const started = performance.now();
    await registry.ensureCatalogLoaded();
    const after = registry.listSkills().length;
    expect(after).toBeGreaterThan(before + 1000);
    expect(performance.now() - started).toBeLessThan(5_000);

    // Second call is a no-op.
    const againStart = performance.now();
    await registry.ensureCatalogLoaded();
    expect(performance.now() - againStart).toBeLessThan(50);
  });
});
