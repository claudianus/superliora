import { parseSkillText } from '#/skill/parser';
import type { SkillDefinition } from '#/skill/types';
import RESEARCH_USE_TEMPLATE from './research-use.md?raw';

const PSEUDO_PATH = 'builtin://research-use';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/research-use.md',
  skillDirName: 'research-use',
  source: 'builtin',
  text: RESEARCH_USE_TEMPLATE,
});

export const RESEARCH_USE_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
