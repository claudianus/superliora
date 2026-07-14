import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'pathe';
import { fileURLToPath } from 'node:url';

import type { SkillDefinition } from './types';
import { enrichSkillForSearch } from './skill-composition';
import type { SessionSkillRegistry } from './registry';

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = join(SKILL_DIR, 'catalog');
const SEARCH_INDEX_PATH = join(SKILL_DIR, 'catalog-search-index.json');

export async function resolveSkillCatalogDir(): Promise<string | undefined> {
  try {
    await access(CATALOG_DIR);
    return CATALOG_DIR;
  } catch {
    return undefined;
  }
}

export async function resolveSkillCatalogSearchIndexPath(): Promise<string | undefined> {
  try {
    await access(SEARCH_INDEX_PATH);
    return SEARCH_INDEX_PATH;
  } catch {
    return undefined;
  }
}

interface CatalogSearchIndexSkill {
  readonly relDir: string;
  readonly name: string;
  readonly description: string;
  readonly type?: string;
  readonly whenToUse?: string;
  readonly disableModelInvocation?: boolean;
  readonly isSubSkill?: boolean;
  readonly category?: string;
  readonly risk?: string;
  readonly catalogSource?: string;
  readonly catalogId?: string;
  readonly contentHash?: string;
}

interface CatalogSearchIndex {
  readonly version: number;
  readonly skills: readonly CatalogSearchIndexSkill[];
}

/**
 * Register catalog skills for SearchSkill without walking thousands of skill
 * directories on every session start. Full SKILL.md body loads only when Skill
 * is invoked (via loadContent).
 */
export async function registerCatalogSkills(registry: SessionSkillRegistry): Promise<number> {
  const indexPath = await resolveSkillCatalogSearchIndexPath();
  if (indexPath !== undefined) {
    return registerCatalogSkillsFromSearchIndex(registry, indexPath);
  }

  // Fallback for incomplete checkouts that still have the raw catalog tree.
  const catalogDir = await resolveSkillCatalogDir();
  if (catalogDir === undefined) return 0;
  const before = registry.listSkills().length;
  await registry.loadRoots([{ path: catalogDir, source: 'builtin' }]);
  return registry.listSkills().length - before;
}

async function registerCatalogSkillsFromSearchIndex(
  registry: SessionSkillRegistry,
  indexPath: string,
): Promise<number> {
  const catalogDir = await resolveSkillCatalogDir();
  if (catalogDir === undefined) return 0;

  const raw = await readFile(indexPath, 'utf8');
  const index = JSON.parse(raw) as CatalogSearchIndex;
  if (!Array.isArray(index.skills) || index.skills.length === 0) return 0;

  const before = registry.listSkills().length;
  for (const entry of index.skills) {
    const skill = toIndexedCatalogSkill(entry, catalogDir);
    registry.register(enrichSkillForSearch(skill), { replace: false });
  }
  return registry.listSkills().length - before;
}

function toIndexedCatalogSkill(
  entry: CatalogSearchIndexSkill,
  catalogDir: string,
): SkillDefinition {
  const dir = join(catalogDir, entry.relDir);
  const skillMdPath = join(dir, 'SKILL.md');
  const metadata: Record<string, unknown> = {};
  if (entry.type !== undefined) metadata.type = entry.type;
  if (entry.whenToUse !== undefined) metadata.whenToUse = entry.whenToUse;
  if (entry.disableModelInvocation === true) metadata.disableModelInvocation = true;
  if (entry.isSubSkill === true) metadata.isSubSkill = true;
  if (entry.category !== undefined) metadata.category = entry.category;
  if (entry.risk !== undefined) metadata.risk = entry.risk;
  if (entry.catalogSource !== undefined) metadata.catalogSource = entry.catalogSource;
  if (entry.catalogId !== undefined) metadata.catalogId = entry.catalogId;

  return {
    name: entry.name,
    description: entry.description,
    path: skillMdPath,
    dir,
    content: '',
    metadata,
    source: 'builtin',
    contentHash: entry.contentHash,
    loadContent: async () => {
      const text = await readFile(skillMdPath, 'utf8');
      return stripFrontmatter(text);
    },
  };
}

function stripFrontmatter(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return text;
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close === -1) return text;
  return lines.slice(close + 1).join('\n');
}
