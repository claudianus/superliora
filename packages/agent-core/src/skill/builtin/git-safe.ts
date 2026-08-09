import { parseSkillText } from '#/skill/parser';
import type { SkillDefinition } from '#/skill/types';
import GIT_SAFE_TEMPLATE from './git-safe.md?raw';

const PSEUDO_PATH = 'builtin://git-safe';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/git-safe.md',
  skillDirName: 'git-safe',
  source: 'builtin',
  text: GIT_SAFE_TEMPLATE,
});

export const GIT_SAFE_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
