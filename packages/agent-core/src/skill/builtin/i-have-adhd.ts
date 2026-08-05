import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import I_HAVE_ADHD_BODY from './i-have-adhd.md?raw';

// Vendored from github.com/ayghri/i-have-adhd (MIT, (c) 2026 Ayoub Ghriss).
const PSEUDO_PATH = 'builtin://i-have-adhd';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/i-have-adhd.md',
  skillDirName: 'i-have-adhd',
  source: 'builtin',
  text: I_HAVE_ADHD_BODY,
});

export const I_HAVE_ADHD_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
