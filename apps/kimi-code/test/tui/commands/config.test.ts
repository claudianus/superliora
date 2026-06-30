import { describe, expect, it, vi } from 'vitest';

import { handlePlanCommand } from '#/tui/commands/config';
import type { SlashCommandHost } from '#/tui/commands/dispatch';

function makeHost(options: { planMode?: boolean; planPath?: string | undefined } = {}) {
  const session = {
    clearPlan: vi.fn(async () => {}),
    getPlan: vi.fn(async () => (
      options.planPath === undefined ? null : { path: options.planPath }
    )),
    setPlanMode: vi.fn(async () => {}),
  };
  const host = {
    session,
    state: {
      appState: {
        planMode: options.planMode ?? false,
      },
    },
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(host.state.appState, patch)),
    showError: vi.fn(),
    showNotice: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, session };
}

describe('handlePlanCommand', () => {
  it('uses Ultrawork wording when enabling planning', async () => {
    const { host, session } = makeHost({ planPath: '/tmp/plans/test-plan.md' });

    await handlePlanCommand(host, 'on');

    expect(session.setPlanMode).toHaveBeenCalledWith(true, false);
    expect(host.showNotice).toHaveBeenCalledWith(
      'Ultrawork planning: ON',
      'Plan will be created here: /tmp/plans/test-plan.md',
    );
  });

  it('uses Ultrawork wording when disabling planning', async () => {
    const { host, session } = makeHost({ planMode: true });

    await handlePlanCommand(host, 'off');

    expect(session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(host.showNotice).toHaveBeenCalledWith('Ultrawork planning: OFF');
  });

  it('uses UltraPlan wording for the explicit ultra steering option', async () => {
    const { host, session } = makeHost();

    await handlePlanCommand(host, 'ultra');

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true);
    expect(host.showNotice).toHaveBeenCalledWith('UltraPlan steering: ON', undefined);
  });
});
