import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { applyLoopModelRoutingChoice, resetLoopModelRoutingChoice, showLoopModelRoutingPicker } from '#/tui/commands/config/model/model';
import { handleAppearanceCommand } from '#/tui/commands/config/appearance/appearance';
import { handleContextCommand } from '#/tui/commands/config/context/context';
import { handlePlanCommand } from '#/tui/commands/config/plan/plan';
import { handleThemeCommand } from '#/tui/commands/config/appearance/editor-theme';
import { handleThinkingCommand } from '#/tui/commands/config/thinking/thinking';
import { showHarnessPanel, showSettingsSelector } from '#/tui/commands/config/settings';
import { showSecuritySettings } from '#/tui/commands/config/security/security-settings';
import { showCompactionSettings } from '#/tui/commands/config/context/compaction-settings';
import { showMissionSettings } from '#/tui/commands/config/mission/mission-settings';
import { showFleetSettings } from '#/tui/commands/config/fleet/fleet-settings';
import { showHooksSettings } from '#/tui/commands/config/hooks/hooks-settings';
import { showNetworkSettings } from '#/tui/commands/config/network/network-settings';
import { showBenchDiagnosticsSettings } from '#/tui/commands/config/diagnostics/bench-diagnostics-settings';
import { showHarnessEyesReadiness } from '#/tui/commands/config/eyes/eyes-settings';
import { showToolsInventory } from '#/tui/commands/config/harness/harness-tools';
import { SETTINGS_OPTIONS } from '#/tui/components/dialogs/picker/settings-selector';

function settingsOptionIndex(value: string): number {
  const index = SETTINGS_OPTIONS.findIndex((option) => option.value === value);
  if (index < 0) throw new Error(`missing settings option: ${value}`);
  return index;
}
import { LOOP_MODEL_ROUTING_ROLES } from '#/tui/utils/model/loop-model-routing';
import { dispatchInput, type SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { DEFAULT_APPEARANCE_PREFERENCES, loadTuiConfig } from '#/tui/config';
import {
  BALANCED_ASYNC_WORKING_SET_TOKENS,
  BALANCED_MAX_WORKING_SET_TOKENS,
  ECONOMY_ASYNC_WORKING_SET_TOKENS,
  ECONOMY_MAX_WORKING_SET_TOKENS,
} from '#/tui/utils/agent/context-working-set';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

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
      centerModalStack: [],
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
      centerModalStack: [],
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
      centerModalStack: [],
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
    expect(host.showNotice).toHaveBeenCalledWith('Plan mode: ON (structured pipeline)', undefined);
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

  it('sets transcript detail, persists it, and applies it live', async () => {
    await withTempHome(async () => {
      const host = makeThemeHost();
      await handleAppearanceCommand(host, 'transcript-detail compact');
      expect(host.state.appState.appearance.transcriptDetail).toBe('compact');
      expect((await loadTuiConfig()).appearance?.transcriptDetail).toBe('compact');
      expect(host.setTranscriptDetail).toHaveBeenCalledWith('compact');
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

describe('context working-set command', () => {
  function makeContextHost() {
    const setConfig = vi.fn(async () => ({}));
    const getConfig = vi.fn(async () => ({
      loopControl: {
        maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
        asyncWorkingSetTokens: BALANCED_ASYNC_WORKING_SET_TOKENS,
      },
    }));
    const host = {
      harness: { getConfig, setConfig },
      state: {
        centerModalStack: [],
        appState: {
          model: 'big-model',
          availableModels: {
            'big-model': { maxContextSize: 1_000_000 },
          },
        },
      },
      mountEditorReplacement: vi.fn(),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      setAppState: vi.fn(),
      showError: vi.fn(),
      showStatus: vi.fn(),
      track: vi.fn(),
    };
    return host as unknown as SlashCommandHost & typeof host;
  }

  it('applies the economy preset through setConfig', async () => {
    const host = makeContextHost();
    await handleContextCommand(host, 'economy');
    expect(host.harness.setConfig).toHaveBeenCalledWith({
      loopControl: {
        maxWorkingSetTokens: ECONOMY_MAX_WORKING_SET_TOKENS,
        asyncWorkingSetTokens: ECONOMY_ASYNC_WORKING_SET_TOKENS,
      },
    });
    expect(host.setAppState).toHaveBeenCalledWith({
      workingSet: {
        maxWorkingSetTokens: ECONOMY_MAX_WORKING_SET_TOKENS,
        asyncWorkingSetTokens: ECONOMY_ASYNC_WORKING_SET_TOKENS,
        presetId: 'economy',
      },
    });
    expect(host.showStatus).toHaveBeenCalled();
    expect(host.track).toHaveBeenCalledWith('context_working_set_changed', {
      preset: 'economy',
    });
  });

  it('shows status without mutating config', async () => {
    const host = makeContextHost();
    await handleContextCommand(host, 'status');
    expect(host.harness.setConfig).not.toHaveBeenCalled();
    expect(host.showStatus).toHaveBeenCalled();
    const status = String(host.showStatus.mock.calls[0]?.[0] ?? '');
    expect(status).toContain('balanced');
  });

  it('rejects unknown preset names', async () => {
    const host = makeContextHost();
    await handleContextCommand(host, 'turbo');
    expect(host.harness.setConfig).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalled();
  });

  it('opens the picker when args are empty', async () => {
    const host = makeContextHost();
    await handleContextCommand(host, '');
    expect(host.mountCenterModal).toHaveBeenCalledOnce();
  });
});

describe('harness panel and tools inventory', () => {
  function makeHarnessHost(options: {
    session?: Record<string, unknown> | undefined;
    activeSession?: Record<string, unknown> | undefined;
    premiumQualityMode?: boolean;
  } = {}) {
    const transcriptContainer = {
      addChild: vi.fn(),
      isBatchMounting: false,
    };
    const session =
      options.session === undefined
        ? undefined
        : {
            listMcpServers: vi.fn(async () => []),
            setPremiumQuality: vi.fn(async () => undefined),
            ...options.session,
          };
    return {
      session,
      activeSession: options.activeSession ?? session,
      requireSession: vi.fn(() => {
        if (session === undefined) throw new Error('no session');
        return session;
      }),
      motionBeats: { play: vi.fn() },
      state: {
        centerModalStack: [],
        appState: {
          premiumQualityMode: options.premiumQualityMode === true,
          model: 'big-model',
          availableModels: {
            'big-model': {
              provider: 'managed:kimi-api',
              model: 'big-model',
              maxContextSize: 1_000_000,
            },
          },
        },
        transcriptContainer,
        renderer: { invalidateFrame: vi.fn() },
      },
      setAppState: vi.fn(),
      harness: {
        getExperimentalFeatures: vi.fn(async () => []),
        getConfig: vi.fn(async () => ({
          loopControl: {
            maxWorkingSetTokens: 48_000,
            asyncWorkingSetTokens: 16_000,
          },
        })),
        setConfig: vi.fn(async () => undefined),
        deleteConfigFields: vi.fn(async () => ({ loopControl: {} })),
      },
      mountEditorReplacement: vi.fn(),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showError: vi.fn(),
      showNotice: vi.fn(),
      showStatus: vi.fn(),
      showExtensionsModal: vi.fn(),
      showExperimentsModal: vi.fn(),
      track: vi.fn(),
    } as unknown as SlashCommandHost & {
      mountEditorReplacement: ReturnType<typeof vi.fn>;
      mountCenterModal: ReturnType<typeof vi.fn>;
      closeCenterModal: ReturnType<typeof vi.fn>;
      restoreEditor: ReturnType<typeof vi.fn>;
      showError: ReturnType<typeof vi.fn>;
      showNotice: ReturnType<typeof vi.fn>;
      showStatus: ReturnType<typeof vi.fn>;
      setAppState: ReturnType<typeof vi.fn>;
      requireSession: ReturnType<typeof vi.fn>;
      motionBeats: { play: ReturnType<typeof vi.fn> };
      harness: {
        getExperimentalFeatures: ReturnType<typeof vi.fn>;
        getConfig: ReturnType<typeof vi.fn>;
        setConfig: ReturnType<typeof vi.fn>;
        deleteConfigFields: ReturnType<typeof vi.fn>;
      };
      state: {
        centerModalStack: [],
        appState: {
          premiumQualityMode?: boolean;
          model: string;
          availableModels: Record<string, { maxContextSize: number }>;
        };
        transcriptContainer: {
          addChild: ReturnType<typeof vi.fn>;
          isBatchMounting: boolean;
        };
        renderer: { invalidateFrame: ReturnType<typeof vi.fn> };
      };
    };
  }

  async function selectHarnessOption(
    host: { mountCenterModal: ReturnType<typeof vi.fn> },
    optionIndex: number,
  ): Promise<void> {
    showHarnessPanel(host as unknown as SlashCommandHost);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    for (let i = 0; i < optionIndex; i++) {
      component.handleInput('\u001B[B');
    }
    component.handleInput('\r');
    await Promise.resolve();
    await Promise.resolve();
  }

  it('opens the harness panel modal with live observation actions', () => {
    const host = makeHarnessHost();
    showHarnessPanel(host);
    expect(host.mountCenterModal).toHaveBeenCalledOnce();
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void; render: (width: number) => string[] },
    ];
    expect(component).toBeTruthy();
    const body = component.render(80).join('\n');
    expect(body).toContain('Tools inventory');
    expect(body).toContain('Eyes readiness');
    expect(body).toContain('Visual Quality');
    expect(body).not.toContain('MCP servers');
    expect(body).not.toContain('Extensions');
    expect(body).toContain('Experiments');
    expect(body).toContain('Context working set');
  });

  it('routes harness panel tools selection to live tools inventory', async () => {
    const getTools = vi.fn(async () => [
      { name: 'Read', description: 'Read a file', source: 'builtin', active: true },
    ]);
    const host = makeHarnessHost({ session: { getTools } });
    showHarnessPanel(host);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    // First option is tools; Enter selects it.
    component.handleInput('\r');
    // showToolsInventory is async
    await Promise.resolve();
    await Promise.resolve();
    expect(host.restoreEditor).toHaveBeenCalled();
    expect(getTools).toHaveBeenCalledOnce();
    expect(host.showNotice).toHaveBeenCalledOnce();
    expect(String((host.showNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '')).toContain('Tools:');
  });

  it('routes harness panel eyes selection to eyes readiness panel', async () => {
    const host = makeHarnessHost();
    showHarnessPanel(host);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    // Move to eyes (second option) then Enter.
    component.handleInput('\u001B[B');
    component.handleInput('\r');
    expect(host.restoreEditor).toHaveBeenCalled();
    const eyesPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { opts: { onSelect: (value: string) => void; title?: string } }
      | undefined;
    expect(eyesPicker?.opts.title).toBe('Eyes readiness');
    eyesPicker!.opts.onSelect('status');
    await vi.waitFor(
      () => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
  });

  it('reports missing session for tools inventory', async () => {
    const host = makeHarnessHost({ session: undefined, activeSession: undefined });
    await showToolsInventory(host);
    expect(host.showError).toHaveBeenCalledWith(expect.stringMatching(/session/i));
  });

  it('reports when getTools is unavailable on the session', async () => {
    const host = makeHarnessHost({ session: {} });
    await showToolsInventory(host);
    expect(host.showError).toHaveBeenCalledWith('Tools inventory is not available on this session.');
  });

  it('lists active and inactive tools from live getTools()', async () => {
    const getTools = vi.fn(async () => [
      {
        name: 'Write',
        description: 'Write a file',
        source: 'builtin',
        active: true,
        helpVisibility: 'primary',
      },
      {
        name: 'Read',
        description: 'Read a file',
        source: 'builtin',
        active: true,
        helpVisibility: 'primary',
      },
      {
        name: 'Review',
        description: 'Review diff',
        source: 'builtin',
        active: true,
        helpVisibility: 'primary',
      },
      {
        name: 'LioraReview',
        description: 'Legacy review',
        source: 'builtin',
        active: true,
        helpVisibility: 'advanced',
      },
      {
        name: 'LegacyTool',
        description: 'old',
        source: 'plugin',
        active: false,
        helpVisibility: 'primary',
      },
    ]);
    const host = makeHarnessHost({ session: { getTools } });
    await showToolsInventory(host);
    expect(getTools).toHaveBeenCalledOnce();
    expect(host.showNotice).toHaveBeenCalledOnce();
    const notice = String((host.showNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
    expect(notice).toContain('── Session (live) ──');
    expect(notice).toContain('Core waist: ON (default) · profile=core tools=12');
    expect(notice).toContain('Tools: 3 active / 5 registered');
    expect(notice).toContain('Hide legacy: ON (default)');
    expect(notice).toContain('Read');
    expect(notice).toContain('Write');
    expect(notice).toContain('Review');
    expect(notice).not.toContain('  LioraReview');
    expect(notice).toContain('Compat aliases hidden (1): LioraReview→Review');
    expect(notice).toContain('Inactive (1): LegacyTool');
    expect(notice).toContain('ApplyPatch+RepoQuery');
    expect(notice).toContain('DeepResearch via agent/full');
    expect(notice).not.toContain('SearchTools dumps');
  });

  it('appends SearchTools schema tip when SearchTools is registered', async () => {
    const host = makeHarnessHost({
      session: {
        getTools: vi.fn(async () => [
          {
            name: 'Read',
            description: 'Read a file',
            source: 'builtin',
            active: true,
            helpVisibility: 'primary',
          },
          {
            name: 'SearchTools',
            description: 'Search tool inventory',
            source: 'builtin',
            active: true,
            helpVisibility: 'primary',
          },
        ]),
      },
    });
    await showToolsInventory(host);
    const notice = String((host.showNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
    expect(notice).toContain('ApplyPatch+RepoQuery');
    expect(notice).toContain('SearchTools dumps tool schemas mid-turn');
  });

  it('shows hide-legacy live status when SUPERLIORA_SOVEREIGN=1', async () => {
    const prev = process.env['SUPERLIORA_SOVEREIGN'];
    process.env['SUPERLIORA_SOVEREIGN'] = '1';
    try {
      const host = makeHarnessHost({
        session: {
          getTools: vi.fn(async () => [
            {
              name: 'Read',
              description: 'Read a file',
              source: 'builtin',
              active: true,
              helpVisibility: 'primary',
            },
          ]),
        },
      });
      await showToolsInventory(host);
      const notice = String((host.showNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(notice).toContain('── Session (live) ──');
      expect(notice).toContain('Core waist: ON (SUPERLIORA_SOVEREIGN=1) · profile=core tools=12');
      expect(notice).toContain('Hide legacy: ON (SUPERLIORA_SOVEREIGN=1)');
      expect(notice).not.toContain('soft-hides legacy tool aliases');
    } finally {
      if (prev === undefined) delete process.env['SUPERLIORA_SOVEREIGN'];
      else process.env['SUPERLIORA_SOVEREIGN'] = prev;
    }
  });

  it('shows sovereign core live status when SUPERLIORA_SOVEREIGN_CORE=1', async () => {
    const prev = process.env['SUPERLIORA_SOVEREIGN_CORE'];
    process.env['SUPERLIORA_SOVEREIGN_CORE'] = '1';
    try {
      const host = makeHarnessHost({
        session: {
          getTools: vi.fn(async () => [
            {
              name: 'Read',
              description: 'Read a file',
              source: 'builtin',
              active: true,
              helpVisibility: 'primary',
            },
          ]),
        },
      });
      await showToolsInventory(host);
      const notice = String((host.showNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
      expect(notice).toContain('Core waist: ON (SUPERLIORA_SOVEREIGN_CORE=1) · profile=core tools=12');
    } finally {
      if (prev === undefined) delete process.env['SUPERLIORA_SOVEREIGN_CORE'];
      else process.env['SUPERLIORA_SOVEREIGN_CORE'] = prev;
    }
  });

  it('surfaces getTools failures without crashing', async () => {
    const host = makeHarnessHost({
      session: {
        getTools: vi.fn(async () => {
          throw new Error('rpc down');
        }),
      },
    });
    await showToolsInventory(host);
    expect(host.showError).toHaveBeenCalledWith('Failed to load tools: rpc down');
  });


  it('routes harness panel premium selection to Visual Quality settings panel', async () => {
    const host = makeHarnessHost({ session: {}, premiumQualityMode: true });
    // tools=0, eyes=1, premium=2
    await selectHarnessOption(host, 2);
    expect(host.restoreEditor).toHaveBeenCalled();
    const premiumPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { opts: { onSelect: (value: string) => void; title?: string } }
      | undefined;
    expect(premiumPicker?.opts.title).toBe('Visual Quality');
    premiumPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
  });

  it('routes harness panel experiments selection to experiments panel', async () => {
    const host = makeHarnessHost({ session: {} });
    // experiments=3 (tools, eyes, premium, experiments)
    await selectHarnessOption(host, 3);
    expect(host.restoreEditor).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(host.harness.getExperimentalFeatures).toHaveBeenCalled();
    });
  });

  it('routes harness panel context selection to context working-set picker', async () => {
    const host = makeHarnessHost({ session: {} });
    // context=4
    await selectHarnessOption(host, 4);
    expect(host.restoreEditor).toHaveBeenCalled();
    // picker remounts via mountEditorReplacement after restore
    await vi.waitFor(() => {
      expect(host.harness.getConfig).toHaveBeenCalled();
      expect((host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('routes /tools slash command to live tools inventory', async () => {
    const getTools = vi.fn(async () => [
      { name: 'Read', description: 'Read a file', source: 'builtin', active: true },
    ]);
    const host = makeHarnessHost({ session: { getTools } });
    dispatchInput(host, '/tools');
    await vi.waitFor(() => {
      expect(getTools).toHaveBeenCalledOnce();
    });
    expect(host.showNotice).toHaveBeenCalled();
    expect(String((host.showNotice as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '')).toContain('Tools:');
  });

  it('routes /eyes slash command to eyes readiness panel', async () => {
    const host = makeHarnessHost();
    dispatchInput(host, '/eyes');
    await vi.waitFor(
      () => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
  });

  it('routes /eye alias to eyes readiness panel', async () => {
    const host = makeHarnessHost();
    dispatchInput(host, '/eye');
    await vi.waitFor(
      () => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
  });


  it('lists model routing and Eyes readiness in the settings selector', () => {
    const host = makeHarnessHost();
    showSettingsSelector(host);
    expect(host.mountCenterModal).toHaveBeenCalledOnce();
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void; render: (width: number) => string[] },
    ];
    const firstPage = component.render(120).join('\n');
    expect(firstPage).toContain('Model routing');
    expect(firstPage).toContain('Security');

    let combined = firstPage;
    for (let page = 0; page < 4; page++) {
      component.handleInput('\u001B[C');
      combined += `\n${component.render(120).join('\n')}`;
    }
    expect(combined).toContain('Harness');
    expect(combined).toContain('Eyes readiness');
  });

  it('lists Security alongside Permission in the settings selector', () => {
    const host = makeHarnessHost();
    showSettingsSelector(host);
    expect(host.mountCenterModal).toHaveBeenCalledOnce();
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { render: (width: number) => string[] },
    ];
    const firstPage = component.render(120).join('\n');
    expect(firstPage).toContain('Security');
    expect(firstPage).toContain('Sandbox');
  });

  it('routes settings security selection to security panel', async () => {
    const host = makeHarnessHost({
      session: {
        getStatus: vi.fn(async () => ({ permission: 'auto' })),
        listMcpServers: vi.fn(async () => [
          { name: 'demo', transport: 'stdio', status: 'connected', toolCount: 2 },
        ]),
      },
    });
    Object.assign(host.state.appState, {
      permissionMode: 'auto',
      workDir: '/tmp/security-ws',
      additionalDirs: [],
    });
    showSettingsSelector(host);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    // security is index 4: model, routing, fallback, permission, security
    for (let i = 0; i < 4; i++) {
      component.handleInput('\u001B[B');
    }
    component.handleInput('\r');
    expect(host.restoreEditor).toHaveBeenCalled();
    const securityPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(securityPicker).toBeDefined();
    securityPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
  });

  it('renders security panel without session', async () => {
    const host = makeHarnessHost({ session: undefined, activeSession: undefined });
    Object.assign(host.state.appState, {
      permissionMode: 'manual',
      workDir: '/tmp/no-session',
      additionalDirs: [],
    });
    showSecuritySettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | { opts: { onSelect: (action: string) => void } }
      | undefined;
    expect(picker).toBeDefined();
    picker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalledOnce();
    });
  });

  it('lists Mission, Fleet, and Compaction in the settings selector', () => {
    const host = makeHarnessHost();
    showSettingsSelector(host);
    expect(host.mountCenterModal).toHaveBeenCalledOnce();
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void; render: (width: number) => string[] },
    ];
    let combined = component.render(120).join('\n');
    for (let page = 0; page < 4; page++) {
      component.handleInput('\u001B[C');
      combined += `\n${component.render(120).join('\n')}`;
    }
    expect(combined).toContain('Compaction');
    expect(combined).toContain('/compact');
    expect(combined).toContain('Mission / Goals');
    expect(combined).toContain('/mission');
    expect(combined).toContain('Fleet / Parallel');
    expect(combined).toContain('/fleet');
  });

  it('routes settings compaction selection to compaction panel', async () => {
    const host = makeHarnessHost({ session: {} });
    showSettingsSelector(host);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    for (let i = 0; i < settingsOptionIndex('compaction'); i++) {
      component.handleInput('\u001B[B');
    }
    component.handleInput('\r');
    expect(host.restoreEditor).toHaveBeenCalled();
    const compactionPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(compactionPicker).toBeDefined();
    compactionPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('/compact');
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('compactionTriggerRatio');
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('Expand recover');
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('Expand(id=<archiveId>)');
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('context-archive store');
  });

  it('routes settings context selection to context tips panel', async () => {
    const host = makeHarnessHost({ session: {} });
    showSettingsSelector(host);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    for (let i = 0; i < settingsOptionIndex('context'); i++) {
      component.handleInput('\u001B[B');
    }
    component.handleInput('\r');
    expect(host.restoreEditor).toHaveBeenCalled();
    const contextPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(contextPicker).toBeDefined();
    contextPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('Instruction vs Learning');
    expect(lines).toContain('/context');
  });

  it('routes settings mission selection to mission panel', async () => {
    const host = makeHarnessHost({
      session: { getUltraworkRun: vi.fn(async () => null) },
    });
    showSettingsSelector(host);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    for (let i = 0; i < settingsOptionIndex('mission'); i++) {
      component.handleInput('\u001B[B');
    }
    component.handleInput('\r');
    expect(host.restoreEditor).toHaveBeenCalled();
    const missionPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(missionPicker).toBeDefined();
    missionPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('/mission');
    expect(lines).toContain('MISSION.md');
    expect(lines).toContain('soft advisory');
    expect(lines).toContain('RunProjectChecks');
  });

  it('routes settings fleet selection to fleet panel', async () => {
    const host = makeHarnessHost({
      session: {
        workDir: '/tmp/fleet-ws',
        getStatus: vi.fn(async () => ({ permission: 'auto' })),
        listBackgroundTasks: vi.fn(async () => []),
      },
    });
    host.harness.listSessions = vi.fn(async () =>
      [{ id: 'a' }, { id: 'b' }] as unknown as Awaited<ReturnType<typeof host.harness.listSessions>>,
    );
    showSettingsSelector(host);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    for (let i = 0; i < settingsOptionIndex('fleet'); i++) {
      component.handleInput('\u001B[B');
    }
    component.handleInput('\r');
    expect(host.restoreEditor).toHaveBeenCalled();
    const fleetPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(fleetPicker).toBeDefined();
    fleetPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    const lines = panel.snapshotBodyLines(1).join('\n');
    expect(lines).toContain('background.maxRunningTasks');
    expect(lines).toContain('Independent tool_calls in one turn run in parallel');
    expect(lines).toContain('Maker≠Checker');
    expect(lines).toContain('swarm-budget');
    expect(lines).toContain('/fleet');
    expect(lines).toContain('worktree');
    expect(lines).toContain('SUPERLIORA_FLEET_WORKTREE');
    expect(lines).toContain('SpawnWorker');
    expect(lines).toContain('Settings → Fleet → Max workers');
  });

  it('renders mission panel without session', async () => {
    const host = makeHarnessHost({ session: undefined, activeSession: undefined });
    showMissionSettings(host);
    const missionPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(missionPicker).toBeDefined();
    missionPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
  });

  it('renders fleet settings panel without session', async () => {
    const host = makeHarnessHost({ session: undefined, activeSession: undefined });
    showFleetSettings(host);
    const fleetPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(fleetPicker).toBeDefined();
    fleetPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
  });

  it('renders compaction settings panel without session', async () => {
    const host = makeHarnessHost({ session: undefined, activeSession: undefined });
    showCompactionSettings(host);
    const compactionPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(compactionPicker).toBeDefined();
    compactionPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
  });

  it('lists Hooks, Skills, Bench, Network, and Storage in the settings selector', () => {
    const host = makeHarnessHost();
    showSettingsSelector(host);
    expect(host.mountCenterModal).toHaveBeenCalledOnce();
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void; render: (width: number) => string[] },
    ];
    let combined = component.render(120).join('\n');
    for (let page = 0; page < 5; page++) {
      component.handleInput('\u001B[C');
      combined += `\n${component.render(120).join('\n')}`;
    }
    expect(combined).toContain('Hooks');
    expect(combined).toContain('Pre/Post/Stop');
    expect(combined).toContain('Skills');
    expect(combined).toContain('SearchSkill');
    expect(combined).toContain('Bench / Diagnostics');
    expect(combined).toContain('/ops');
    expect(combined).toContain('Network / Proxy');
    expect(combined).toContain('HTTPS_PROXY');
    expect(combined).toContain('Storage');
    expect(combined).toContain('~/.superliora');
  });

  it('routes settings hooks selection to hooks panel', async () => {
    const host = makeHarnessHost({
      session: {
        listPlugins: vi.fn(async () => [{ id: 'p', enabled: true, hookCount: 1 }]),
        getHookRegistry: vi.fn(async () => ({ totalCount: 1, events: { PreToolUse: 1 } })),
      },
    });
    showSettingsSelector(host);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    for (let i = 0; i < settingsOptionIndex('hooks'); i++) {
      component.handleInput('\u001B[B');
    }
    component.handleInput('\r');
    expect(host.restoreEditor).toHaveBeenCalled();
    const hooksPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(hooksPicker).toBeDefined();
    hooksPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('PreToolUse');
  });

  it('routes settings bench-diagnostics selection to bench panel', async () => {
    const host = makeHarnessHost({ session: {} });
    showSettingsSelector(host);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    for (let i = 0; i < settingsOptionIndex('bench-diagnostics'); i++) {
      component.handleInput('\u001B[B');
    }
    component.handleInput('\r');
    expect(host.restoreEditor).toHaveBeenCalled();
    const benchPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(benchPicker).toBeDefined();
    benchPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toMatch(/Bench \(SSOT\)|\/bench|Bench \/ Diagnostics/);
  });

  it('renders network settings panel with proxy env', () => {
    const prior = process.env['HTTPS_PROXY'];
    process.env['HTTPS_PROXY'] = 'http://127.0.0.1:3128';
    const host = makeHarnessHost();
    showNetworkSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | { opts: { onSelect: (action: string) => void } }
      | undefined;
    picker?.opts.onSelect('status');
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    expect(panel.snapshotBodyLines(1).join('\n')).toContain('127.0.0.1:3128');
    if (prior != null) process.env['HTTPS_PROXY'] = prior;
    else delete process.env['HTTPS_PROXY'];
  });

  it('renders bench diagnostics panel without session', () => {
    const host = makeHarnessHost({ session: undefined, activeSession: undefined });
    showBenchDiagnosticsSettings(host);
    const benchPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(benchPicker).toBeDefined();
    benchPicker!.opts.onSelect('status');
    expect(host.state.transcriptContainer.addChild).toHaveBeenCalledOnce();
  });

  it('renders hooks panel without session', async () => {
    const host = makeHarnessHost({ session: undefined, activeSession: undefined });
    showHooksSettings(host);
    const hooksPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | { opts: { onSelect: (value: string) => void } }
      | undefined;
    expect(hooksPicker).toBeDefined();
    hooksPicker!.opts.onSelect('status');
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
  });

  it('routes settings eyes selection to eyes readiness panel', async () => {
    const host = makeHarnessHost();
    showSettingsSelector(host);
    const [component] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    for (let i = 0; i < settingsOptionIndex('eyes'); i++) {
      component.handleInput('\u001B[B');
    }
    component.handleInput('\r');
    expect(host.restoreEditor).toHaveBeenCalled();
    const eyesPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | { opts: { onSelect: (value: string) => void; title?: string } }
      | undefined;
    expect(eyesPicker?.opts.title).toBe('Eyes readiness');
    eyesPicker!.opts.onSelect('status');
    await vi.waitFor(
      () => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      },
      { timeout: 5000 },
    );
  });

  it('surfaces eyes readiness load failures in panel without crashing', async () => {
    const host = makeHarnessHost();
    await showHarnessEyesReadiness(host);
    expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
  });

  it('routes a selected loop role model through setConfig and reloads the routing picker', async () => {
    const host = makeHarnessHost();
    await showLoopModelRoutingPicker(host);

    expect(host.harness.getConfig).toHaveBeenCalledWith({ reload: true });
    const [routingPicker] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void; render: (width: number) => string[] },
    ];
    const routingBody = routingPicker.render(120).join('\n');
    for (const label of ['Compaction', 'Completion', 'Exploration', 'Coding', 'Planning', 'Debugging']) {
      expect(routingBody).toContain(label);
    }
    expect(routingBody).toContain('default (no explicit override)');

    for (let i = 0; i < 3; i++) routingPicker.handleInput('\u001B[B');
    routingPicker.handleInput('\r');
    const [modelPicker] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[1] as [
      { handleInput: (data: string) => void },
    ];
    modelPicker.handleInput('\r');

    await vi.waitFor(() => {
      expect(host.harness.setConfig).toHaveBeenCalledWith({
        loopControl: { codingModel: 'big-model' },
      });
    });
    await vi.waitFor(() => {
      expect(host.harness.getConfig).toHaveBeenLastCalledWith({ reload: true });
      expect(host.showStatus).toHaveBeenCalledWith(
        expect.stringContaining('Coding routing override set to big-model'),
        'success',
      );
    });
  });

  it('does not mutate loop routing when the role model picker is cancelled', async () => {
    const host = makeHarnessHost();
    await showLoopModelRoutingPicker(host);
    const [routingPicker] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    routingPicker.handleInput('\r');
    const [modelPicker] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[1] as [
      { handleInput: (data: string) => void },
    ];
    modelPicker.handleInput('\u001B');

    expect(host.harness.setConfig).not.toHaveBeenCalled();
    expect(host.harness.deleteConfigFields).not.toHaveBeenCalled();
  });

  it('routes Alt+R from a configured role to deleteConfigFields', async () => {
    const host = makeHarnessHost();
    host.harness.getConfig.mockResolvedValue({ loopControl: { codingModel: 'code-pro' } });
    await showLoopModelRoutingPicker(host);
    const [routingPicker] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { handleInput: (data: string) => void },
    ];
    for (let i = 0; i < 3; i++) routingPicker.handleInput('\u001B[B');
    routingPicker.handleInput('\r');
    const [modelPicker] = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[1] as [
      { handleInput: (data: string) => void },
    ];
    modelPicker.handleInput('\u001Br');

    await vi.waitFor(() => {
      expect(host.harness.deleteConfigFields).toHaveBeenCalledWith(['loopControl.codingModel']);
    });
    expect(host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('Coding routing reset to default'),
      'success',
    );
  });

  it('surfaces loop routing save and reset errors without remounting a result', async () => {
    const host = makeHarnessHost();
    host.harness.setConfig.mockRejectedValueOnce(new Error('write denied'));
    await applyLoopModelRoutingChoice(host, LOOP_MODEL_ROUTING_ROLES[3], 'code-pro');
    expect(host.showError).toHaveBeenCalledWith('Failed to set Coding routing override: write denied');

    host.harness.deleteConfigFields.mockRejectedValueOnce(new Error('delete denied'));
    await resetLoopModelRoutingChoice(host, { ...LOOP_MODEL_ROUTING_ROLES[3], model: 'code-pro' });
    expect(host.showError).toHaveBeenCalledWith('Failed to reset Coding routing override: delete denied');
  });

});
