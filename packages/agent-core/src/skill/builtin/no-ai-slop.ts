import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import AVOID_AI_WRITING_BODY from './avoid-ai-writing.md?raw';
import NO_AI_SLOP_CHANGELOG_BODY from './no-ai-slop-changelog.md?raw';
import NO_AI_SLOP_KOREAN_BODY from './no-ai-slop-korean.md?raw';
import NO_AI_SLOP_META_PROMPT_BODY from './no-ai-slop-meta-prompt.md?raw';
import NO_AI_SLOP_UI_BODY from './no-ai-slop-ui.md?raw';
import NO_AI_SLOP_BODY from './no-ai-slop.md?raw';

function makeInvocableBuiltin(body: string, dirName: string, pseudoPath: string): SkillDefinition {
  const parsed = parseSkillText({
    skillMdPath: `/builtin/skills/${dirName}.md`,
    skillDirName: dirName,
    source: 'builtin',
    text: body,
  });
  return {
    ...parsed,
    name: dirName,
    path: pseudoPath,
    dir: pseudoPath,
    metadata: {
      ...parsed.metadata,
      type: parsed.metadata.type ?? 'inline',
    },
  };
}

export const NO_AI_SLOP_SKILL = makeInvocableBuiltin(
  NO_AI_SLOP_BODY,
  'no-ai-slop',
  'builtin://no-ai-slop',
);

export const AVOID_AI_WRITING_SKILL = makeInvocableBuiltin(
  AVOID_AI_WRITING_BODY,
  'avoid-ai-writing',
  'builtin://avoid-ai-writing',
);

export const NO_AI_SLOP_KOREAN_SKILL = makeInvocableBuiltin(
  NO_AI_SLOP_KOREAN_BODY,
  'no-ai-slop-korean',
  'builtin://no-ai-slop-korean',
);

export const NO_AI_SLOP_UI_SKILL = makeInvocableBuiltin(
  NO_AI_SLOP_UI_BODY,
  'no-ai-slop-ui',
  'builtin://no-ai-slop-ui',
);

export const NO_AI_SLOP_CHANGELOG_SKILL = makeInvocableBuiltin(
  NO_AI_SLOP_CHANGELOG_BODY,
  'no-ai-slop-changelog',
  'builtin://no-ai-slop-changelog',
);

export const NO_AI_SLOP_META_PROMPT_SKILL = makeInvocableBuiltin(
  NO_AI_SLOP_META_PROMPT_BODY,
  'no-ai-slop-meta-prompt',
  'builtin://no-ai-slop-meta-prompt',
);

export const NO_AI_SLOP_BUILTIN_SKILLS = [
  NO_AI_SLOP_SKILL,
  AVOID_AI_WRITING_SKILL,
  NO_AI_SLOP_KOREAN_SKILL,
  NO_AI_SLOP_UI_SKILL,
  NO_AI_SLOP_CHANGELOG_SKILL,
  NO_AI_SLOP_META_PROMPT_SKILL,
] as const;
