import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Walk upward from startDir to find the SuperLiora monorepo root. */
export function resolveMonorepoRoot(startDir: string = process.cwd()): string {
  let dir = startDir;
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(dir, 'packages/agent-core', 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('SuperLiora monorepo root not found');
}
