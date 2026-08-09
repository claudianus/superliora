import type { SessionSkillRegistry } from '../registry';
import { CAVEMAN_SKILL } from './caveman';
import { CUSTOM_THEME_SKILL } from './custom-theme';
import { I_HAVE_ADHD_SKILL } from './i-have-adhd';
import { IMPORT_FROM_CC_CODEX_SKILL } from './import-from-cc-codex';
import { MCP_CONFIG_SKILL } from './mcp-config';
import { RECURSIVE_IMPROVE_SKILL } from './recursive-improve';
import {
  SUB_SKILL_CONSOLIDATE,
  SUB_SKILL_PARENT,
  SUB_SKILL_REVIEW,
} from './sub-skill';
import { UPDATE_CONFIG_SKILL } from './update-config';
import { AVOID_AI_WRITING_SKILL } from './avoid-ai-writing';
import { AGENT_JOB_SKILL } from './agent-job';
import { BROWSER_USE_SKILL } from './browser-use';
import { COMPUTER_USE_SKILL } from './computer-use';
import { GIT_SAFE_SKILL } from './git-safe';
import { PREMIUM_VISUAL_SKILL } from './premium-visual';
import { PROJECT_CHECKS_SKILL } from './project-checks';
import { RESEARCH_USE_SKILL } from './research-use';
import { WRITE_GOAL_SKILL } from './write-goal';
import { registerCatalogSkills as loadCatalogSkills } from '../catalog-loader';

export function registerBuiltinSkills(registry: SessionSkillRegistry): void {
  registry.registerBuiltinSkill(MCP_CONFIG_SKILL);
  registry.registerBuiltinSkill(IMPORT_FROM_CC_CODEX_SKILL);
  registry.registerBuiltinSkill(UPDATE_CONFIG_SKILL);
  registry.registerBuiltinSkill(CUSTOM_THEME_SKILL);
  registry.registerBuiltinSkill(WRITE_GOAL_SKILL);
  registry.registerBuiltinSkill(RECURSIVE_IMPROVE_SKILL);
  registry.registerBuiltinSkill(AVOID_AI_WRITING_SKILL);
  registry.registerBuiltinSkill(CAVEMAN_SKILL);
  registry.registerBuiltinSkill(I_HAVE_ADHD_SKILL);
  registry.registerBuiltinSkill(PREMIUM_VISUAL_SKILL);
  registry.registerBuiltinSkill(BROWSER_USE_SKILL);
  registry.registerBuiltinSkill(RESEARCH_USE_SKILL);
  registry.registerBuiltinSkill(COMPUTER_USE_SKILL);
  registry.registerBuiltinSkill(GIT_SAFE_SKILL);
  registry.registerBuiltinSkill(AGENT_JOB_SKILL);
  registry.registerBuiltinSkill(PROJECT_CHECKS_SKILL);
  registry.registerBuiltinSkill(SUB_SKILL_PARENT);
  registry.registerBuiltinSkill(SUB_SKILL_REVIEW);
  registry.registerBuiltinSkill(SUB_SKILL_CONSOLIDATE);
}

export async function registerCatalogSkills(registry: SessionSkillRegistry): Promise<number> {
  return loadCatalogSkills(registry);
}

export {
  AGENT_JOB_SKILL,
  AVOID_AI_WRITING_SKILL,
  BROWSER_USE_SKILL,
  CAVEMAN_SKILL,
  COMPUTER_USE_SKILL,
  CUSTOM_THEME_SKILL,
  GIT_SAFE_SKILL,
  I_HAVE_ADHD_SKILL,
  IMPORT_FROM_CC_CODEX_SKILL,
  MCP_CONFIG_SKILL,
  PREMIUM_VISUAL_SKILL,
  PROJECT_CHECKS_SKILL,
  RECURSIVE_IMPROVE_SKILL,
  RESEARCH_USE_SKILL,
  SUB_SKILL_CONSOLIDATE,
  SUB_SKILL_PARENT,
  SUB_SKILL_REVIEW,
  UPDATE_CONFIG_SKILL,
  WRITE_GOAL_SKILL,
};
