import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import RECURSIVE_IMPROVE_BODY from './recursive-improve.md?raw';

const PSEUDO_PATH = 'builtin://recursive-improve';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/recursive-improve.md',
  skillDirName: 'recursive-improve',
  source: 'builtin',
  text: RECURSIVE_IMPROVE_BODY,
});

export const RECURSIVE_IMPROVE_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
