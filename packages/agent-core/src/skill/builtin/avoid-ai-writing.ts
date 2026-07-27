import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import AVOID_AI_WRITING_BODY from './avoid-ai-writing.md?raw';

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

/**
 * Standalone anti-slop writing audit. The no-ai-slop family was folded into
 * the base system-prompt section (T2-4); this deeper audit workflow stays
 * discoverable for long-form prose.
 */
export const AVOID_AI_WRITING_SKILL = makeInvocableBuiltin(
  AVOID_AI_WRITING_BODY,
  'avoid-ai-writing',
  'builtin://avoid-ai-writing',
);
