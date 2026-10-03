import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { handleModelCommand, showModelPicker, showModelSettingsReset } from '#/tui/commands/config/model/model';
import { handleCompactCommand } from '#/tui/commands/session/compact';
import { applyExecutionStepLimit } from '#/tui/commands/config/limits';
import { openSettingsPane } from '#/tui/commands/config/settings';
import { handleAppearanceCommand, commitAppearanceChange } from '#/tui/commands/config/appearance/appearance';


import { handleThemeCommand } from '#/tui/commands/config/appearance/editor-theme';
import { handleThinkingCommand } from '#/tui/commands/config/thinking/thinking';

import { dispatchInput, type SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { DEFAULT_APPEARANCE_PREFERENCES, loadTuiConfig } from '#/tui/config';


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
      centerModalStack: [],
      appState,
    },
    applyTheme: vi.fn(async (theme: string) => {
      appState.theme = theme;
    }),
    refreshTerminalThemeTracking: vi.fn(),
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(appState, patch)),
    harness: {
      setConfig: vi.fn(async () => ({})),
      getConfig: vi.fn(async () => ({ defaultModel: 'k2', defaultThinking: false })),
    },
    showError: vi.fn(),
    showNotice: vi.fn(),
    showStatus: vi.fn(),
    setTranscriptDetail: vi.fn(),
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
      centerModalStack: [],
      appState,
    },
    setAppState: vi.fn((patch: Record<string, unknown>) => Object.assign(appState, patch)),
    harness: {
      setConfig: vi.fn(async () => ({})),
      getConfig: vi.fn(async () => ({ defaultModel: 'k2', defaultThinking: false })),
    },
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
      expect((await loadTuiConfig()).theme).toBe('superliora-neon-noir');
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

  it('persists from the committed baseline after a live highlight preview', async () => {
    await withTempHome(async () => {
      const host = makeThemeHost();
      const committed = { ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'premium' as const };
      host.setAppState({ appearance: { ...committed, profile: 'off' } });

      await commitAppearanceChange(host, committed, 'profile', 'off');

      expect((await loadTuiConfig()).appearance?.profile).toBe('off');
      expect(host.track).toHaveBeenCalledWith('appearance_changed', {
        key: 'profile',
        value: 'off',
      });
    });
  });

  it('sets transcript detail, persists it, and applies it live', async () => {
    await withTempHome(async () => {
      const host = makeThemeHost();
      await handleAppearanceCommand(host, 'transcript-detail full');
      expect(host.state.appState.appearance.transcriptDetail).toBe('full');
      expect((await loadTuiConfig()).appearance?.transcriptDetail).toBe('full');
      expect(host.setTranscriptDetail).toHaveBeenCalledWith('full');
    });
  });

  it('rejects unknown transcript detail values', async () => {
    const host = makeThemeHost();
    await handleAppearanceCommand(host, 'transcript-detail dense');
    expect(host.showError).toHaveBeenCalled();
    expect(host.setTranscriptDetail).not.toHaveBeenCalled();
  });

  it('toggles timestamps off and persists the preference', async () => {
    await withTempHome(async () => {
      const host = makeThemeHost();
      expect(host.state.appState.appearance.showTimestamps).toBe(true);

      await handleAppearanceCommand(host, 'timestamps off');

      expect(host.state.appState.appearance.showTimestamps).toBe(false);
      expect((await loadTuiConfig()).appearance?.showTimestamps).toBe(false);
      expect(host.track).toHaveBeenCalledWith('appearance_changed', {
        key: 'timestamps',
        value: 'off',
      });
      expect(host.showStatus).toHaveBeenCalledWith(
        'Appearance timestamps set to off.',
        'success',
      );
    });
  });

  it('rejects an unknown timestamps value without persisting', async () => {
    await withTempHome(async () => {
      const host = makeThemeHost();

      await handleAppearanceCommand(host, 'timestamps maybe');

      expect(host.state.appState.appearance.showTimestamps).toBe(true);
      expect(host.showError).toHaveBeenCalledWith(
        'Unknown appearance option or value: timestamps maybe',
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
    expect(host.setAppState).toHaveBeenCalledWith({ thinking: true, thinkingLevel: 'max' });
    expect(host.track).toHaveBeenCalledWith('thinking_toggle', {
      enabled: true,
      level: 'max',
    });
    expect(host.harness.setConfig).toHaveBeenCalledWith({
      defaultThinking: true,
      thinking: { mode: 'on', effort: 'max' },
    });
    // supportEfforts include max; Kimi wire maps max→high so status notes the wire.
    expect(host.showStatus).toHaveBeenCalledWith(
      'Thinking set to max (wire high).',
      'success',
    );
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
    expect(host.setAppState).toHaveBeenCalledWith({ thinking: false, thinkingLevel: 'off' });
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



describe('manual compact', () => {
  it('compacts the active session with an optional instruction', async () => {
    const compact = vi.fn(async (_options: { instruction?: string }) => {});
    const host = { session: { compact }, showError: vi.fn() } as unknown as SlashCommandHost;
    await handleCompactCommand(host, '  Preserve unfinished changes  ');
    await handleCompactCommand(host, '   ');
    expect(compact.mock.calls).toEqual([[{ instruction: 'Preserve unfinished changes' }], [{ instruction: undefined }]]);
  });

  it('reports no session without starting compaction', async () => {
    const host = { session: undefined, showError: vi.fn() } as unknown as SlashCommandHost;
    await handleCompactCommand(host, '');
    expect(host.showError).toHaveBeenCalledWith(expect.stringMatching(/session/i));
  });

  it('propagates compaction failures to command dispatch', async () => {
    const host = { session: { compact: vi.fn(async () => { throw new Error('compact failed'); }) } } as unknown as SlashCommandHost;
    await expect(handleCompactCommand(host, '')).rejects.toThrow('compact failed');
  });
});

describe('user hard execution limit', () => {
  function makeLimitHost() {
    const host = {
      harness: {
        getConfig: vi.fn(async () => ({ loopControl: { maxStepsPerTurn: 12 } })),
        setConfig: vi.fn(async () => {}),
      },
      session: { reloadSession: vi.fn(async () => {}) },
      state: { centerModalStack: [] },
      mountCenterModal: vi.fn((_component: unknown) => {}),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
      showError: vi.fn(),
    };
    return host as unknown as SlashCommandHost & typeof host;
  }

  it('persists the explicit hard step limit and reloads the live session', async () => {
    const host = makeLimitHost();
    await applyExecutionStepLimit(host, ' 40 ');
    expect(host.harness.setConfig).toHaveBeenCalledExactlyOnceWith({ loopControl: { maxStepsPerTurn: 40 } });
    expect(host.session.reloadSession).toHaveBeenCalledOnce();
    expect(host.showStatus).toHaveBeenCalledWith('Maximum steps per turn: 40', 'success');
  });

  it('supports unlimited execution without requiring a session', async () => {
    const host = makeLimitHost();
    const sessionless = { ...host, session: undefined } as unknown as SlashCommandHost;
    await applyExecutionStepLimit(sessionless, '0');
    expect(host.harness.setConfig).toHaveBeenCalledWith({ loopControl: { maxStepsPerTurn: 0 } });
    expect(host.showStatus).toHaveBeenCalledWith('Maximum steps per turn: unlimited', 'success');
  });

  it.each(['', '-1', '1.5', 'Infinity', '9007199254740992'])('rejects an invalid hard limit %j without saving', async (value) => {
    const host = makeLimitHost();
    await applyExecutionStepLimit(host, value);
    expect(host.harness.setConfig).not.toHaveBeenCalled();
    expect(host.session.reloadSession).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalled();
  });

  it('surfaces persistence failure without claiming the limit changed', async () => {
    const host = makeLimitHost();
    host.harness.setConfig.mockRejectedValueOnce(new Error('write denied'));
    await applyExecutionStepLimit(host, '40');
    expect(host.showError).toHaveBeenCalledWith('write denied');
    expect(host.session.reloadSession).not.toHaveBeenCalled();
    expect(host.showStatus).not.toHaveBeenCalled();
  });

  it('routes the settings pane to a real hard-limit input', async () => {
    const host = makeLimitHost();
    openSettingsPane(host, 'limits');
    await vi.waitFor(() => expect(host.mountCenterModal).toHaveBeenCalled());
    const picker = host.mountCenterModal.mock.calls[0]![0] as { opts: { onSelect: (value: string) => void } };
    picker.opts.onSelect('steps');
    const input = host.mountCenterModal.mock.calls[1]![0] as { opts: { onDone: (result: { kind: 'ok'; value: string }) => void } };
    input.opts.onDone({ kind: 'ok', value: '6' });
    await vi.waitFor(() => expect(host.harness.setConfig).toHaveBeenCalledWith({ loopControl: { maxStepsPerTurn: 6 } }));
  });
});

describe('model settings reset', () => {
  it('clears model choices and fallback chains after explicit confirmation', async () => {
    const host = {
      state: { centerModalStack: [] },
      mountCenterModal: vi.fn((_component: unknown) => {}),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
      showError: vi.fn(),
      harness: {
        getConfig: vi.fn(async () => ({ models: { primary: { fallbackModels: ['backup'] } } })),
        setConfig: vi.fn(async () => {}),
        deleteConfigFields: vi.fn(async () => {}),
      },
    };
    showModelSettingsReset(host as unknown as SlashCommandHost);
    const picker = host.mountCenterModal.mock.calls[0]![0] as { opts: { onSelect: (value: string) => void } };
    expect(host.harness.deleteConfigFields).not.toHaveBeenCalled();
    picker.opts.onSelect('reset');
    await vi.waitFor(() => expect(host.harness.deleteConfigFields).toHaveBeenCalled());
    expect(host.harness.setConfig).toHaveBeenCalledWith({ models: { primary: { fallbackModels: [] } } });
    expect(host.harness.deleteConfigFields).toHaveBeenCalledWith([
      'defaultProvider', 'defaultModel', 'defaultThinking', 'thinking.mode', 'thinking.effort',
    ]);
  });
});

describe('native model choices', () => {
  function modelHost(includeNativeAuto: boolean) {
    const primary = { provider: 'native', model: 'real-model', maxContextSize: 128000, capabilities: ['tool_use'] };
    const models = includeNativeAuto ? { primary, auto: { ...primary, model: 'auto', maxContextSize: 256000 } } : { primary };
    const host = {
      state: { centerModalStack: [], appState: { availableModels: models, model: 'primary', thinking: false } },
      authFlow: { refreshOAuthProviderModels: vi.fn(async () => ({ failed: [] })) },
      mountCenterModal: vi.fn((_component: unknown) => {}),
      showNotice: vi.fn(),
      showStatus: vi.fn(),
      showError: vi.fn(),
    };
    return host as unknown as SlashCommandHost & typeof host;
  }

  it('passes configured aliases and their actual context windows to the picker without synthetic rows', () => {
    const host = modelHost(false);
    showModelPicker(host);
    const picker = host.mountCenterModal.mock.calls[0]![0] as { opts: { models: typeof host.state.appState.availableModels } };
    expect(picker.opts.models).toBe(host.state.appState.availableModels);
    expect(Object.keys(picker.opts.models)).toEqual(['primary']);
    expect(picker.opts.models.primary?.maxContextSize).toBe(128000);
  });

  it('rejects auto when no native configured alias exists', async () => {
    const host = modelHost(false);
    await handleModelCommand(host, 'auto');
    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('auto'));
    expect(host.mountCenterModal).not.toHaveBeenCalled();
  });

  it('allows an explicitly configured native auto alias with its real context window', async () => {
    const host = modelHost(true);
    await handleModelCommand(host, 'auto');
    const picker = host.mountCenterModal.mock.calls[0]![0] as { opts: { models: typeof host.state.appState.availableModels; selectedValue: string } };
    expect(picker.opts.selectedValue).toBe('auto');
    expect(picker.opts.models.auto?.maxContextSize).toBe(256000);
    expect(host.showError).not.toHaveBeenCalled();
  });
});
