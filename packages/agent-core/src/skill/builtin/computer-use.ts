import { parseSkillText } from '#/skill/parser';
import type { SkillDefinition } from '#/skill/types';
import COMPUTER_USE_TEMPLATE from './computer-use.md?raw';

const PSEUDO_PATH = 'builtin://computer-use';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/computer-use.md',
  skillDirName: 'computer-use',
  source: 'builtin',
  text: COMPUTER_USE_TEMPLATE,
});

export const COMPUTER_USE_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
