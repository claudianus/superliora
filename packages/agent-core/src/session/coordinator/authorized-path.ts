import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export async function canonicalPath(path: string): Promise<string> {
  const suffix: string[] = [];
  let parent = resolve(path);
  while (true) {
    try { return resolve(await realpath(parent), ...suffix.toReversed()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (dirname(parent) === parent) throw error;
      suffix.push(basename(parent));
      parent = dirname(parent);
    }
  }
}

export function containsPath(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
