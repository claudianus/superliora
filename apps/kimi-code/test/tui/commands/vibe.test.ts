import type { Session } from '@moonshot-ai/kimi-code-sdk';
import { describe, expect, it, vi } from 'vitest';

import { handleVibeCommand, type SlashCommandHost } from '#/tui/commands/index';

function createHost(planMode = true): SlashCommandHost & {
  session: Session & { setPlanMode: ReturnType<typeof vi.fn> };
  setAppState: ReturnType<typeof vi.fn>;
  showNotice: ReturnType<typeof vi.fn>;
  showError: ReturnType<typeof vi.fn>;
  sendNormalUserInput: ReturnType<typeof vi.fn>;
} {
  const session = {
    setPlanMode: vi.fn(async () => {}),
  } as unknown as Session & { setPlanMode: ReturnType<typeof vi.fn> };

  return {
    session,
    state: { appState: { planMode } },
    setAppState: vi.fn(),
    showNotice: vi.fn(),
    showError: vi.fn(),
    sendNormalUserInput: vi.fn(),
  } as unknown as SlashCommandHost & {
    session: Session & { setPlanMode: ReturnType<typeof vi.fn> };
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
    expect(host.setAppState).toHaveBeenCalledWith({ planMode: false });
    expect(host.showNotice).toHaveBeenCalledWith('Vibe mode: ON', 'Plan mode disabled for direct coding.');
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('Fix the failing test');
  });

  it('does not reset plan mode when vibe mode is already active', async () => {
    const host = createHost(false);

    await handleVibeCommand(host, 'Fix the failing test');

    expect(host.session.setPlanMode).not.toHaveBeenCalled();
    expect(host.setAppState).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('Fix the failing test');
  });

  it('can be used as a mode toggle without sending a task', async () => {
    const host = createHost(true);

    await handleVibeCommand(host, '');

    expect(host.session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });
});
