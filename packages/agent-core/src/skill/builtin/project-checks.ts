import { parseSkillText } from '#/skill/parser';
import type { SkillDefinition } from '#/skill/types';
import PROJECT_CHECKS_TEMPLATE from './project-checks.md?raw';

const PSEUDO_PATH = 'builtin://project-checks';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/project-checks.md',
  skillDirName: 'project-checks',
  source: 'builtin',
  text: PROJECT_CHECKS_TEMPLATE,
});

export const PROJECT_CHECKS_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
