import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { PermissionModeInjector } from '#/agent/injection/permission-mode';

class TestablePermissionModeInjector extends PermissionModeInjector {
  constructor(agent: Agent) {
    super();
    // Inject the agent reference via the parent class.
    (this as unknown as { agent: Agent }).agent = agent;
  }
}

const build = (mode: string): TestablePermissionModeInjector =>
  new TestablePermissionModeInjector({ permission: { mode } } as unknown as Agent);

describe('agent/injection/permission-mode — getInjection', () => {
  it('returns undefined on the first manual call (no previous auto)', () => {
    const injector = build('manual');
    expect(injector.getInjection()).toBeUndefined();
  });

  it('returns the AUTO_MODE_ENTER reminder when mode becomes auto', () => {
    const injector = build('manual');
    injector.getInjection(); // baseline
    const result = injector.getInjection();
    injector.agent = { permission: { mode: 'auto' } } as unknown as Agent;
    const entered = injector.getInjection();
    expect(entered).toContain('Auto permission mode is active');
    expect(entered).toContain('AskUserQuestion auto-answers');
    expect(entered).toContain('Ask mode also disables auto-answer');
    expect(result).toBeUndefined();
  });

  it('returns undefined when mode does not change', () => {
    const injector = build('auto');
    expect(injector.getInjection()).toContain('Auto permission mode is active');
    expect(injector.getInjection()).toBeUndefined();
  });

  it('returns the AUTO_MODE_EXIT reminder when leaving auto', () => {
    const injector = build('auto');
    injector.getInjection(); // baseline (prev undefined)
    (injector as unknown as { agent: Agent }).agent = {
      permission: { mode: 'auto' },
    } as unknown as Agent;
    injector.getInjection(); // first auto call → undefined
    (injector as unknown as { agent: Agent }).agent = {
      permission: { mode: 'manual' },
    } as unknown as Agent;
    const exited = injector.getInjection();
    expect(exited).toContain('Auto permission mode is no longer active');
  });
});
