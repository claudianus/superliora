import type { Session, SkillSummary } from '@superliora/sdk';

import type { LioraSlashCommand } from './types';

export type SkillListSession = Pick<Session, 'listSkills' | 'searchSkills'>;

export interface SkillSlashCommands {
  readonly commands: readonly LioraSlashCommand[];
  readonly commandMap: ReadonlyMap<string, string>;
}

export function isUserActivatableSkill(skill: SkillSummary): boolean {
  return (
    skill.type === undefined ||
    skill.type === 'prompt' ||
    skill.type === 'inline' ||
    skill.type === 'flow'
  );
}

function compareSkillSlashCommands(a: SkillSummary, b: SkillSummary): number {
  return (
    getSkillSlashCommandGroup(a.source) - getSkillSlashCommandGroup(b.source) ||
    a.name.localeCompare(b.name)
  );
}

function getSkillSlashCommandGroup(source: SkillSummary['source']): number {
  return source === 'builtin' ? 0 : 1;
}

export function buildSkillSlashCommands(skills: readonly SkillSummary[]): SkillSlashCommands {
  const commandMap = new Map<string, string>();
  const sortedSkills = [...skills].toSorted(compareSkillSlashCommands);
  const commands = sortedSkills.filter(isUserActivatableSkill).map((skill) => {
    const commandName =
      skill.source === 'builtin' || skill.isSubSkill === true
        ? skill.name
        : `skill:${skill.name}`;
    commandMap.set(commandName, skill.name);
    const sourceHint =
      skill.source === 'builtin'
        ? 'builtin'
        : skill.source === undefined
          ? undefined
          : String(skill.source);
    const baseDesc = (skill.description ?? '').trim();
    const description =
      sourceHint !== undefined && sourceHint !== 'builtin' && baseDesc.length > 0
        ? `${baseDesc} · ${sourceHint}`
        : sourceHint !== undefined && sourceHint !== 'builtin'
          ? sourceHint
          : baseDesc;
    return {
      name: commandName,
      aliases: [],
      description,
    };
  });
  return { commands, commandMap };
}
