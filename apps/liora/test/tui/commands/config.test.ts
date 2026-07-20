import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  handleAppearanceCommand,
  handlePlanCommand,
  handleThemeCommand,
  handleThinkingCommand,
} from '#/tui/commands/config';
import { dispatchInput, type SlashCommandHost } from '#/tui/commands/dispatch';
import { DEFAULT_APPEARANCE_PREFERENCES, loadTuiConfig } from '#/tui/config';

function makeHost(options: { planMode?: boolean; planPath?: string | undefined } = {}) {
  const session = {
    clearPlan: vi.fn(async () => {}),
    getPlan: vi.fn(async () => (
      options.planPath === undefined ? null : { path: options.planPath }
    )),
    setPlanMode: vi.fn(async () => {}),
    getUltraworkRun: vi.fn(async () => null),
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

function makeThemeHost() {
  const appState = {
    theme: 'auto',
    permissionMode: 'yolo',
    disablePasteBurst: false,
    editorCommand: null,
    notifications: { enabled: true, condition: 'unfocused' },
    upgrade: { autoInstall: true },
    appearance: DEFAULT_APPEARANCE_PREFERENCES,
  };
  const host = {
    state: {
      appState,
    },
    applyTheme: vi.fn(async (theme: string) => {
      appState.theme = theme;
    }),
    refreshTerminalThemeTracking: vi.fn(),
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(appState, patch)),
    showError: vi.fn(),
    showNotice: vi.fn(),
    showStatus: vi.fn(),
    track: vi.fn(),
  };
  return host as unknown as SlashCommandHost & typeof host;
}

function makeThinkingHost(
  options: {
    model?: string;
    capabilities?: string[];
    supportEfforts?: string[];
    hasSession?: boolean;
  } = {},
) {
  const appState = {
    model: options.model ?? 'k2',
    thinking: false,
    streamingPhase: 'idle',
    isCompacting: false,
    isBackgroundCompacting: false,
    availableModels: {
      k2: {
        provider: 'managed:kimi-api',
        model: 'kimi-k2',
        maxContextSize: 100,
        capabilities: options.capabilities ?? ['thinking'],
        supportEfforts: options.supportEfforts,
      },
    },
  };
  const session = {
    setThinking: vi.fn(async () => {}),
  };
  const host = {
    session: options.hasSession === false ? undefined : session,
    state: {
      appState,
    },
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(appState, patch)),
    skillCommandMap: new Map<string, string>(),
    pluginCommandMap: new Map<string, string>(),
    showError: vi.fn(),
    showStatus: vi.fn(),
    sendNormalUserInput: vi.fn(),
    track: vi.fn(),
  };
  return {
    host: host as unknown as SlashCommandHost & typeof host,
    session,
  };
}

async function withTempHome<T>(run: () => Promise<T>): Promise<T> {
  const originalHome = process.env['SUPERLIORA_HOME'];
  const home = await mkdtemp(join(tmpdir(), 'kimi-command-theme-'));
  process.env['SUPERLIORA_HOME'] = home;
  try {
    return await run();
  } finally {
    await rm(home, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env['SUPERLIORA_HOME'];
    } else {
      process.env['SUPERLIORA_HOME'] = originalHome;
    }
  }
}

describe('handlePlanCommand', () => {
  it('announces plan mode with the plan file location when enabling planning', async () => {
    const { host, session } = makeHost({ planPath: '/tmp/plans/test-plan.md' });

    await handlePlanCommand(host, 'on');

    expect(session.setPlanMode).toHaveBeenCalledWith(true, false);
    expect(host.showNotice).toHaveBeenCalledWith(
      'Plan mode: ON (free-form)',
      'Plan file: /tmp/plans/test-plan.md',
    );
  });

  it('announces plan mode OFF when disabling planning', async () => {
    const { host, session } = makeHost({ planMode: true });

    await handlePlanCommand(host, 'off');

    expect(session.setPlanMode).toHaveBeenCalledWith(false, false);
    expect(host.showNotice).toHaveBeenCalledWith('Plan mode: OFF');
  });

  it('announces UltraPlan mode for the explicit ultra option', async () => {
    const { host, session } = makeHost();

    await handlePlanCommand(host, 'ultra');

    expect(session.setPlanMode).toHaveBeenCalledWith(true, true);
    expect(host.showNotice).toHaveBeenCalledWith('UltraPlan mode: ON (structured pipeline)', undefined);
  });
});

describe('handleThemeCommand', () => {
  it('applies bundled SuperLiora themes by name', async () => {
    await withTempHome(async () => {
      const host = makeThemeHost();

      await handleThemeCommand(host, 'superliora-neon-noir');

      expect(host.applyTheme).toHaveBeenCalledWith('superliora-neon-noir', undefined);
      expect(host.state.appState.theme).toBe('superliora-neon-noir');
      expect(host.track).toHaveBeenCalledWith('theme_switch', {
        theme: 'superliora-neon-noir',
      });
      expect(host.showStatus).toHaveBeenCalledWith('Theme set to "superliora-neon-noir".');
      expect(host.showError).not.toHaveBeenCalled();
    });
  });

  it('reports an error for unknown themes', async () => {
    await withTempHome(async () => {
      const host = makeThemeHost();

      await handleThemeCommand(host, 'does-not-exist');

      expect(host.showError).toHaveBeenCalledWith('Unknown theme: does-not-exist');
      expect(host.applyTheme).not.toHaveBeenCalled();
      expect(host.state.appState.theme).toBe('auto');
    });
  });

  it('imports external themes without applying them immediately', async () => {
    await withTempHome(async () => {
      const source = join(process.env['SUPERLIORA_HOME']!, 'solar.yaml');
      await writeFile(source, `
scheme: "Solar"
base00: "002b36"
base05: "839496"
base08: "dc322f"
base0A: "b58900"
base0B: "859900"
base0C: "2aa198"
base0D: "268bd2"
base0E: "6c71c4"
`, 'utf-8');
      const host = makeThemeHost();

      await handleThemeCommand(host, `import ${source}`);

      expect(host.applyTheme).not.toHaveBeenCalled();
      expect(host.showStatus).toHaveBeenCalledWith('Imported theme "solar" from file.', 'success');
      const imported = JSON.parse(
        await readFile(join(process.env['SUPERLIORA_HOME']!, 'themes', 'solar.json'), 'utf-8'),
      ) as { readonly schemaVersion?: number };
      expect(imported.schemaVersion).toBe(2);
    });
  });
});

describe('handleAppearanceCommand', () => {
  it('persists appearance preferences and updates live state', async () => {
    await withTempHome(async () => {
      const host = makeThemeHost();

      await handleAppearanceCommand(host, 'profile subtle');

      expect(host.state.appState.appearance.profile).toBe('subtle');
      expect((await loadTuiConfig()).appearance?.profile).toBe('subtle');
      expect(host.track).toHaveBeenCalledWith('appearance_changed', {
        key: 'profile',
        value: 'subtle',
      });
      expect(host.showStatus).toHaveBeenCalledWith(
        'Appearance profile set to subtle.',
        'success',
      );
    });
  });
});

describe('handleThinkingCommand', () => {
  it('shows the current thinking state when called without args', async () => {
    const { host, session } = makeThinkingHost({ supportEfforts: ['low', 'high', 'max'] });

    await handleThinkingCommand(host, '');

    expect(session.setThinking).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalledWith(
      'Thinking is off. Default effort: high. Supported: low, high, max. Use /thinking <level>.',
    );
  });

  it('sets an explicit thinking effort for the active session', async () => {
    const { host, session } = makeThinkingHost({ supportEfforts: ['low', 'high', 'max'] });

    await handleThinkingCommand(host, 'max');

    expect(session.setThinking).toHaveBeenCalledWith('max');
    expect(host.setAppState).toHaveBeenCalledWith({ thinking: true });
    expect(host.track).toHaveBeenCalledWith('thinking_toggle', {
      enabled: true,
      level: 'max',
    });
    expect(host.showStatus).toHaveBeenCalledWith('Thinking set to max.', 'success');
  });

  it('dispatches /thinking through the slash command path', async () => {
    const { host, session } = makeThinkingHost({ supportEfforts: ['low', 'high'] });

    dispatchInput(host, '/thinking high');

    await vi.waitFor(() => {
      expect(session.setThinking).toHaveBeenCalledWith('high');
    });
  });

  it('turns thinking off without requiring effort metadata', async () => {
    const { host, session } = makeThinkingHost({ capabilities: ['tool_use'] });

    await handleThinkingCommand(host, 'off');

    expect(session.setThinking).toHaveBeenCalledWith('off');
    expect(host.setAppState).toHaveBeenCalledWith({ thinking: false });
    expect(host.showError).not.toHaveBeenCalled();
  });

  it('rejects unsupported efforts declared by the active model', async () => {
    const { host, session } = makeThinkingHost({ supportEfforts: ['low', 'high'] });

    await handleThinkingCommand(host, 'max');

    expect(session.setThinking).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith(
      'Current model supports thinking efforts: low, high.',
    );
  });

  it('rejects thinking on models that declare no thinking support', async () => {
    const { host, session } = makeThinkingHost({ capabilities: ['tool_use'] });

    await handleThinkingCommand(host, 'high');

    expect(session.setThinking).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith('Current model does not support thinking.');
  });
});
