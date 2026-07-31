import { describe, expect, it, vi } from 'vitest';

import { handleSwarmCommand } from '#/tui/commands/index';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { currentTheme } from '#/tui/theme';

const ENTER = '\r';
const ESCAPE = '\u001B';
const DOWN = '\u001B[B';

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

interface TestComponent {
  render(width: number): string[];
}

function makeHost(
  overrides: {
    model?: string;
    hasSession?: boolean;
    permissionMode?: 'manual' | 'auto' | 'yolo';
    swarmMode?: boolean;
    warRoomInvoke?: ReturnType<typeof vi.fn>;
    listWarRoomExperts?: ReturnType<typeof vi.fn>;
    withInteractiveAgent?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const session = {
    setPermission: vi.fn(async () => {}),
    setSwarmMode: vi.fn(async () => {}),
    getSessionTrace: vi.fn(async () => ({
      context: {
        history: [
          { role: 'user', content: [{ type: 'text', text: 'prior ask' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'prior reply' }] },
        ],
      },
    })),
    steer: vi.fn(async () => {}),
    prompt: vi.fn(async () => {}),
  };
  const hasSession = overrides.hasSession ?? true;
  const warRoomInvoke = overrides.warRoomInvoke;
  const listWarRoomExperts = overrides.listWarRoomExperts;
  const withInteractiveAgent =
    overrides.withInteractiveAgent ??
    vi.fn((_agentId: string, fn: () => unknown) => fn());
  const host = {
    state: {
      appState: {
        model: overrides.model ?? 'kimi-model',
        permissionMode: overrides.permissionMode ?? 'auto',
        swarmMode: overrides.swarmMode ?? false,
      },
      theme: currentTheme,
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
      renderer: { invalidateFrame: vi.fn() },
    },
    session: hasSession ? session : undefined,
    harness: { withInteractiveAgent },
    requireSession: () => session,
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(host.state.appState, patch)),
    showError: vi.fn(),
    showStatus: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    sendNormalUserInput: vi.fn(),
    ...(warRoomInvoke === undefined && listWarRoomExperts === undefined
      ? {}
      : {
          sessionEventHandler: {
            ...(warRoomInvoke === undefined ? {} : { invokeWarRoomAction: warRoomInvoke }),
            ...(listWarRoomExperts === undefined
              ? {}
              : { listWarRoomExperts }),
          },
        }),
  } as unknown as SlashCommandHost;
  return { host, session, warRoomInvoke, listWarRoomExperts, withInteractiveAgent };
}

interface TestPicker {
  handleInput(data: string): void;
  render(width: number): string[];
}

function mountedPicker(host: SlashCommandHost): TestPicker {
  const mock = host.mountEditorReplacement as ReturnType<typeof vi.fn>;
  return mock.mock.calls[0]?.[0] as TestPicker;
}

function markerAddChild(host: SlashCommandHost): ReturnType<typeof vi.fn> {
  return host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>;
}

function expectSwarmMarker(host: SlashCommandHost, text: string): void {
  const components = markerAddChild(host).mock.calls.map(([component]) => component as TestComponent);
  const rendered = stripAnsi(components.at(-1)?.render(80).join('\n') ?? '');
  expect(rendered).toContain(text);
}

describe('handleSwarmCommand', () => {
  it('sends the swarm prompt as a normal prompt after enabling swarm mode', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto' });

    await handleSwarmCommand(host, 'Ship feature X');

    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(host.state.swarmModeEntry).toBe('task');
    expectSwarmMarker(host, 'Swarm activated');
    expect(host.mountEditorReplacement).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
  });

  it('sends the swarm prompt without re-entering swarm mode when already on', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto', swarmMode: true });

    await handleSwarmCommand(host, 'Ship feature X');

    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(host.state.swarmModeEntry).toBeUndefined();
    expectSwarmMarker(host, 'Swarm activated');
    expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
  });

  it('turns swarm mode on without sending a prompt', async () => {
    const { host, session } = makeHost({ model: '' });

    await handleSwarmCommand(host, 'on');

    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'manual');
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.state.swarmModeEntry).toBe('manual');
    expectSwarmMarker(host, 'Swarm activated');
    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('asks before turning swarm mode on in Manual mode', async () => {
    const { host, session } = makeHost({ model: '', permissionMode: 'manual' });

    await handleSwarmCommand(host, 'on');

    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    const text = stripAnsi(mountedPicker(host).render(80).join('\n'));
    expect(text).toContain('Manual mode can block swarm work');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'manual');
    });
    expect(session.setPermission).toHaveBeenCalledWith('auto');
    expect(session.setSwarmMode).toHaveBeenCalledTimes(1);
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'auto' });
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.state.swarmModeEntry).toBe('manual');
    expectSwarmMarker(host, 'Swarm activated');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('turns swarm mode on when called without args while swarm mode is off', async () => {
    const { host, session } = makeHost({ model: '', swarmMode: false });

    await handleSwarmCommand(host, '');

    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'manual');
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.state.swarmModeEntry).toBe('manual');
    expectSwarmMarker(host, 'Swarm activated');
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not call the session when swarm mode is already on', async () => {
    const { host, session } = makeHost({ model: '', swarmMode: true });

    await handleSwarmCommand(host, 'on');

    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(host.setAppState).not.toHaveBeenCalledWith({ swarmMode: true });
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith('Swarm mode is already on.');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('turns swarm mode off without sending a prompt', async () => {
    const { host, session } = makeHost({ model: '', swarmMode: true });

    await handleSwarmCommand(host, 'off');

    expect(session.setSwarmMode).toHaveBeenCalledWith(false, 'manual');
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: false });
    expect(host.state.swarmModeEntry).toBeUndefined();
    expectSwarmMarker(host, 'Swarm deactivated');
    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('turns swarm mode off when called without args while swarm mode is on', async () => {
    const { host, session } = makeHost({ model: '', swarmMode: true });

    await handleSwarmCommand(host, '');

    expect(session.setSwarmMode).toHaveBeenCalledWith(false, 'manual');
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: false });
    expect(host.state.swarmModeEntry).toBeUndefined();
    expectSwarmMarker(host, 'Swarm deactivated');
    expect(host.showError).not.toHaveBeenCalled();
    expect(host.showStatus).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not call the session when swarm mode is already off', async () => {
    const { host, session } = makeHost({ model: '', swarmMode: false });

    await handleSwarmCommand(host, 'off');

    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(host.setAppState).not.toHaveBeenCalledWith({ swarmMode: false });
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith('Swarm mode is already off.');
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('asks before starting a swarm task in Manual mode', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'Ship feature X');

    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
    const text = stripAnsi(mountedPicker(host).render(80).join('\n'));
    expect(text).toContain('Manual mode can block swarm work');
    expect(text).toContain('Switch to YOLO and start');
    expect(text).not.toContain('Do not start');
  });

  it('defaults to Auto when confirming a Manual-mode swarm start', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
    });
    expect(session.setPermission).toHaveBeenCalledWith('auto');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setSwarmMode).toHaveBeenCalledTimes(1);
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'auto' });
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.state.swarmModeEntry).toBe('task');
    expectSwarmMarker(host, 'Swarm activated');
  });

  it('can start a Manual-mode swarm task without changing permission', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'Ship feature X');
    const picker = mountedPicker(host);
    picker.handleInput(DOWN);
    picker.handleInput(DOWN);
    picker.handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
    });
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setSwarmMode).toHaveBeenCalledTimes(1);
    expect(host.state.swarmModeEntry).toBe('task');
    expectSwarmMarker(host, 'Swarm activated');
  });

  it('can start a Manual-mode swarm task after switching to YOLO', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'Ship feature X');
    const picker = mountedPicker(host);
    picker.handleInput(DOWN);
    picker.handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.sendNormalUserInput).toHaveBeenCalledWith('Ship feature X');
    });
    expect(session.setPermission).toHaveBeenCalledWith('yolo');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setSwarmMode).toHaveBeenCalledTimes(1);
    expect(host.setAppState).toHaveBeenCalledWith({ permissionMode: 'yolo' });
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(host.state.swarmModeEntry).toBe('task');
    expectSwarmMarker(host, 'Swarm activated');
  });

  it('returns the command to the input box when a Manual-mode swarm start is cancelled', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });

    await handleSwarmCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ESCAPE);

    expect(host.restoreInputText).toHaveBeenCalledWith('/swarm Ship feature X');
    expect(host.showStatus).toHaveBeenCalledWith('Swarm task not started.');
    expect(session.setPermission).not.toHaveBeenCalled();
    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not start when permission update fails', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });
    session.setPermission.mockRejectedValueOnce(new Error('denied'));

    await handleSwarmCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to set permission mode'),
      );
    });
    expect(session.setSwarmMode).not.toHaveBeenCalled();
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not send from Manual mode when enabling swarm mode fails after confirmation', async () => {
    const { host, session } = makeHost({ permissionMode: 'manual' });
    session.setSwarmMode.mockRejectedValueOnce(new Error('denied'));

    await handleSwarmCommand(host, 'Ship feature X');
    mountedPicker(host).handleInput(ENTER);

    await vi.waitFor(() => {
      expect(host.showError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to enable swarm mode'),
      );
    });
    expect(session.setPermission).toHaveBeenCalledWith('auto');
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not send a prompt when enabling swarm mode fails', async () => {
    const { host, session } = makeHost({ permissionMode: 'auto' });
    session.setSwarmMode.mockRejectedValueOnce(new Error('denied'));

    await handleSwarmCommand(host, 'Ship feature X');

    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to enable swarm mode'),
    );
    expect(markerAddChild(host)).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('routes /swarm pause to war room dock when a swarm card is active', async () => {
    const warRoomInvoke = vi.fn(() => 1);
    const { host } = makeHost({ warRoomInvoke });

    await handleSwarmCommand(host, 'pause');

    expect(warRoomInvoke).toHaveBeenCalledWith('pause', {
      reason: 'Paused from war room',
    });
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('Paused'));
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('errors when /swarm restaff has no active war room', async () => {
    const warRoomInvoke = vi.fn(() => 0);
    const { host } = makeHost({ warRoomInvoke });

    await handleSwarmCommand(host, 'restaff');

    expect(warRoomInvoke).toHaveBeenCalledWith('restaff', {
      reason: 'User requested restaff',
    });
    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('No active Fleet'),
    );
  });

  it('passes custom restaff reason through war room dock', async () => {
    const warRoomInvoke = vi.fn(() => 1);
    const { host } = makeHost({ warRoomInvoke });

    await handleSwarmCommand(host, 'restaff Close QA gaps');

    expect(warRoomInvoke).toHaveBeenCalledWith('restaff', {
      reason: 'Close QA gaps',
    });
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('restaff'));
  });

  it('toggles raw feed via /swarm raw', async () => {
    const warRoomInvoke = vi.fn(() => 2);
    const { host } = makeHost({ warRoomInvoke });

    await handleSwarmCommand(host, 'raw');

    expect(warRoomInvoke).toHaveBeenCalledWith('raw', {});
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('raw feed'));
  });

  it('opens a War Room expert picker for /swarm talk', async () => {
    const listWarRoomExperts = vi.fn(() => [
      {
        expertId: 'alice',
        name: 'Alice',
        agentId: 'agent-alice',
        phase: 'running' as const,
      },
    ]);
    const { host } = makeHost({ listWarRoomExperts });

    await handleSwarmCommand(host, 'talk');

    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    const text = stripAnsi(mountedPicker(host).render(80).join('\n'));
    expect(text).toContain('Talk to a War Room expert');
    expect(text).toContain('Alice');
  });

  it('opens a transcript panel for /swarm talk <expert>', async () => {
    const listWarRoomExperts = vi.fn(() => [
      {
        expertId: 'alice',
        name: 'Alice',
        agentId: 'agent-alice',
        phase: 'running' as const,
      },
    ]);
    const { host, session, withInteractiveAgent } = makeHost({ listWarRoomExperts });

    await handleSwarmCommand(host, 'talk Alice');

    expect(withInteractiveAgent).toHaveBeenCalledWith('agent-alice', expect.any(Function));
    expect(session.getSessionTrace).toHaveBeenCalledOnce();
    expect(host.mountEditorReplacement).toHaveBeenCalledOnce();
    const text = stripAnsi(mountedPicker(host).render(80).join('\n'));
    expect(text).toContain('Alice');
    expect(text).toContain('prior ask');
    expect(text).toContain('prior reply');
  });

  it('steers a running expert via /swarm msg', async () => {
    const listWarRoomExperts = vi.fn(() => [
      {
        expertId: 'alice',
        name: 'Alice',
        agentId: 'agent-alice',
        phase: 'running' as const,
      },
    ]);
    const { host, session } = makeHost({ listWarRoomExperts });

    await handleSwarmCommand(host, 'msg Alice focus on auth');

    expect(session.steer).toHaveBeenCalledWith('focus on auth');
    expect(session.prompt).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('Steered'));
  });

  it('prompts an idle expert via /swarm msg', async () => {
    const listWarRoomExperts = vi.fn(() => [
      {
        expertId: 'bob',
        name: 'Bob',
        agentId: 'agent-bob',
        phase: 'completed' as const,
      },
    ]);
    const { host, session } = makeHost({ listWarRoomExperts });

    await handleSwarmCommand(host, 'msg Bob check the diff');

    expect(session.prompt).toHaveBeenCalledWith('check the diff');
    expect(session.steer).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('Messaged'));
  });

  it('errors when /swarm talk has no war room experts', async () => {
    const listWarRoomExperts = vi.fn(() => []);
    const { host } = makeHost({ listWarRoomExperts });

    await handleSwarmCommand(host, 'talk');

    expect(host.showError).toHaveBeenCalledWith(
      expect.stringContaining('No Fleet / AgentSwarm war room experts'),
    );
    expect(host.mountEditorReplacement).not.toHaveBeenCalled();
  });
});
