import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type PersonaMap = Readonly<Record<string, string>>;

const PERSONA_FILE = 'catalog-personas.json';
const requireFromHere = createRequire(import.meta.url);

let cache: PersonaMap | undefined;
let loadError: Error | undefined;

/**
 * Resolve persona JSON for both:
 * - package source / tsx (next to this module)
 * - apps/liora dist/main.mjs bundle (createRequire(import.meta.url) collapses
 *   to the bundle path, so look next to process.argv[1] / cwd dist)
 */
function candidatePersonaPaths(): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined): void => {
    if (value === undefined || value.length === 0) return;
    const abs = isAbsolute(value) ? value : join(process.cwd(), value);
    if (seen.has(abs)) return;
    seen.add(abs);
    paths.push(abs);
  };

  try {
    push(requireFromHere.resolve(`./${PERSONA_FILE}`));
  } catch {
    // fall through to filesystem candidates
  }

  try {
    push(join(dirname(fileURLToPath(import.meta.url)), PERSONA_FILE));
  } catch {
    // import.meta.url unavailable in exotic hosts
  }

  // Bundled CLI: loader is inlined into dist/main.mjs; JSON is copied beside it.
  const argv1 = process.argv[1];
  if (typeof argv1 === 'string' && argv1.length > 0) {
    try {
      push(join(dirname(argv1), PERSONA_FILE));
    } catch {
      // ignore
    }
  }

  // Native SEA: process.argv[1] may be unavailable or not the binary path.
  // Personas are packaged beside the executable (dirname(process.execPath)).
  const execPath = process.execPath;
  if (typeof execPath === 'string' && execPath.length > 0) {
    try {
      push(join(dirname(execPath), PERSONA_FILE));
    } catch {
      // ignore
    }
  }

  push(join(process.cwd(), 'dist', PERSONA_FILE));
  push(join(process.cwd(), 'apps', 'liora', 'dist', PERSONA_FILE));
  push(
    join(
      process.cwd(),
      'packages',
      'agent-core',
      'src',
      'expert-agents',
      PERSONA_FILE,
    ),
  );

  return paths;
}

function loadPersonaMapFromPath(path: string): PersonaMap | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const requireFromFile = createRequire(pathToFileURL(path));
    const loaded = requireFromFile(path) as unknown;
    if (loaded === null || typeof loaded !== 'object') return undefined;
    return loaded as PersonaMap;
  } catch (error) {
    loadError = error instanceof Error ? error : new Error(String(error));
    return undefined;
  }
}

function personaMap(): PersonaMap {
  if (cache !== undefined) return cache;

  const tried: string[] = [];
  for (const path of candidatePersonaPaths()) {
    tried.push(path);
    const loaded = loadPersonaMapFromPath(path);
    if (loaded !== undefined) {
      cache = loaded;
      loadError = undefined;
      return cache;
    }
  }

  const detail = tried.length > 0 ? ` Tried: ${tried.join(' | ')}` : '';
  const cause = loadError?.message ? ` Last error: ${loadError.message}` : '';
  throw new Error(
    `Cannot find expert persona catalog (${PERSONA_FILE}). UltraSwarm expert hydration needs this file next to the CLI bundle (apps/liora/dist) or the agent-core expert-agents source tree.${detail}${cause}`,
  );
}

/** Test helper: drop cached map so the next load re-resolves paths. */
export function resetExpertPersonaCacheForTests(): void {
  cache = undefined;
  loadError = undefined;
}

export function loadExpertPersonaText(id: string): string | undefined {
  const text = personaMap()[id];
  return typeof text === 'string' && text.length > 0 ? text : undefined;
}
