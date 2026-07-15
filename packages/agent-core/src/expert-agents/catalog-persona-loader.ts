import { createRequire } from 'node:module';

type PersonaMap = Readonly<Record<string, string>>;

const require = createRequire(import.meta.url);
let cache: PersonaMap | undefined;

function personaMap(): PersonaMap {
  if (cache === undefined) {
    // JSON keeps persona bodies out of the TS graph until first expert hydrate.
    cache = require('./catalog-personas.json') as PersonaMap;
  }
  return cache;
}

export function loadExpertPersonaText(id: string): string | undefined {
  const text = personaMap()[id];
  return typeof text === 'string' && text.length > 0 ? text : undefined;
}
