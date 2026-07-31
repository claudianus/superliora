/**
 * Install a skill directory into ~/.superliora/skills/<name>.
 */

import { cp, mkdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { getDataDir } from '#/utils/paths';

export async function installSkillFromPath(sourcePath: string): Promise<{
  readonly name: string;
  readonly dest: string;
}> {
  const resolved = sourcePath.trim();
  if (resolved.length === 0) throw new Error('Path is required');
  const st = await stat(resolved);
  if (!st.isDirectory()) throw new Error('Skill path must be a directory containing SKILL.md');
  const skillMd = join(resolved, 'SKILL.md');
  try {
    await stat(skillMd);
  } catch {
    throw new Error(`Missing SKILL.md in ${resolved}`);
  }
  const name = basename(resolved);
  if (name.length === 0 || name === '.' || name === '..') {
    throw new Error('Invalid skill directory name');
  }
  const dest = join(getDataDir(), 'skills', name);
  await mkdir(join(getDataDir(), 'skills'), { recursive: true });
  await cp(resolved, dest, { recursive: true, force: true });
  return { name, dest };
}
