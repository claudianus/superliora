import { parseSkillText } from '#/skill/parser';
import type { SkillDefinition } from '#/skill/types';
import WINDOWS_VIBE_TEMPLATE from './windows-vibe.md?raw';

const PSEUDO_PATH = 'builtin://windows-vibe';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/windows-vibe.md',
  skillDirName: 'windows-vibe',
  source: 'builtin',
  text: WINDOWS_VIBE_TEMPLATE,
});

export const WINDOWS_VIBE_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
