import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import ULTRAWORK_BODY from './ultrawork.md?raw';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/ultrawork.md',
  skillDirName: 'ultrawork',
  source: 'builtin',
  text: ULTRAWORK_BODY,
});

const MISSION_PSEUDO_PATH = 'builtin://mission';

/** SSOT primary — frontmatter `name: mission`; body file stays ultrawork.md for compat. */
export const MISSION_SKILL: SkillDefinition = {
  ...parsed,
  path: MISSION_PSEUDO_PATH,
  dir: MISSION_PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};

const PSEUDO_PATH = 'builtin://ultrawork';

/** Compat alias — same workflow body as {@link MISSION_SKILL}; `ultrawork` kept for /ultrawork. */
export const ULTRAWORK_SKILL: SkillDefinition = {
  ...MISSION_SKILL,
  name: 'ultrawork',
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...MISSION_SKILL.metadata,
    aliases: ['mission'],
  },
};
