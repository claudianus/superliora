import { access } from 'node:fs/promises';
import { dirname, join } from 'pathe';
import { fileURLToPath } from 'node:url';

import type { SessionSkillRegistry } from './registry';

const CATALOG_DIR = join(dirname(fileURLToPath(import.meta.url)), 'catalog');

export async function resolveSkillCatalogDir(): Promise<string | undefined> {
  try {
    await access(CATALOG_DIR);
    return CATALOG_DIR;
  } catch {
    return undefined;
  }
}

export async function registerCatalogSkills(registry: SessionSkillRegistry): Promise<number> {
  const catalogDir = await resolveSkillCatalogDir();
  if (catalogDir === undefined) return 0;
  const before = registry.listSkills().length;
  await registry.loadRoots([{ path: catalogDir, source: 'builtin' }]);
  return registry.listSkills().length - before;
}
