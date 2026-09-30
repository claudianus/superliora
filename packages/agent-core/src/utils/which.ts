/**
 * Locate an executable on PATH.
 *
 * A `stat`-per-candidate loop is wrong in three ways, and each one ends in a
 * spawn failure the caller has no way to recover from:
 *   - POSIX: a plain file that happens to carry the binary's name (a data file,
 *     an interrupted download) is not executable, and accepting it turns every
 *     later spawn into EACCES;
 *   - Windows: installers routinely write quoted PATH entries
 *     (`"C:\Program Files\Git\cmd"`), which a join keeps as literal characters;
 *   - Windows: npm/pnpm install the command as a `.cmd`/`.bat` shim, which only
 *     PATHEXT resolution finds.
 */
import { stat } from 'node:fs/promises';

import { join } from 'pathe';

export interface WhichExecutableOptions {
  readonly pathEnv?: string;
  readonly pathExt?: string;
  readonly platform?: NodeJS.Platform;
}

export async function whichExecutable(
  name: string,
  options: WhichExecutableOptions = {},
): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const windows = platform === 'win32';
  const pathEnv = options.pathEnv ?? process.env['PATH'] ?? '';
  const candidateNames = windows ? windowsCandidateNames(name, options.pathExt) : [name];

  for (const entry of pathEnv.split(windows ? ';' : ':')) {
    const dir = stripPathQuotes(entry);
    if (dir.length === 0) continue;
    for (const candidateName of candidateNames) {
      const candidate = join(dir, candidateName);
      if (await isRunnableFile(candidate, windows)) return candidate;
    }
  }
  return null;
}

/** CreateProcessW tries the literal name first, then each PATHEXT suffix. */
function windowsCandidateNames(name: string, pathExt: string | undefined): readonly string[] {
  const extensions = (pathExt ?? process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter((extension) => extension.length > 0);
  return [name, ...extensions.map((extension) => name + extension)];
}

/** Installers quote PATH entries; the quotes are not part of the directory. */
function stripPathQuotes(entry: string): string {
  const trimmed = entry.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

async function isRunnableFile(candidate: string, windows: boolean): Promise<boolean> {
  try {
    const stats = await stat(candidate);
    if (!stats.isFile()) return false;
    // Windows has no execute bit; anything the shell can extend or run counts.
    return windows || (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}