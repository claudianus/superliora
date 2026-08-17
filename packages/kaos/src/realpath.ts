import { realpath as fsRealpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { normalize } from 'pathe';

/**
 * Follow symlinks/junctions for the longest existing prefix, then append
 * missing leaf segments. Matches server `fsPathSafety` so new-file writes
 * still resolve the parent directory.
 */
export async function realpathLongestExistingPrefix(target: string): Promise<string> {
  let current = target;
  const tailSegments: string[] = [];

  for (let i = 0; i < 4096; i++) {
    try {
      const real = await fsRealpath(current);
      tailSegments.reverse();
      const joined = tailSegments.length === 0 ? real : join(real, ...tailSegments);
      return normalize(joined);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw error;
      }
      const parent = dirname(current);
      if (parent === current) {
        return normalize(target);
      }
      tailSegments.push(basename(current));
      current = parent;
    }
  }
  return normalize(target);
}
