import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'pathe';
import { fileURLToPath } from 'node:url';

import type { SkillDefinition } from './types';
import { enrichSkillForSearch } from './skill-composition';
import type { SessionSkillRegistry } from './registry';

const MODULE_DIR = dirname(import.meta.filename);
/** Points at a directory containing `catalog/` and optionally `catalog-search-index.json`. */
const CATALOG_DIR_ENV = 'SUPERLIORA_SKILL_CATALOG_DIR';
const REPO_SKILL_DIR_RELATIVE = join('packages', 'agent-core', 'src', 'skill');
const MAX_ANCESTOR_DEPTH = 8;

export interface SkillCatalogLayout {
  readonly catalogDir: string;
  readonly indexPath?: string | undefined;
}

let layoutPromise: Promise<SkillCatalogLayout | undefined> | undefined;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Candidate skill-data directories in priority order: env override, the
 * directory this module runs from (source/tsx), then repo-layout matches in
 * each ancestor. The last one matters for the bundled CLI, where
 * `import.meta.filename` is `apps/liora/dist/main.mjs` and the catalog lives
 * several levels up inside the checkout (dev builds and source installs).
 */
export function catalogDataDirCandidates(startDir: string): readonly string[] {
  const dirs: string[] = [];
  const override = process.env[CATALOG_DIR_ENV]?.trim();
  if (override !== undefined && override.length > 0) dirs.push(resolve(override));
  dirs.push(startDir);
  let current = startDir;
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    const parent = dirname(current);
    if (parent === current) break;
    dirs.push(join(parent, REPO_SKILL_DIR_RELATIVE));
    current = parent;
  }
  return dirs;
}

export async function resolveCatalogLayoutFromCandidates(
  dirs: readonly string[],
): Promise<SkillCatalogLayout | undefined> {
  for (const dir of dirs) {
    const catalogDir = join(dir, 'catalog');
    // The catalog tree is required: Skill loadContent reads SKILL.md from it.
    if (!(await pathExists(catalogDir))) continue;
    const indexPath = join(dir, 'catalog-search-index.json');
    return { catalogDir, indexPath: (await pathExists(indexPath)) ? indexPath : undefined };
  }
  return undefined;
}

export function resolveCatalogLayoutFrom(startDir: string): Promise<SkillCatalogLayout | undefined> {
  return resolveCatalogLayoutFromCandidates(catalogDataDirCandidates(startDir));
}

export function resolveCatalogLayout(): Promise<SkillCatalogLayout | undefined> {
  layoutPromise ??= resolveCatalogLayoutFrom(MODULE_DIR);
  return layoutPromise;
}

export async function resolveSkillCatalogDir(): Promise<string | undefined> {
  return (await resolveCatalogLayout())?.catalogDir;
}

export async function resolveSkillCatalogSearchIndexPath(): Promise<string | undefined> {
  return (await resolveCatalogLayout())?.indexPath;
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
  const layout = await resolveCatalogLayout();
  if (layout === undefined) return 0;
  if (layout.indexPath !== undefined) {
    return registerCatalogSkillsFromSearchIndex(registry, layout.indexPath, layout.catalogDir);
  }

  // Fallback for incomplete checkouts that still have the raw catalog tree.
  const before = registry.listSkills().length;
  await registry.loadRoots([{ path: layout.catalogDir, source: 'builtin' }]);
  return registry.listSkills().length - before;
}

async function registerCatalogSkillsFromSearchIndex(
  registry: SessionSkillRegistry,
  indexPath: string,
  catalogDir: string,
): Promise<number> {
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
  if (entry.type !== undefined) metadata['type'] = entry.type;
  if (entry.whenToUse !== undefined) metadata['whenToUse'] = entry.whenToUse;
  if (entry.disableModelInvocation === true) metadata['disableModelInvocation'] = true;
  if (entry.isSubSkill === true) metadata['isSubSkill'] = true;
  if (entry.category !== undefined) metadata['category'] = entry.category;
  if (entry.risk !== undefined) metadata['risk'] = entry.risk;
  if (entry.catalogSource !== undefined) metadata['catalogSource'] = entry.catalogSource;
  if (entry.catalogId !== undefined) metadata['catalogId'] = entry.catalogId;

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
