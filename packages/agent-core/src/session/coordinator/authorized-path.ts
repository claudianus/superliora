import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export async function canonicalPath(path: string): Promise<string> {
  const suffix: string[] = [];
  let parent = resolve(path);
  while (true) {
    try { return resolve(await realpath(parent), ...suffix.toReversed()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (dirname(parent) === parent) throw error;
      // An entry that exists but cannot be resolved is a dangling link; its
      // eventual target is unknown, so it cannot be treated as a missing suffix.
      const exists = await lstat(parent).then(() => true, (error_: NodeJS.ErrnoException) => {
        if (error_.code === 'ENOENT') return false;
        throw error_;
      });
      if (exists) throw new Error(`Unresolvable path component: ${parent}`, { cause: error });
      suffix.push(basename(parent));
      parent = dirname(parent);
    }
  }
}

export function containsPath(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
