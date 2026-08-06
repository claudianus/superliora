import type { SkillDefinition, SkillSearchHit } from '../../skill';

export interface SkillRegistry {
  getSkill(name: string): SkillDefinition | undefined;
  getPluginSkill(pluginId: string, name: string): SkillDefinition | undefined;
  renderSkillPrompt(skill: SkillDefinition, rawArgs: string): Promise<string>;
  listInvocableSkills(): readonly SkillDefinition[];
  getSkillRoots(): readonly string[];
  getModelSkillListing(): string;
  searchByQuery?(query: string, topK?: number): Promise<readonly SkillSearchHit[]>;
  ensureCatalogLoaded?(): Promise<void>;
  /** Runtime registration (e.g. SkillCreate) — makes a skill visible without a rescan. */
  register?(skill: SkillDefinition, options?: { readonly replace?: boolean }): void;
  /** Runtime removal (e.g. refine rollback of a created skill). */
  unregister?(name: string): void;
}
