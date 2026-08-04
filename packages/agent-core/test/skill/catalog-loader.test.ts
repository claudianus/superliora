import { join, resolve } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { registerBuiltinSkills, registerCatalogSkills } from '../../src/skill/builtin';
import {
  catalogDataDirCandidates,
  resolveCatalogLayoutFrom,
  resolveCatalogLayoutFromCandidates,
  resolveSkillCatalogDir,
  resolveSkillCatalogSearchIndexPath,
} from '../../src/skill/catalog-loader';
import { SessionSkillRegistry } from '../../src/skill/registry';
import { shouldComposeSkill } from '../../src/skill/skill-composition';

const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
const CATALOG_ENV = 'SUPERLIORA_SKILL_CATALOG_DIR';

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

describe('skill catalog layout resolution', () => {
  const savedEnv = process.env[CATALOG_ENV];
  afterEach(() => {
    if (savedEnv === undefined) delete process.env[CATALOG_ENV];
    else process.env[CATALOG_ENV] = savedEnv;
  });

  it('finds the catalog from a bundled app dist dir by walking ancestors', async () => {
    // Bundled CLI runs from apps/liora/dist/main.mjs, so import.meta.filename
    // no longer sits inside packages/agent-core/src/skill. The repo-layout
    // ancestor walk must recover the catalog for SearchSkill.
    const layout = await resolveCatalogLayoutFrom(join(REPO_ROOT, 'apps/liora/dist'));
    expect(layout?.catalogDir).toBe(join(REPO_ROOT, 'packages/agent-core/src/skill/catalog'));
    expect(layout?.indexPath).toBe(
      join(REPO_ROOT, 'packages/agent-core/src/skill/catalog-search-index.json'),
    );
  });

  it('prefers the SUPERLIORA_SKILL_CATALOG_DIR override', async () => {
    process.env[CATALOG_ENV] = join(REPO_ROOT, 'packages/agent-core/src/skill');
    const candidates = catalogDataDirCandidates('/does/not/matter');
    expect(candidates[0]).toBe(join(REPO_ROOT, 'packages/agent-core/src/skill'));

    const layout = await resolveCatalogLayoutFrom('/does/not/matter');
    expect(layout?.catalogDir).toBe(join(REPO_ROOT, 'packages/agent-core/src/skill/catalog'));
  });

  it('returns undefined when no candidate has a catalog tree', async () => {
    delete process.env[CATALOG_ENV];
    const layout = await resolveCatalogLayoutFromCandidates(['/definitely/missing']);
    expect(layout).toBeUndefined();
  });
});
