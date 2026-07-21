import type { SessionSkillRegistry } from '../registry';
import { CUSTOM_THEME_SKILL } from './custom-theme';
import { IMPORT_FROM_CC_CODEX_SKILL } from './import-from-cc-codex';
import { MCP_CONFIG_SKILL } from './mcp-config';
import { RECURSIVE_IMPROVE_SKILL } from './recursive-improve';
import {
  SUB_SKILL_CONSOLIDATE,
  SUB_SKILL_PARENT,
  SUB_SKILL_REVIEW,
} from './sub-skill';
import { UPDATE_CONFIG_SKILL } from './update-config';
import {
  AVOID_AI_WRITING_SKILL,
  NO_AI_SLOP_BUILTIN_SKILLS,
  NO_AI_SLOP_CHANGELOG_SKILL,
  NO_AI_SLOP_KOREAN_SKILL,
  NO_AI_SLOP_META_PROMPT_SKILL,
  NO_AI_SLOP_SKILL,
  NO_AI_SLOP_UI_SKILL,
} from './no-ai-slop';
import { ULTRAWORK_SKILL } from './ultrawork';
import { WRITE_GOAL_SKILL } from './write-goal';
import { registerCatalogSkills as loadCatalogSkills } from '../catalog-loader';

export function registerBuiltinSkills(registry: SessionSkillRegistry): void {
  registry.registerBuiltinSkill(MCP_CONFIG_SKILL);
  registry.registerBuiltinSkill(IMPORT_FROM_CC_CODEX_SKILL);
  registry.registerBuiltinSkill(UPDATE_CONFIG_SKILL);
  registry.registerBuiltinSkill(CUSTOM_THEME_SKILL);
  registry.registerBuiltinSkill(WRITE_GOAL_SKILL);
  registry.registerBuiltinSkill(RECURSIVE_IMPROVE_SKILL);
  registry.registerBuiltinSkill(ULTRAWORK_SKILL);
  for (const skill of NO_AI_SLOP_BUILTIN_SKILLS) {
    registry.registerBuiltinSkill(skill);
  }
  registry.registerBuiltinSkill(SUB_SKILL_PARENT);
  registry.registerBuiltinSkill(SUB_SKILL_REVIEW);
  registry.registerBuiltinSkill(SUB_SKILL_CONSOLIDATE);
}

export async function registerCatalogSkills(registry: SessionSkillRegistry): Promise<number> {
  return loadCatalogSkills(registry);
}

export {
  AVOID_AI_WRITING_SKILL,
  CUSTOM_THEME_SKILL,
  IMPORT_FROM_CC_CODEX_SKILL,
  MCP_CONFIG_SKILL,
  NO_AI_SLOP_BUILTIN_SKILLS,
  NO_AI_SLOP_CHANGELOG_SKILL,
  NO_AI_SLOP_KOREAN_SKILL,
  NO_AI_SLOP_META_PROMPT_SKILL,
  NO_AI_SLOP_SKILL,
  NO_AI_SLOP_UI_SKILL,
  RECURSIVE_IMPROVE_SKILL,
  SUB_SKILL_CONSOLIDATE,
  SUB_SKILL_PARENT,
  SUB_SKILL_REVIEW,
  ULTRAWORK_SKILL,
  UPDATE_CONFIG_SKILL,
  WRITE_GOAL_SKILL,
};
