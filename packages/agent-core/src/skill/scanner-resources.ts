import path from 'node:path';

import type { SkillDefinition } from './types';
import { qualifySubSkillName } from './scanner-path-utils';

const RESOURCE_SCAN_MAX_DEPTH = 3;
const RESOURCE_SCAN_MAX_FILES = 128;

export async function collectSkillResources(
  skill: SkillDefinition,
  input: {
    readonly readdir: (p: string) => Promise<readonly string[]>;
    readonly isFile: (p: string) => Promise<boolean>;
    readonly isDir: (p: string) => Promise<boolean>;
    readonly warn: (message: string, cause?: unknown) => void;
  },
): Promise<readonly string[]> {
  if (path.basename(skill.path) !== 'SKILL.md') return [];
  const out: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > RESOURCE_SCAN_MAX_DEPTH || out.length >= RESOURCE_SCAN_MAX_FILES) return;
    let entries: readonly string[];
    try {
      entries = [...(await input.readdir(dir))].toSorted();
    } catch (error) {
      input.warn(`Failed to read skill resources in ${dir}`, error);
      return;
    }
    for (const entry of entries) {
      if (out.length >= RESOURCE_SCAN_MAX_FILES) return;
      if (entry === 'SKILL.md' || entry === 'node_modules' || entry.startsWith('.')) continue;
      const entryPath = path.join(dir, entry);
      if (await input.isFile(entryPath)) {
        out.push(path.relative(skill.dir, entryPath).replaceAll('\\', '/'));
        continue;
      }
      if (await input.isDir(entryPath)) {
        await walk(entryPath, depth + 1);
      }
    }
  }

  await walk(skill.dir, 0);
  return out;
}

export function hasSubSkillEnabled(skill: SkillDefinition): boolean {
  const nested = skill.metadata['metadata'];
  const nestedFlag =
    typeof nested === 'object' && nested !== null
      ? (nested as Record<string, unknown>)['has-sub-skill'] === true ||
        (nested as Record<string, unknown>)['hasSubSkill'] === true
      : false;
  return (
    skill.metadata['has-sub-skill'] === true ||
    skill.metadata['hasSubSkill'] === true ||
    nestedFlag
  );
}
