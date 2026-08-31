import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

import { registerBuiltinSkills, registerCatalogSkills } from '../../src/skill/builtin';
import {
  catalogDataDirCandidates,
  resolveCatalogLayoutFrom,
  resolveCatalogLayoutFromCandidates,
  resolveSkillCatalogDir,
} from '../../src/skill/catalog-loader';
import { SessionSkillRegistry } from '../../src/skill/registry';
import { shouldComposeSkill } from '../../src/skill/skill-composition';

const CATALOG_ENV = 'SUPERLIORA_SKILL_CATALOG_DIR';

/**
 * The catalog is a gitignored build artifact, so tests exercise the loader
 * against a synthetic catalog + search index instead of the real vendored
 * external skills.
 */
const fixtureRoot = mkdtempSync(join(tmpdir(), 'superliora-catalog-test-'));
const fixtureSkillDir = join(fixtureRoot, 'skill');
const fixtureCatalogDir = join(fixtureSkillDir, 'catalog');

function writeFixtureSkill(relDir: string, frontmatter: string, body: string): void {
  mkdirSync(join(fixtureCatalogDir, relDir), { recursive: true });
  writeFileSync(
    join(fixtureCatalogDir, relDir, 'SKILL.md'),
    `---\n${frontmatter}\ncatalogSource: fixture\ncatalogId: ${relDir}\n---\n${body}\n`,
    'utf8',
  );
}

writeFixtureSkill(
  'fixture-alpha',
  'name: fixture-alpha\ndescription: pdf document processing workflow',
  '# Fixture Alpha\n\nStep one: process the pdf document.',
);
writeFixtureSkill(
  'fixture-beta',
  'name: fixture-beta\ndescription: git hygiene checklist',
  '# Fixture Beta\n\nCheck the git status before committing.',
);

const fixtureIndex = {
  version: 2,
  generatedAt: '2026-01-01T00:00:00.000Z',
  skillCount: 2,
  failed: 0,
  skills: [
    {
      relDir: 'fixture-alpha',
      name: 'fixture-alpha',
      description: 'pdf document processing workflow',
      catalogSource: 'fixture',
      catalogId: 'fixture-alpha',
      contentHash: 'a'.repeat(64),
    },
    {
      relDir: 'fixture-beta',
      name: 'fixture-beta',
      description: 'git hygiene checklist',
      catalogSource: 'fixture',
      catalogId: 'fixture-beta',
      contentHash: 'b'.repeat(64),
    },
  ],
};
writeFileSync(join(fixtureSkillDir, 'catalog-search-index.json'), JSON.stringify(fixtureIndex), 'utf8');

const savedCatalogEnv = process.env[CATALOG_ENV];
process.env[CATALOG_ENV] = fixtureSkillDir;

afterAll(() => {
  if (savedCatalogEnv === undefined) delete process.env[CATALOG_ENV];
  else process.env[CATALOG_ENV] = savedCatalogEnv;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('skill catalog loader', () => {
  it('registers catalog skills from the search index', async () => {
    const catalogDir = await resolveSkillCatalogDir();
    expect(catalogDir).toBe(fixtureCatalogDir);

    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);
    const added = await registerCatalogSkills(registry);

    expect(added).toBe(2);

    const sample = registry.getSkill('fixture-alpha');
    if (sample === undefined) throw new Error('fixture-alpha was not registered from the search index');
    expect(shouldComposeSkill(sample)).toBe(true);
    expect(sample.content).toBe('');
    const load = sample.loadContent;
    if (load === undefined) throw new Error('catalog skill is missing loadContent');
    const body = await load();
    expect(body).toContain('process the pdf document');
    expect(sample.metadata['catalogSource']).toBe('fixture');

    const hits = await registry.searchByQuery('pdf document processing', 5);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('defers catalog registration until ensureCatalogLoaded/search', async () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    const before = registry.listSkills().length;
    expect(before).toBeGreaterThan(0); // builtins only

    await registry.ensureCatalogLoaded();
    const after = registry.listSkills().length;
    expect(after).toBe(before + 2);

    // Second call is a no-op.
    await registry.ensureCatalogLoaded();
    expect(registry.listSkills().length).toBe(after);
  });
});

describe('skill catalog layout resolution', () => {
  it('prefers the SUPERLIORA_SKILL_CATALOG_DIR override', () => {
    const candidates = catalogDataDirCandidates('/does/not/matter');
    expect(candidates[0]).toBe(fixtureSkillDir);

    return expect(resolveCatalogLayoutFrom('/does/not/matter')).resolves.toEqual({
      catalogDir: fixtureCatalogDir,
      indexPath: join(fixtureSkillDir, 'catalog-search-index.json'),
    });
  });

  it('finds the catalog from a bundled app dist dir by walking ancestors', async () => {
    // Bundled CLI runs from apps/liora/dist/main.mjs, so import.meta.filename
    // no longer sits inside packages/agent-core/src/skill. The repo-layout
    // ancestor walk must recover the catalog for SearchSkill.
    const tree = mkdtempSync(join(tmpdir(), 'superliora-catalog-walk-'));
    // The ancestor walk must win on its own — clear the module-level env
    // override for the duration of this test.
    delete process.env[CATALOG_ENV];
    try {
      const skillDir = join(tree, 'packages/agent-core/src/skill');
      mkdirSync(join(skillDir, 'catalog/walked-skill'), { recursive: true });
      writeFileSync(join(skillDir, 'catalog/walked-skill/SKILL.md'), '---\nname: walked\n---\nbody', 'utf8');
      writeFileSync(join(skillDir, 'catalog-search-index.json'), JSON.stringify(fixtureIndex), 'utf8');

      const layout = await resolveCatalogLayoutFrom(join(tree, 'apps/liora/dist'));
      expect(layout?.catalogDir).toBe(join(skillDir, 'catalog'));
      expect(layout?.indexPath).toBe(join(skillDir, 'catalog-search-index.json'));
    } finally {
      rmSync(tree, { recursive: true, force: true });
      process.env[CATALOG_ENV] = fixtureSkillDir;
    }
  });

  it('returns undefined when no candidate has a catalog tree', async () => {
    const layout = await resolveCatalogLayoutFromCandidates(['/definitely/missing']);
    expect(layout).toBeUndefined();
  });
});
