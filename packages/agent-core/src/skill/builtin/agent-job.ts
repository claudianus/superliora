import { parseSkillText } from '#/skill/parser';
import type { SkillDefinition } from '#/skill/types';
import AGENT_JOB_TEMPLATE from './agent-job.md?raw';

const PSEUDO_PATH = 'builtin://agent-job';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/agent-job.md',
  skillDirName: 'agent-job',
  source: 'builtin',
  text: AGENT_JOB_TEMPLATE,
});

export const AGENT_JOB_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
