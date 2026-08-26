/**
 * Injects skills created in this session so the model can Skill("name")
 * without competing with the catalog SearchSkill ranking.
 */

import { DynamicInjector } from './injector';
import type { Agent } from '..';

const SESSION_SKILLS_INJECTION_CAP = 8;

export class SessionSkillsInjector extends DynamicInjector {
  protected override readonly injectionVariant = 'session_skills';
  private lastInjectedKey: string | null = null;

  constructor(agent: Agent) {
    super(agent);
  }

  protected override getInjection(): string | undefined {
    const entries = this.agent.skills?.registry.listSessionCreatedSkills?.() ?? [];
    if (entries.length === 0) {
      this.lastInjectedKey = null;
      return undefined;
    }
    const recent = entries.slice(-SESSION_SKILLS_INJECTION_CAP);
    const key = recent.map((entry) => entry.name).join('\0');
    if (key === this.lastInjectedKey && this.injectedAt !== null) return undefined;
    this.lastInjectedKey = key;
    const lines = recent.map((entry) => {
      const when = entry.whenToUse.trim();
      return when.length > 0
        ? `- ${entry.name}: ${entry.description} (${when})`
        : `- ${entry.name}: ${entry.description}`;
    });
    return [
      '<session_skills>',
      'Skills created in this session — already registered. Invoke with Skill("name"); SearchSkill is optional.',
      ...lines,
      '</session_skills>',
    ].join('\n');
  }
}
