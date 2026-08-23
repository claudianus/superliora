import { describe, expect, it } from 'vitest';

import type { Agent } from '../../../src/agent/index';
import { SessionSkillsInjector } from '../../../src/agent/injection/session-skills';
import { SessionSkillRegistry } from '../../../src/skill/registry';

describe('SessionSkillsInjector', () => {
  it('renders recently registered project skills for Skill() by name', () => {
    const registry = new SessionSkillRegistry({ disableCatalogLoad: true });
    registry.register(
      {
        name: 'windows-pnpm-e2e-spawn',
        description: 'Run e2e via test-local on Windows spawn EPERM',
        path: '/repo/.agents/skills/auto/windows-pnpm-e2e-spawn/SKILL.md',
        dir: '/repo/.agents/skills/auto/windows-pnpm-e2e-spawn',
        content: '',
        metadata: { whenToUse: 'Windows e2e spawn EPERM' },
        source: 'project',
      },
      { replace: true },
    );
    const agent = {
      type: 'main',
      skills: { registry },
      context: { history: [] },
    } as unknown as Agent;
    const injector = new SessionSkillsInjector(agent);
    const text = injector.collectForBatch();
    return Promise.resolve(text).then((value) => {
      expect(value).toContain('<session_skills>');
      expect(value).toContain('windows-pnpm-e2e-spawn');
      expect(value).toContain('Skill("name")');
    });
  });

  it('is silent when no session-created skills exist', async () => {
    const registry = new SessionSkillRegistry({ disableCatalogLoad: true });
    const agent = {
      type: 'main',
      skills: { registry },
      context: { history: [] },
    } as unknown as Agent;
    const injector = new SessionSkillsInjector(agent);
    expect(await injector.collectForBatch()).toBeUndefined();
  });
});
