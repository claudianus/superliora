import { parseSkillText } from '#/skill/parser';
import type { SkillDefinition } from '#/skill/types';
import BROWSER_USE_TEMPLATE from './browser-use.md?raw';

const PSEUDO_PATH = 'builtin://browser-use';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/browser-use.md',
  skillDirName: 'browser-use',
  source: 'builtin',
  text: BROWSER_USE_TEMPLATE,
});

export const BROWSER_USE_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
