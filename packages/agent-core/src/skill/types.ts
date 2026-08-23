export type SkillSource = 'project' | 'user' | 'extra' | 'builtin';

export interface SkillMetadata {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly type?: string | undefined;
  readonly whenToUse?: string | undefined;
  readonly disableModelInvocation?: boolean | undefined;
  readonly isSubSkill?: boolean | undefined;
  readonly safe?: boolean | undefined;
  readonly arguments?: readonly unknown[] | string | undefined;
  readonly [key: string]: unknown;
}

type CustomSkillRisk = string & { readonly __customSkillRisk?: never };

export type SkillRisk = 'low' | 'medium' | 'high' | 'unknown' | CustomSkillRisk;

export interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly dir: string;
  readonly content: string;
  readonly metadata: SkillMetadata;
  readonly source: SkillSource;
  readonly plugin?: SkillPluginContext;
  readonly mermaid?: string | undefined;
  readonly d2?: string;
  readonly contentHash?: string | undefined;
  readonly headings?: readonly string[] | undefined;
  readonly resources?: readonly string[] | undefined;
  readonly loadContent?: (() => Promise<string>) | undefined;
}

export interface SkillSummary {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly source: SkillSource;
  readonly type?: string | undefined;
  readonly disableModelInvocation?: boolean | undefined;
  readonly isSubSkill?: boolean | undefined;
}

export interface SkillSearchHit extends SkillSummary {
  readonly score: number;
  readonly matchReason: string;
  readonly risk?: SkillRisk | undefined;
  readonly category?: string | undefined;
  readonly whenToUse?: string | undefined;
  readonly triggers?: readonly string[] | undefined;
  /** True when this skill was registered in the current session (live SkillCreate/auto). */
  readonly fresh?: boolean | undefined;
}

export interface SessionCreatedSkill {
  readonly name: string;
  readonly description: string;
  readonly whenToUse: string;
  readonly path: string;
}

export interface SkillRoot {
  readonly path: string;
  readonly source: SkillSource;
  readonly plugin?: SkillPluginContext;
}

export interface SkillPluginContext {
  readonly id: string;
  readonly instructions?: string;
}

export interface SkippedSkill {
  readonly path: string;
  readonly type: string;
  readonly reason: string;
}

export interface SkillCatalog {
  getSkill(name: string): SkillDefinition | undefined;
  listSkills(): readonly SkillDefinition[];
  listInvocableSkills(): readonly SkillDefinition[];
}

export function normalizeSkillName(name: string): string {
  return name.toLowerCase();
}

export function isInlineSkillType(type: string | undefined): boolean {
  return type === undefined || type === 'prompt' || type === 'inline';
}

export function isUserActivatableSkillType(type: string | undefined): boolean {
  return isInlineSkillType(type) || type === 'flow';
}

export function isExpertSkillType(type: string | undefined): boolean {
  return type === 'expert';
}

export function isSupportedSkillType(type: string | undefined): boolean {
  return isUserActivatableSkillType(type) || type === 'reference' || type === 'expert';
}

export function summarizeSkill(skill: SkillDefinition): SkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    source: skill.source,
    type: skill.metadata.type,
    disableModelInvocation: skill.metadata.disableModelInvocation,
    isSubSkill: skill.metadata.isSubSkill,
  };
}

export function summarizeSkillSearchHit(
  skill: SkillDefinition,
  score: number,
  matchReason: string,
): SkillSearchHit {
  const base = summarizeSkill(skill);
  const whenToUse = skillWhenToUse(skill);
  const triggers = skillTriggers(skill);
  return {
    ...base,
    score,
    matchReason,
    risk: skillRisk(skill),
    category: skillCategory(skill),
    ...(whenToUse.length > 0 ? { whenToUse } : {}),
    ...(triggers.length > 0 ? { triggers } : {}),
  };
}

export function skillWhenToUse(skill: SkillDefinition): string {
  const value = skill.metadata.whenToUse;
  return typeof value === 'string' ? value.trim() : '';
}

export function skillTriggers(skill: SkillDefinition): readonly string[] {
  const value = skill.metadata['triggers'];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

export function skillRisk(skill: SkillDefinition): SkillRisk | undefined {
  const value = skill.metadata['risk'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function skillCategory(skill: SkillDefinition): string | undefined {
  const value = skill.metadata['category'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
