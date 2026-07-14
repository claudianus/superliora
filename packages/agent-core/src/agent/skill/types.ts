import type { SkillDefinition, SkillSearchHit } from '../../skill';

export interface SkillRegistry {
  getSkill(name: string): SkillDefinition | undefined;
  getPluginSkill(pluginId: string, name: string): SkillDefinition | undefined;
  renderSkillPrompt(skill: SkillDefinition, rawArgs: string): Promise<string>;
  listInvocableSkills(): readonly SkillDefinition[];
  getSkillRoots(): readonly string[];
  getModelSkillListing(): string;
  getLegacyModelSkillListing?(): string;
  searchByQuery?(query: string, topK?: number): Promise<readonly SkillSearchHit[]>;
  ensureCatalogLoaded?(): Promise<void>;
}
