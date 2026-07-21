import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import ULTRAWORK_BODY from './ultrawork.md?raw';

const PSEUDO_PATH = 'builtin://ultrawork';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/ultrawork.md',
  skillDirName: 'ultrawork',
  source: 'builtin',
  text: ULTRAWORK_BODY,
});

export const ULTRAWORK_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
