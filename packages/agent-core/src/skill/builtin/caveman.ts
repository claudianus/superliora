import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import CAVEMAN_BODY from './caveman.md?raw';

// Vendored from github.com/JuliusBrussee/caveman (MIT, (c) 2026 Julius Brussee).
const PSEUDO_PATH = 'builtin://caveman';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/caveman.md',
  skillDirName: 'caveman',
  source: 'builtin',
  text: CAVEMAN_BODY,
});

export const CAVEMAN_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
