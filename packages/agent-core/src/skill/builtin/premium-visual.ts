import { parseSkillText } from '#/skill/parser';
import type { SkillDefinition } from '#/skill/types';
import { PREMIUM_VISUAL_HARNESS } from '../../premium-quality/visual-harness';
import PREMIUM_VISUAL_TEMPLATE from './premium-visual.md?raw';

const PSEUDO_PATH = 'builtin://premium-visual';

const body = PREMIUM_VISUAL_TEMPLATE.replace(
  'PREMIUM_VISUAL_HARNESS_PLACEHOLDER',
  PREMIUM_VISUAL_HARNESS,
);

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/premium-visual.md',
  skillDirName: 'premium-visual',
  source: 'builtin',
  text: body,
});

export const PREMIUM_VISUAL_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
