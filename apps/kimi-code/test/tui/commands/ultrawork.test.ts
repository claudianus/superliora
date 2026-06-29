import { describe, expect, it, vi } from 'vitest';

import {
  buildUltraworkPrompt,
  handleUltraworkCommand,
  shouldAutoActivateUltrawork,
} from '#/tui/commands/ultrawork';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { currentTheme } from '#/tui/theme';

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
    planMode?: boolean;
    swarmMode?: boolean;
  } = {},
) {
  const session = {
    createGoal: vi.fn(async () => ({})),
    setPlanMode: vi.fn(async () => {}),
    setPermission: vi.fn(async () => {}),
    setSwarmMode: vi.fn(async () => {}),
  };
  const hasSession = overrides.hasSession ?? true;
  const host = {
    state: {
      appState: {
        model: overrides.model ?? 'kimi-model',
        permissionMode: overrides.permissionMode ?? 'auto',
        planMode: overrides.planMode ?? false,
        swarmMode: overrides.swarmMode ?? false,
      },
      theme: currentTheme,
      transcriptContainer: { addChild: vi.fn() },
      ui: { requestRender: vi.fn() },
    },
    session: hasSession ? session : undefined,
    requireSession: () => session,
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(host.state.appState, patch)),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
    mountEditorReplacement: vi.fn(),
    restoreEditor: vi.fn(),
    restoreInputText: vi.fn(),
    sendNormalUserInput: vi.fn(),
    track: vi.fn(),
  } as unknown as SlashCommandHost;
  return { host, session };
}

function renderedMarker(host: SlashCommandHost): string {
  const addChild = host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>;
  const component = addChild.mock.calls.at(-1)?.[0] as TestComponent | undefined;
  return stripAnsi(component?.render(80).join('\n') ?? '');
}

describe('shouldAutoActivateUltrawork', () => {
  it('activates for explicit ultrawork branding and complex autonomous work', () => {
    expect(shouldAutoActivateUltrawork('Use ultrawork to ship the memory workflow')).toBe(true);
    expect(
      shouldAutoActivateUltrawork(
        'Research latest best practices, design the architecture, implement it, run tests, and finish the goal automatically',
      ),
    ).toBe(true);
  });

  it('does not activate for simple prompts', () => {
    expect(shouldAutoActivateUltrawork('fix this typo')).toBe(false);
    expect(shouldAutoActivateUltrawork('what does this file do?')).toBe(false);
    expect(shouldAutoActivateUltrawork('what is ultrawork?')).toBe(false);
    expect(shouldAutoActivateUltrawork('ultrawork 뭐야?')).toBe(false);
    expect(shouldAutoActivateUltrawork('explain ultrawork')).toBe(false);
    expect(shouldAutoActivateUltrawork('do not use ultrawork, just answer normally')).toBe(false);
  });
});

describe('buildUltraworkPrompt', () => {
  it('wraps the objective in the branded workflow contract', () => {
    const prompt = buildUltraworkPrompt('Ship feature X', 'manual');

    expect(prompt).toContain('<ultrawork_flow>');
    expect(prompt).toContain('Ship feature X');
    expect(prompt).toContain('ultra-plan');
    expect(prompt).toContain('kanban');
    expect(prompt).toContain('Kimi Lean Context');
    expect(prompt).toContain('KimiContext');
    expect(prompt).toContain('codegraph');
    expect(prompt).toContain('Kimi Agent Bench');
    expect(prompt).toContain('node scripts/kimi-agent-sota-gate.mjs');
    expect(prompt).toContain('node scripts/qa-super-kimi-autonomous.mjs --phase sota-gate');
    expect(prompt).toContain('C001');
    expect(prompt).toContain('C002');
    expect(prompt).toContain('C003');
    expect(prompt).toContain('pass rate');
    expect(prompt).toContain('budget/cleanup/secret-scan regression proof');
    expect(prompt).toContain('rebranded into Super Kimi internals');
    expect(prompt).toContain(
      'Do not use apps/kimi-web or browser UI paths as a success surface',
    );
    expect(prompt).toContain('UpdateGoal');
  });
});

describe('handleUltraworkCommand', () => {
  it('creates an ultragoal, enables ultra plan and swarm, then sends the workflow prompt', async () => {
    const { host, session } = makeHost();

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

    expect(session.createGoal).toHaveBeenCalledWith({
      objective: 'Ship feature X',
      replace: false,
    });
    expect(session.setPlanMode).toHaveBeenCalledWith(true, true);
    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(host.setAppState).toHaveBeenCalledWith({ planMode: true });
    expect(host.setAppState).toHaveBeenCalledWith({ swarmMode: true });
    expect(renderedMarker(host)).toContain('Ultrawork activated');
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(expect.stringContaining('Ship feature X'));
    expect(host.sendNormalUserInput).toHaveBeenCalledWith(expect.stringContaining('<ultrawork_flow>'));
  });

  it('does not create a goal when ultra-plan setup fails', async () => {
    const { host, session } = makeHost();
    session.setPlanMode.mockRejectedValueOnce(new Error('plan denied'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setPlanMode).toHaveBeenCalledWith(true, true);
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(session.setSwarmMode).toHaveBeenLastCalledWith(false, 'task');
    expect(host.state.appState.swarmMode).toBe(false);
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('does not start when ordinary plan mode is already active but ultra-plan cannot enter', async () => {
    const { host, session } = makeHost({ planMode: true });
    session.setPlanMode.mockRejectedValueOnce(new Error('Already in plan mode'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true);
    expect(session.createGoal).not.toHaveBeenCalled();
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('rolls back ultrawork setup when goal creation fails', async () => {
    const { host, session } = makeHost();
    session.createGoal.mockRejectedValueOnce(new Error('goal denied'));

    await handleUltraworkCommand(host, 'Ship feature X', 'manual');

    expect(session.setSwarmMode).toHaveBeenCalledWith(true, 'task');
    expect(session.setPlanMode).toHaveBeenCalledWith(true, true);
    expect(session.setPlanMode).toHaveBeenLastCalledWith(false, false);
    expect(session.setSwarmMode).toHaveBeenLastCalledWith(false, 'task');
    expect(host.state.appState.planMode).toBe(false);
    expect(host.state.appState.swarmMode).toBe(false);
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('supports replace mode for /ultragoal', async () => {
    const { host, session } = makeHost();

    await handleUltraworkCommand(host, 'replace Ship feature Y', 'manual');

    expect(session.createGoal).toHaveBeenCalledWith({
      objective: 'Ship feature Y',
      replace: true,
    });
  });
});
