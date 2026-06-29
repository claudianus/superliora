import type { Session } from '@moonshot-ai/kimi-code-sdk';
import { describe, expect, it, vi } from 'vitest';

import { handlePlanCommand, handleVibeCommand, type SlashCommandHost } from '#/tui/commands/index';

function createHost(planMode = true): SlashCommandHost & {
  session: Session & {
    getPlan: ReturnType<typeof vi.fn>;
    setPlanMode: ReturnType<typeof vi.fn>;
  };
  setAppState: ReturnType<typeof vi.fn>;
  showNotice: ReturnType<typeof vi.fn>;
  showError: ReturnType<typeof vi.fn>;
  sendNormalUserInput: ReturnType<typeof vi.fn>;
} {
  const session = {
    getPlan: vi.fn(async () => null),
    setPlanMode: vi.fn(async () => {}),
  } as unknown as Session & {
    getPlan: ReturnType<typeof vi.fn>;
    setPlanMode: ReturnType<typeof vi.fn>;
  };

  return {
    session,
    state: { appState: { planMode } },
    setAppState: vi.fn(),
    showNotice: vi.fn(),
    showError: vi.fn(),
    sendNormalUserInput: vi.fn(),
  } as unknown as SlashCommandHost & {
    session: Session & {
      getPlan: ReturnType<typeof vi.fn>;
      setPlanMode: ReturnType<typeof vi.fn>;
    };
    setAppState: ReturnType<typeof vi.fn>;
    showNotice: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    sendNormalUserInput: ReturnType<typeof vi.fn>;
  };
}

describe('handleVibeCommand', () => {
  it('turns off plan mode and sends the task as normal input', async () => {
    const host = createHost(true);

    await handleVibeCommand(host, ' Fix the failing test ');

    expect(host.session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(host.setAppState).toHaveBeenCalledWith({
      planMode: false,
      activityTip: 'Vibe mode: direct coding, no plan gate',
    });
    expect(host.showNotice).toHaveBeenCalledWith('Vibe mode: ON', 'Plan mode disabled for direct coding.');
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('Fix the failing test');
  });

  it('does not reset plan mode when vibe mode is already active', async () => {
    const host = createHost(false);

    await handleVibeCommand(host, 'Fix the failing test');

    expect(host.session.setPlanMode).not.toHaveBeenCalled();
    expect(host.setAppState).toHaveBeenCalledWith({
      activityTip: 'Vibe mode: direct coding, no plan gate',
    });
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('Fix the failing test');
  });

  it('can be used as a mode toggle without sending a task', async () => {
    const host = createHost(true);

    await handleVibeCommand(host, '');

    expect(host.session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('clears the vibe activity tip when plan mode is enabled again', async () => {
    const host = createHost(false);
    host.state.appState.activityTip = 'Vibe mode: direct coding, no plan gate';

    await handlePlanCommand(host, 'on');

    expect(host.session.setPlanMode).toHaveBeenCalledWith(true, false);
    expect(host.setAppState).toHaveBeenCalledWith({ planMode: true, activityTip: null });
  });
});
