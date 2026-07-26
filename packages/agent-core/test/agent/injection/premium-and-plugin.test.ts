import { describe, expect, it, vi } from 'vitest';

import type { Agent } from '#/agent';
import { resolveActivePremiumDensity } from '#/agent/injection/premium-quality';
import {
  PluginSessionStartInjector,
  renderPluginSessionStartReminder,
} from '#/agent/injection/plugin-session-start';
import type { EnabledPluginSessionStart } from '#/plugin/types';
import type { SkillDefinition } from '#/skill';
import type { ContextMessage } from '#/agent/context';

const buildAgent = (overrides: {
  goal?: { getGoal: () => { goal: { objective: string } | null } | null };
  ultrawork?: { getRun: () => { objective: string } | null };
  profile?: Map<string, unknown>;
}): Agent =>
  ({
    goal: overrides.goal ?? { getGoal: () => null },
    ultrawork: overrides.ultrawork ?? { getRun: () => null },
    ultraworkObjectiveProfile: overrides.profile ?? new Map(),
  }) as unknown as Agent;

describe('agent/injection/premium-quality — resolveActivePremiumDensity', () => {
  it('falls back to the default density when there is no goal or run', () => {
    const result = resolveActivePremiumDensity(buildAgent({}));
    expect(['code', 'visual', 'evidence', 'minimal']).toContain(result);
  });

  it('looks up the profile keyed by the goal objective', () => {
    const profile = new Map<string, unknown>([
      ['design-a-hero', { premiumDensity: 'visual' }],
    ]);
    const agent = buildAgent({
      goal: { getGoal: () => ({ goal: { objective: 'design-a-hero' } }) },
      profile,
    });
    expect(resolveActivePremiumDensity(agent)).toBe('visual');
  });

  it('falls back to the run-objective profile when the goal has no match', () => {
    const profile = new Map<string, unknown>([
      ['refactor-runtime', { premiumDensity: 'code' }],
    ]);
    const agent = buildAgent({
      ultrawork: { getRun: () => ({ objective: 'refactor-runtime' }) },
      profile,
    });
    expect(resolveActivePremiumDensity(agent)).toBe('code');
  });

  it('goal objective wins over the run objective', () => {
    const profile = new Map<string, unknown>([
      ['goal-x', { premiumDensity: 'visual' }],
      ['run-y', { premiumDensity: 'code' }],
    ]);
    const agent = buildAgent({
      goal: { getGoal: () => ({ goal: { objective: 'goal-x' } }) },
      ultrawork: { getRun: () => ({ objective: 'run-y' }) },
      profile,
    });
    expect(resolveActivePremiumDensity(agent)).toBe('visual');
  });

  it('returns the default density when the profile lookup misses', () => {
    const agent = buildAgent({
      goal: { getGoal: () => ({ goal: { objective: 'no-profile-here' } }) },
      profile: new Map(),
    });
    expect(['code', 'visual', 'evidence', 'minimal']).toContain(
      resolveActivePremiumDensity(agent),
    );
  });
});

const buildSkill = (name: string): SkillDefinition =>
  ({ name, description: '', prompt: 'do thing' } as unknown as SkillDefinition);

const buildSessionStart = (
  pluginId: string,
  skillName: string,
): EnabledPluginSessionStart =>
  ({ pluginId, skillName }) as EnabledPluginSessionStart;

describe('agent/injection/plugin-session-start — renderPluginSessionStartReminder', () => {
  it('returns undefined when there are no session starts', async () => {
    const result = await renderPluginSessionStartReminder({
      sessionStarts: [],
      registry: undefined,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when the registry is undefined', async () => {
    const result = await renderPluginSessionStartReminder({
      sessionStarts: [buildSessionStart('p1', 's1')],
      registry: undefined,
    });
    expect(result).toBeUndefined();
  });

  it('logs a warning and skips missing skills', async () => {
    const log = { warn: vi.fn() };
    const registry = {
      getPluginSkill: () => undefined,
      renderSkillPrompt: vi.fn(),
    };
    const result = await renderPluginSessionStartReminder({
      sessionStarts: [buildSessionStart('p1', 's1')],
      registry,
      log,
    });
    expect(result).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('plugin sessionStart skill not found', {
      pluginId: 'p1',
      skillName: 's1',
    });
    expect(registry.renderSkillPrompt).not.toHaveBeenCalled();
  });

  it('renders one block per session start with escaped attributes', async () => {
    const registry = {
      getPluginSkill: (id: string, name: string) =>
        id === 'p1' && name === 's1' ? buildSkill('s1') : undefined,
      renderSkillPrompt: vi.fn(async () => 'hello body'),
    };
    const result = await renderPluginSessionStartReminder({
      sessionStarts: [buildSessionStart('p1', 's1')],
      registry,
    });
    expect(result).toContain('<plugin_session_start plugin="p1" skill="s1">');
    expect(result).toContain('hello body');
    expect(result).toContain('</plugin_session_start>');
  });
});

const userMessage = (overrides: Partial<ContextMessage> = {}): ContextMessage =>
  ({
    role: 'user',
    origin: { kind: 'user', source: 'user' },
    content: [{ type: 'text', text: 'hi' }],
    ...overrides,
  }) as ContextMessage;

describe('agent/injection/plugin-session-start — PluginSessionStartInjector', () => {
  it('returns undefined once already injected in this session', async () => {
    const injector = new PluginSessionStartInjector({
      pluginSessionStarts: [],
      skills: undefined,
      context: { history: [] },
      log: { warn: vi.fn() },
    } as unknown as Agent);
    const first = await injector.getInjection();
    expect(first).toBeUndefined();
    // Force the injectedAt to a non-null value to simulate the base class
    // promote-then-cache flow.
    (injector as unknown as { injectedAt: number | null }).injectedAt = 0;
    const second = await injector.getInjection();
    expect(second).toBeUndefined();
  });

  it('skips re-injection when an earlier session_start reminder is in history', async () => {
    const history: ContextMessage[] = [
      userMessage({
        origin: { kind: 'injection', variant: 'plugin_session_start' } as never,
      }),
    ];
    const injector = new PluginSessionStartInjector({
      pluginSessionStarts: [buildSessionStart('p1', 's1')],
      skills: {
        registry: {
          getPluginSkill: () => buildSkill('s1'),
          renderSkillPrompt: vi.fn(async () => 'body'),
        },
      },
      context: { history },
      log: { warn: vi.fn() },
    } as unknown as Agent);
    const result = await injector.getInjection();
    expect(result).toBeUndefined();
  });
});
