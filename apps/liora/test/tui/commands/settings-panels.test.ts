/** Combined settings-panel tests that share a vi.mock boundary (none). Nested describe per former file. */
import {
  describe,
  expect,
  it,
  vi,
  afterEach,
  beforeEach,
} from 'vitest';
import {
  APPEARANCE_BACKGROUND_TIP,
  APPEARANCE_CHANGE_TIP,
  APPEARANCE_MOTION_TIP,
  APPEARANCE_THEME_TIP,
  showAppearanceSettings,
  showTranscriptDetailPicker,
} from '#/tui/commands/config/appearance/appearance-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme, lightColors } from '#/tui/theme';
import { invalidatePromptCache, showCacheSettings } from '#/tui/commands/config/cache/cache-settings';
import { COMPACTION_KEEP_TOKENS_TIP, COMPACTION_THRESHOLD_TIP, showCompactionSettings } from '#/tui/commands/config/context/compaction-settings';
import {
  CONTEXT_INSTRUCTION_SOFT_TIP,
  CONTEXT_LEARNING_SOFT_TIP,
  CONTEXT_WORKING_SET_TIP,
  showContextSettings,
} from '#/tui/commands/config/context/context-settings';
import { EDITOR_EXTERNAL_TIP, showEditorSettings } from '#/tui/commands/config/editor/editor-settings';
import { showUpgradeSettings, UPGRADE_ENV_TIP } from '#/tui/commands/config/upgrade/upgrade-settings';
import {
  buildEditorSettingsLines,
  formatExternalEditorLine,
  formatInputModeLine,
  loadEditorGlance,
} from '#/tui/utils/editor/editor-glance';
import { buildUsageSettingsLines, loadUsageSettingsGlance } from '#/tui/utils/usage/usage-settings-glance';
import {
  AUTO_UPDATE_DISABLE_ENV,
  buildUpgradeSettingsLines,
  formatEffectiveAutoUpdateLine,
  isAutoUpdateDisabledByEnv,
  loadUpgradeGlance,
} from '#/tui/utils/upgrade/upgrade-glance';
import type { ExperimentalFeatureState } from '@superliora/sdk';
import { EXPERIMENTS_CODEGRAPH_TIP, EXPERIMENTS_FEATURE_FLAGS_TIP, showExperimentsSettings } from '#/tui/commands/config/experiments/experiments-settings';
import { buildExperimentsSettingsLines, formatExperimentsLiveLine, summarizeExperimentalFeatures } from '#/tui/utils/experiments/experiments-glance';
import {
  EXTENSIONS_AUDIT_TIP,
  EXTENSIONS_HOT_RELOAD_TIP,
  EXTENSIONS_MANAGE_TIP,
  showExtensionsSettings,
} from '#/tui/commands/config/extensions/extensions-settings';
import {
  HOOKS_ENABLE_TIP,
  HOOKS_POST_TOOL_USE_TIP,
  HOOKS_PRE_TOOL_USE_TIP,
  HOOKS_STOP_TIP,
  showHooksSettings,
} from '#/tui/commands/config/hooks/hooks-settings';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLioraHarness } from '@superliora/sdk';
import {
  HOST_FUTURE_TIP,
  HOST_SOVEREIGN_UMBRELLA_TIP,
  HOST_TTFT_TIP,
  showHostSettings,
} from '#/tui/commands/config/host/host-settings';
import {
  KEYBINDINGS_COMMAND_HUB_TIP,
  KEYBINDINGS_FUTURE_EDITOR_TIP,
  KEYBINDINGS_HELP_TIP,
  KEYBINDINGS_REGISTRY_TIP,
  showKeybindingsSettings,
} from '#/tui/commands/config/keybindings/keybindings-settings';
import {
  MCP_ALLOWLIST_TIP,
  MCP_CONFIG_SCOPES_TIP,
  MCP_OAUTH_TIP,
  showMcpSettings,
} from '#/tui/commands/config/mcp/mcp-settings';
import {
  MEDIA_ANALYZE_TIP,
  MEDIA_BLOCK_TIP,
  MEDIA_PATH_TIP,
  showMediaSettings,
} from '#/tui/commands/config/media/media-settings';
import {
  NETWORK_NO_PROXY_TIP,
  NETWORK_PROXY_TIP,
  NETWORK_SOCKS_TIP,
  showNetworkSettings,
} from '#/tui/commands/config/network/network-settings';
import {
  NEVER_HALT_BREAKER_TIP,
  NEVER_HALT_INTERVENTION_TIP,
  NEVER_HALT_OAUTH_TIP,
  NEVER_HALT_SEARCH_FALLBACK_TIP,
  showNeverHaltSettings,
} from '#/tui/commands/config/never-halt/never-halt-settings';
import { PERSONA_PRESET_TIP, showPersonaSettings } from '#/tui/commands/config/persona/persona-settings';
import { buildPersonaSettingsLines, formatActivePersonaLine } from '#/tui/utils/persona/persona-glance';
import {
  PREMIUM_DENSITY_TIP,
  PREMIUM_MOTION_TIP,
  PREMIUM_PQ_TIP,
  showPremiumSettings,
} from '#/tui/commands/config/premium/premium-settings';
import { setAppearanceRenderHealth, setAppearanceRenderQuality } from '#/tui/features/appearance/appearance-effects';
import type { RendererDiagnosticsSnapshot } from '#/tui/renderer';
import {
  PROVIDERS_API_KEY_ENVS_TIP,
  PROVIDERS_LOGIN_TIP,
  SEARCH_PREFER_XAI_TIP,
  showProvidersApiSettings,
} from '#/tui/commands/config/providers/providers-api-settings';
import { showSearchSettings } from '#/tui/commands/config/search/search-settings';
import {
  buildSearchBrowserEscalateConfigPatch,
  buildSearchPreferXaiConfigPatch,
  buildSearchSearxngUrlConfigPatch,
  buildSearchStrategyConfigPatch,
  formatSearchBrowserEscalateLine,
  formatSearchPreferXaiLine,
  formatSearchStrategyLine,
  isValidSearxngUrl,
  resolveSearchBrowserEscalate,
  resolveSearchPreferXai,
  resolveSearchStrategy,
} from '#/tui/commands/config/search/search-status';
import {
  SECURITY_MCP_ALLOWLIST_TIP,
  SECURITY_NOT_OS_SANDBOX,
  SECURITY_REDACTION_TIP,
  SECURITY_SANDBOX_TIP,
  showSecuritySettings,
} from '#/tui/commands/config/security/security-settings';
import { filterHubItems } from '#/tui/components/dialogs/command-hub/command-hub-filter';
import { buildDefaultCommandHubItems } from '#/tui/components/dialogs/command-hub/index';
import { commandHubNestsPicker } from '#/tui/components/dialogs/command-hub/command-hub-behavior';
import { commandHubActionToSlash } from '#/tui/utils/command/command-hub-actions';
import { buildSettingsJumpHubItems } from '#/tui/commands/config/settings-hub-jumps';
import { SETTINGS_SEARCH_KEYWORDS } from '#/tui/commands/config/settings-keywords';
import { SETTINGS_OPTIONS } from '#/tui/components/dialogs/picker/settings-selector';
import { showSettingsInventory } from '#/tui/commands/config/diagnostics/settings-inventory';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import {
  showStorageSettings,
  STORAGE_HOME_TIP,
  STORAGE_LOGS_TIP,
  STORAGE_RETENTION_TIP,
} from '#/tui/commands/config/storage/storage-settings';
import { resolveStoragePaths } from '#/tui/utils/storage/storage-glance';
import { showTelemetrySettings, TELEMETRY_LOCAL_ONLY_TIP, TELEMETRY_OPT_OUT_TIP } from '#/tui/commands/config/telemetry/telemetry-settings';
import {
  showUsageSettings,
  USAGE_CONTEXT_TIP,
  USAGE_QUOTA_TIP,
  USAGE_TOKEN_TIP,
} from '#/tui/commands/config/upgrade/usage-settings';

function expectPremiumPickerChrome(picker: ChoicePickerComponent): void {
  const lines = picker.render(120).map((line) => line.replaceAll(/\u001B\[[0-9;]*m/g, ''));
  const hint = lines.find((line) => line.includes('Esc cancel'));
  expect(hint).toMatch(/navigate/);
  expect(hint).toContain('Enter select');
  expect(hint).not.toMatch(/Enter · Esc$/);
}

describe('appearance-settings', () => {
  function makeHost(options: {
    theme?: string;
    appearance?: typeof DEFAULT_APPEARANCE_PREFERENCES;
  } = {}) {
    return {
      state: {
        appState: {
          theme: options.theme ?? 'auto',
          appearance: options.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
        },
        transcriptContainer: { addChild: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        renderer: { invalidateFrame: vi.fn() },
      },
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
      setAppState: vi.fn(),
      setTranscriptDetail: vi.fn(),
      setNeatMode: vi.fn(),
      track: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectAppearanceAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('appearance settings tips', () => {
    it('exports theme, motion, background, and change tips (glance copy, not menu rows)', () => {
      expect(APPEARANCE_THEME_TIP).toContain('Settings → Theme');
      expect(APPEARANCE_MOTION_TIP).toContain('/appearance');
      expect(APPEARANCE_BACKGROUND_TIP).toContain('transcript-detail');
      expect(APPEARANCE_CHANGE_TIP).toContain('Settings → Appearance');
    });
  });

  describe('showAppearanceSettings', () => {
    it('mounts ChoicePicker with live actions and tip rows — tip-free', () => {
      const host = makeHost();
      showAppearanceSettings(host);
      const options = (
        (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
          opts: { options: readonly { value: string }[] };
        }
      ).opts.options;
      expect(options.map((o) => o.value)).toEqual([
        'presets',
        'status',
        'performance',
        'theme',
        'profile',
        'density',
        'transcript-detail',
        'neat',
        'syntax-theme',
        'particles',
        'animation-fps',
        'timestamps',
        'canvas-background',
        'terminal-background',
        'terminal-palette',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('opens a transcript detail picker with current level marked', () => {
      const host = makeHost({
        appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, transcriptDetail: 'compact' },
      });
      showAppearanceSettings(host);
      selectAppearanceAction(host, 'transcript-detail');
      expect(host.mountCenterModal).toHaveBeenCalledTimes(2);
      const nested = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as {
        opts: {
          title: string;
          currentValue?: string;
          options: readonly { value: string }[];
        };
      };
      expect(nested.opts.title).toBe('Transcript detail');
      expect(nested.opts.currentValue).toBe('compact');
      expect(nested.opts.options.map((o) => o.value)).toEqual([
        'minimal',
        'compact',
        'standard',
        'full',
      ]);
    });

    it('uses PREMIUM list chrome instead of a stub ↑↓ · Enter · Esc hint', () => {
      const host = makeHost();
      showAppearanceSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      expectPremiumPickerChrome(picker!);
      const lines = picker!.render(120).map((line) => line.replaceAll(/\u001B\[[0-9;]*m/g, ''));
      expect(lines.join('\n')).toContain('Appearance status');
      expect(lines.join('\n')).toContain('Motion profile ·');
    });

    it('highlight-previews motion profile and restores on cancel', () => {
      const host = makeHost({
        appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, profile: 'premium' },
      });
      showAppearanceSettings(host);
      selectAppearanceAction(host, 'profile');
      const nested = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as {
        opts: {
          onHighlight?: (value: string) => void;
          onCancel: () => void;
          renderPreview?: (option: { value: string }, width: number) => readonly string[];
        };
      };
      expect(nested.opts.onHighlight).toBeTypeOf('function');
      nested.opts.onHighlight?.('off');
      expect(host.setAppState).toHaveBeenCalledWith({
        appearance: expect.objectContaining({ profile: 'off' }),
      });
      const preview = nested.opts.renderPreview?.({ value: 'off' }, 72) ?? [];
      expect(preview.join('\n')).toMatch(/Appearance/);
      nested.opts.onCancel();
      expect(host.setAppState).toHaveBeenCalledWith({
        appearance: expect.objectContaining({ profile: 'premium' }),
      });
    });

    it('does not OSC-preview terminal background on highlight', () => {
      const host = makeHost();
      showAppearanceSettings(host);
      selectAppearanceAction(host, 'terminal-background');
      const nested = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as {
        opts: { onHighlight?: (value: string) => void };
      };
      nested.opts.onHighlight?.('session');
      expect(host.setAppState).not.toHaveBeenCalled();
    });

    it('renders live theme from appState and currentTheme', () => {
      const previousPalette = currentTheme.palette;
      currentTheme.setPalette(lightColors);

      const host = makeHost({ theme: 'auto' });
      showAppearanceSettings(host);
      selectAppearanceAction(host, 'status');

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('Theme: auto · live palette light (tracking terminal)');
      expect(text).toContain('── Session (live) ─');

      currentTheme.setPalette(previousPalette);
    });
  });

  describe('showTranscriptDetailPicker', () => {
    it('mounts a four-level density picker', () => {
      const host = makeHost({
        appearance: { ...DEFAULT_APPEARANCE_PREFERENCES, transcriptDetail: 'full' },
      });
      showTranscriptDetailPicker(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        opts: { currentValue?: string; options: readonly { value: string }[] };
      };
      expect(picker.opts.currentValue).toBe('full');
      expect(picker.opts.options.map((o) => o.value)).toEqual([
        'minimal',
        'compact',
        'standard',
        'full',
      ]);
    });

    it('labels standard as the product default, not compact', () => {
      const host = makeHost();
      showTranscriptDetailPicker(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
        opts: {
          currentValue?: string;
          options: readonly { value: string; description?: string }[];
        };
      };
      expect(picker.opts.currentValue).toBe('standard');
      const byValue = Object.fromEntries(
        picker.opts.options.map((option) => [option.value, option.description ?? '']),
      );
      expect(byValue['standard']).toMatch(/default/i);
      expect(byValue['compact']).not.toMatch(/default/i);
      expect(byValue['standard']).toMatch(/preview cards/i);
    });
  });
});

describe('cache-settings', () => {
  function makeHost(options: {
    cacheMeter?: { rate: number; streak: number } | null;
    getStatus?: () => Promise<Record<string, unknown>>;
    getConfig?: () => Promise<Record<string, unknown>>;
    hasSession?: boolean;
  } = {}) {
    const session = {
      getStatus:
        options.getStatus ??
        vi.fn(async () => ({
          cacheHitRate: 0.995,
          cacheWarmStreak: 5,
          cacheFrozen: false,
          usage: { cacheDiagnostics: { toolBlockChanged: false } },
        })),
    };
    return {
      state: {
        appState: {
          cacheMeter: options.cacheMeter ?? null,
        },
        theme: currentTheme,
        transcriptContainer: { addChild: vi.fn() },
        ui: { requestRender: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
        centerModalStack: [] as readonly unknown[],
      },
      harness: {
        getConfig:
          options.getConfig ??
          vi.fn(async () => ({
            providers: {},
            cache: { invalidateEpoch: 0 },
          })),
        setConfig: vi.fn(async () => ({ providers: {}, cache: { invalidateEpoch: 1 } })),
      },
      requireSession:
        options.hasSession === false
          ? vi.fn(() => {
              throw new Error('no session');
            })
          : vi.fn(() => session),
      showStatus: vi.fn(),
      showError: vi.fn(),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  async function openCacheStatusPanel(host: SlashCommandHost): Promise<UsagePanelComponent> {
    showCacheSettings(host);
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (value: string) => void } }).opts.onSelect('status');
    await vi.waitFor(() => {
      expect((host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls.length)
        .toBeGreaterThan(0);
    });
    return (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      UsagePanelComponent;
  }

  describe('showCacheSettings picker chrome', () => {
    it('inherits PREMIUM list chrome instead of a stub ↑↓ · Enter · Esc hint', () => {
      const host = makeHost();
      showCacheSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      expectPremiumPickerChrome(picker!);
    });
  });

  describe('showCacheSettings status panel', () => {
    it('shows Session (live) section with hit rate and streak from getStatus', async () => {
      const host = makeHost();
      const panel = await openCacheStatusPanel(host);
      const text = panel.render(100).join('\n');
      expect(text).toContain('── Session (live) ──');
      expect(text).toContain('streak×5');
      expect(text).toContain('Status: warm');
      expect(text).toContain('Prefix: stable');
      expect(text).toContain('Cache miss dump export');
      expect(text).toContain('superliora.cache_miss.v1');
    });

    it('shows mid-turn freeze tip in Cache Sacred rules', async () => {
      const host = makeHost();
      const panel = await openCacheStatusPanel(host);
      const text = panel.render(100).join('\n');
      expect(text).toContain('Mid-turn: CacheFreezeGuard');
      expect(text).toContain('Freeze: idle');
      expect(text).toContain('Cache miss dump export');
    });

    it('shows active freeze line when getStatus reports mid-turn freeze', async () => {
      const host = makeHost({
        getStatus: vi.fn(async () => ({
          cacheHitRate: 0.995,
          cacheWarmStreak: 3,
          cacheFrozen: true,
          usage: { cacheDiagnostics: { toolBlockChanged: false } },
        })),
      });
      const panel = await openCacheStatusPanel(host);
      const text = panel.render(100).join('\n');
      expect(text).toContain('Freeze: active (mid-turn · step soft-check on)');
      expect(text).toContain('streak×3');
    });

    it('uses AppState cacheMeter when getStatus is unavailable', async () => {
      const host = makeHost({
        cacheMeter: { rate: 0.995, streak: 6 },
        hasSession: false,
      });
      const panel = await openCacheStatusPanel(host);
      const text = panel.render(100).join('\n');
      expect(text).toContain('streak×6');
      expect(text).toContain('Status: warm');
    });
  });

  describe('invalidatePromptCache', () => {
    it('bumps cache.invalidateEpoch via setConfig and shows status', async () => {
      const setConfig = vi.fn(async () => ({ providers: {}, cache: { invalidateEpoch: 1 } }));
      const getConfig = vi.fn(async () => ({ providers: {}, cache: { invalidateEpoch: 0 } }));
      const showStatus = vi.fn();
      const host = {
        harness: { getConfig, setConfig },
        showStatus,
        showError: vi.fn(),
      } as unknown as SlashCommandHost;

      await invalidatePromptCache(host);

      expect(setConfig).toHaveBeenCalledWith({ cache: { invalidateEpoch: 1 } });
      expect(showStatus).toHaveBeenCalledWith(expect.stringContaining('epoch v1'), 'warning');
    });
  });
});

describe('compaction-settings', () => {
  function makeHost(options: {
    getStatus?: () => Promise<Record<string, unknown>>;
    getContext?: () => Promise<Record<string, unknown>>;
    transcriptEntries?: Array<Record<string, unknown>>;
    hasSession?: boolean;
  } = {}) {
    const session = {
      getStatus:
        options.getStatus ??
        vi.fn(async () => ({
          contextUsage: 0.55,
          contextTokens: 140_000,
          maxContextTokens: 256_000,
        })),
      getContext:
        options.getContext ??
        vi.fn(async () => ({
          contextArchive: { entryCount: 4, maxEntries: 512 },
        })),
    };
    return {
      state: {
        appState: {},
        transcriptEntries: options.transcriptEntries ?? [],
        transcriptContainer: { addChild: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        renderer: { invalidateFrame: vi.fn() },
      },
      harness: {
        getConfig: vi.fn(async () => ({
          loopControl: {
            maxWorkingSetTokens: 256_000,
            asyncWorkingSetTokens: 128_000,
            compactionTriggerRatio: 0.7,
          },
        })),
      },
      requireSession:
        options.hasSession === false
          ? vi.fn(() => {
              throw new Error('no session');
            })
          : vi.fn(() => session),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      mountEditorReplacement: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectCompactionAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('showCompactionSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeHost();
      showCompactionSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'presets',
        'status',
        'run-compact',
        'working-set',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });


    it('falls back when session is unavailable', async () => {
      const host = makeHost({ hasSession: false });
      showCompactionSettings(host);
      selectCompactionAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('Context archive: (no session)');
    });
  });
});

describe('context-settings', () => {
  function selectPickerAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  function makeSettingsHost(
    options: {
      memoryStats?: {
        total: number;
        active: number;
        archived: number;
        deleted: number;
        byType: Record<string, number>;
        candidates: number;
        byScope: Record<string, number>;
      };
      workDir?: string;
    } = {},
  ) {
    const transcriptContainer = { addChild: vi.fn() };
    return {
      state: {
        transcriptContainer,
        transcriptEntries: [],
        centerModalStack: [] as readonly unknown[],
        appState: {
          model: '',
          availableModels: {},
          workDir: options.workDir,
        },
        renderer: { invalidateFrame: vi.fn() },
      },
      harness: {
        homeDir: '/tmp/.superliora-test',
        getConfig: vi.fn(async () => ({
          loopControl: {
            maxWorkingSetTokens: 256_000,
            asyncWorkingSetTokens: 128_000,
            compactionTriggerRatio: 0.7,
          },
        })),
        memory: {
          stats: vi.fn(async () =>
            options.memoryStats ?? {
              total: 2,
              active: 2,
              archived: 0,
              deleted: 0,
              byType: { fact: 2, event: 0, procedure: 0, task: 0, rule: 0 },
              byScope: { user: 2, workspace: 0, session: 0 },
              candidates: 0,
            },
          ),
        },
      },
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      mountEditorReplacement: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  describe('W9 compaction/context settings tips', () => {
    it('compaction panel mentions structured handoff and Expand recover', async () => {
      const host = makeSettingsHost();
      host.requireSession = vi.fn(() => ({
        getStatus: vi.fn(async () => ({
          contextUsage: 0.5,
          contextTokens: 100_000,
          maxContextTokens: 256_000,
        })),
        getContext: vi.fn(async () => ({ contextArchive: { entryCount: 1, maxEntries: 512 } })),
      })) as never;
      showCompactionSettings(host);
      selectPickerAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain('Structured handoff');
      expect(lines).toContain('Objective · Work state · Next move · Relevant files');
      expect(lines).toContain('Expand recover');
      expect(lines).toContain('Expand(id=<archiveId>)');
      expect(lines).toContain('archiveId=<12-hex>');
      expect(lines).toContain('context-archive store');
      expect(lines).toContain('[liora-archived id=');
      expect(lines).toContain('~/.superliora/tool-results/');
      expect(lines).toContain('Context archive: 1 entry');
      expect(lines).toContain('── Session (live) ──');
    });

    it('exports working-set, instruction, and learning tips (glance copy, not menu rows)', () => {
      expect(CONTEXT_WORKING_SET_TIP).toContain('soft cap');
      expect(CONTEXT_WORKING_SET_TIP).toContain('272k');
      expect(CONTEXT_WORKING_SET_TIP).toContain('256k');
      expect(CONTEXT_WORKING_SET_TIP).toContain('512k');
      expect(CONTEXT_INSTRUCTION_SOFT_TIP).toContain('AGENTS.md');
      expect(CONTEXT_LEARNING_SOFT_TIP).toContain('Memory');
      expect(CONTEXT_LEARNING_SOFT_TIP).toContain('.agents/skills/auto/');
    });
  });

  describe('showContextSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeSettingsHost();
      showContextSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
        'working-set',
        'compaction',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('context panel explains Instruction vs Learning memory with live wiring', async () => {
      const host = makeSettingsHost();
      showContextSettings(host);
      selectPickerAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain('Instruction vs Learning');
      expect(lines).toContain('Live');
      expect(lines).toContain('Instruction files:');
      expect(lines).toContain('Learning (Liora Memory): 2 active / 2 total');
      expect(lines).toContain('/memory remember');
      expect(lines).toContain('/context');
      expect(lines).toContain('.agents/skills/auto/');
      expect(host.harness.memory.stats).toHaveBeenCalled();
    });
  });
});

describe('editor-usage-upgrade-settings', () => {
  function selectPickerAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  function panelText(host: SlashCommandHost): string {
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
    return panel.render(100).join('\n');
  }

  describe('editor glance', () => {
    it('formats live input mode and resolved external editor', () => {
      expect(formatInputModeLine('bash')).toContain('bash');
      expect(formatInputModeLine('prompt')).toContain('prompt');

      const glance = loadEditorGlance({
        inputMode: 'prompt',
        editorCommand: 'vim',
        env: { VISUAL: 'nvim', EDITOR: 'nano' },
      });
      expect(formatExternalEditorLine(glance)).toContain('vim · resolved vim');
      expect(buildEditorSettingsLines(glance).join('\n')).toContain('VISUAL=nvim');
    });
  });

  describe('usage glance', () => {
    it('builds token and context lines from getStatus fields', () => {
      const glance = loadUsageSettingsGlance({
        status: {
          usage: {
            total: {
              inputOther: 10_000,
              inputCacheRead: 0,
              inputCacheCreation: 0,
              output: 500,
            },
          },
          cacheHitRate: 0.9,
          contextUsage: 0.42,
          contextTokens: 84_000,
          maxContextTokens: 200_000,
        },
        sessionCostUsd: 0.15,
      });
      const text = buildUsageSettingsLines(glance).join('\n');
      expect(text).toContain('Session: live getStatus');
      expect(glance.tokenLine).toContain('in 10.0K');
      expect(glance.tokenLine).toContain('$0.150');
      expect(text).toContain('Context usage: 42.0%');
    });
  });

  describe('upgrade glance', () => {
    it('respects env disable over tui.toml auto_install', () => {
      const glance = loadUpgradeGlance({
        autoInstall: true,
        version: '1.2.3',
        env: { [AUTO_UPDATE_DISABLE_ENV]: '1' },
        configPath: '/home/.superliora/tui.toml',
      });
      expect(isAutoUpdateDisabledByEnv({ [AUTO_UPDATE_DISABLE_ENV]: 'true' })).toBe(true);
      expect(formatEffectiveAutoUpdateLine(glance)).toContain('OFF — env disables');
      const text = buildUpgradeSettingsLines(glance).join('\n');
      expect(text).toContain('Running version: 1.2.3');
      expect(text).toContain('SUPERLIORA_NO_AUTO_UPDATE=1');
    });

    it('shows pending update notice when preflight wired one', () => {
      const glance = loadUpgradeGlance({
        autoInstall: false,
        version: '1.0.0',
        updateNotice: {
          currentVersion: '1.0.0',
          targetVersion: '1.1.0',
          installCommand: 'npm i -g @superliora/liora',
        },
      });
      expect(buildUpgradeSettingsLines(glance).join('\n')).toContain('1.0.0 → 1.1.0');
    });
  });

  describe('editor settings panel', () => {
    it('mounts ChoicePicker then live inputMode panel', () => {
      const host = {
        state: {
          appState: {
            inputMode: 'bash' as const,
            editorCommand: 'nvim',
          },
          transcriptContainer: { addChild: vi.fn() },
          renderer: { invalidateFrame: vi.fn() },
          centerModalStack: [] as readonly unknown[],
        },
        mountCenterModal: vi.fn(),
        closeCenterModal: vi.fn(),
        restoreEditor: vi.fn(),
        showStatus: vi.fn(),
      } as unknown as SlashCommandHost;

      showEditorSettings(host);
      selectPickerAction(host, 'status');
      const text = panelText(host);
      expect(text).toContain('TUI input: bash');
      expect(text).toContain('External editor: nvim · resolved nvim');
      expect(text).toContain('Ctrl+G');
    });

  });

  describe('upgrade settings panel', () => {
    it('mounts ChoicePicker then live auto-update panel', () => {
      const host = {
        state: {
          appState: {
            version: '2.0.0',
            upgrade: { autoInstall: true },
            updateNotice: null,
          },
          transcriptContainer: { addChild: vi.fn() },
          renderer: { invalidateFrame: vi.fn() },
          centerModalStack: [] as readonly unknown[],
        },
        mountCenterModal: vi.fn(),
        closeCenterModal: vi.fn(),
        restoreEditor: vi.fn(),
        showStatus: vi.fn(),
      } as unknown as SlashCommandHost;

      showUpgradeSettings(host);
      selectPickerAction(host, 'status');
      const text = panelText(host);
      expect(text).toContain('Running version: 2.0.0');
      expect(text).toContain('auto_install: ON');
      expect(text).toContain('/upgrade');
    });

  });
});

describe('experiments-settings', () => {
  function feature(
    overrides: Partial<ExperimentalFeatureState> = {},
  ): ExperimentalFeatureState {
    return {
      id: 'async_compaction',
      title: 'Async background compaction',
      description: 'Background full compaction.',
      surface: 'core',
      env: 'SUPERLIORA_EXPERIMENTAL_ASYNC_COMPACTION',
      defaultEnabled: true,
      enabled: true,
      source: 'default',
      ...overrides,
    };
  }

  function makeExperimentsHost(
    options: {
      features?: ExperimentalFeatureState[];
      loadError?: boolean;
    } = {},
  ) {
    const transcriptContainer = { addChild: vi.fn() };
    const features = options.features ?? [
      feature({ enabled: true, source: 'config', configValue: true }),
      feature({
        id: 'prompt_intelligence',
        title: 'Prompt intelligence',
        enabled: false,
        source: 'config',
        configValue: false,
      }),
    ];
    return {
      harness: {
        getExperimentalFeatures: options.loadError
          ? vi.fn(async () => {
              throw new Error('rpc unavailable');
            })
          : vi.fn(async () => features),
      },
      state: {
        transcriptContainer,
        centerModalStack: [] as readonly unknown[],
        appState: {},
        renderer: { invalidateFrame: vi.fn() },
      },
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectExperimentsAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('experiments glance', () => {
    it('summarizes live flags from config', () => {
      const summary = summarizeExperimentalFeatures([
        feature({ enabled: true, source: 'config', configValue: true }),
        feature({ id: 'auto_dream', enabled: false, source: 'env' }),
      ]);
      expect(summary).toEqual({
        totalCount: 2,
        enabledCount: 1,
        disabledCount: 1,
        configOverrideCount: 1,
        envOverrideCount: 1,
      });
      expect(formatExperimentsLiveLine([
        feature({ enabled: true, source: 'config', configValue: true }),
        feature({ id: 'auto_dream', enabled: false, source: 'env' }),
      ])).toContain('1 ON · 1 OFF · 2 registered · 1 config override');
    });

  });

  describe('showExperimentsSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeExperimentsHost();
      showExperimentsSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('mounts read-only experiments panel with live config flags', async () => {
      const host = makeExperimentsHost();
      showExperimentsSettings(host);
      selectExperimentsAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('Live flags:');
      expect(text).toContain('async_compaction ON (config)');
      expect(text).toContain('prompt_intelligence OFF (config)');
      expect(host.harness.getExperimentalFeatures).toHaveBeenCalled();
    });

    it('renders when feature load fails', async () => {
      const host = makeExperimentsHost({ loadError: true });
      showExperimentsSettings(host);
      selectExperimentsAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      expect(panel.snapshotBodyLines(1).join('\n')).toContain('rpc unavailable');
    });
  });
});

describe('extensions-settings', () => {
  function makeExtensionsHost(
    options: {
      hasSession?: boolean;
      plugins?: readonly {
        id: string;
        enabled: boolean;
        hasErrors: boolean;
        hookCount: number;
      }[];
    } = {},
  ) {
    const transcriptContainer = { addChild: vi.fn() };
    const listPlugins = vi.fn(async () =>
      options.hasSession === false
        ? []
        : (options.plugins ?? [
            { id: 'p1', enabled: true, hasErrors: false, hookCount: 2 },
          ]),
    );
    const listSkills = vi.fn(async () => [
      { name: 'write-tui', description: '', source: 'builtin', path: '/builtin/write-tui' },
    ]);
    const listMcpServers = vi.fn(async () => [
      { name: 'fs', transport: 'stdio', status: 'connected', toolCount: 3 },
    ]);
    return {
      harness: {
        homeDir: '/home/.superliora',
        configPath: '/home/.superliora/config.toml',
      },
      state: {
        transcriptContainer,
        centerModalStack: [] as readonly unknown[],
        appState: {},
        renderer: { invalidateFrame: vi.fn() },
      },
      requireSession:
        options.hasSession === false
          ? vi.fn(() => {
              throw new Error('no session');
            })
          : vi.fn(() => ({ listPlugins, listSkills, listMcpServers })),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectExtensionsAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('extensions settings tips', () => {
    it('exports audit, manage paths, and hot-reload tips (glance copy, not menu rows)', () => {
      expect(EXTENSIONS_AUDIT_TIP).toContain('/extensions');
      expect(EXTENSIONS_MANAGE_TIP).toContain('/plugins');
      expect(EXTENSIONS_HOT_RELOAD_TIP).toContain('Hot-reload');
    });
  });

  describe('showExtensionsSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeExtensionsHost();
      showExtensionsSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
        'manage',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('mounts read-only extensions panel with live session counts', async () => {
      const host = makeExtensionsHost();
      showExtensionsSettings(host);
      selectExtensionsAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain('Extensions (read-only)');
      expect(lines).toContain('── Session (live)');
      expect(lines).toContain('Plugins: 1 installed · 1 enabled');
      expect(lines).toContain('Skills: 1 in catalog');
      expect(lines).toContain('MCP: 1 server(s)');
      expect(lines).toContain('Hooks: 2 from 1 enabled plugin(s)');
      expect(lines).toContain('/extensions');
      expect(host.requireSession().listPlugins).toHaveBeenCalled();
    });

    it('works without session', async () => {
      const host = makeExtensionsHost({ hasSession: false });
      showExtensionsSettings(host);
      selectExtensionsAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('session unavailable');
      expect(text).not.toContain('1 installed');
    });
  });
});

describe('hooks-settings', () => {
  function makeHooksHost(
    options: {
      hasSession?: boolean;
      hookCount?: number;
      registry?: { totalCount: number; events: Record<string, number> };
    } = {},
  ) {
    const transcriptContainer = { addChild: vi.fn() };
    const getHookRegistry = vi.fn(async () =>
      options.registry ?? {
        totalCount: options.hookCount ?? 2,
        events: { PreToolUse: options.hookCount ?? 2 },
      },
    );
    const listPlugins = vi.fn(async () =>
      options.hasSession === false
        ? []
        : [{ id: 'p1', enabled: true, hookCount: options.hookCount ?? 2 }],
    );
    return {
      harness: {
        homeDir: '/home/.superliora',
        configPath: '/home/.superliora/config.toml',
      },
      state: {
        transcriptContainer,
        centerModalStack: [] as readonly unknown[],
        appState: {},
        renderer: { invalidateFrame: vi.fn() },
      },
      requireSession:
        options.hasSession === false
          ? vi.fn(() => {
              throw new Error('no session');
            })
          : vi.fn(() => ({ getHookRegistry, listPlugins })),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectHooksAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('hooks settings tips', () => {
    it('exports PreToolUse, PostToolUse, Stop, and enable tips (glance copy, not menu rows)', () => {
      expect(HOOKS_PRE_TOOL_USE_TIP).toContain('PreToolUse');
      expect(HOOKS_POST_TOOL_USE_TIP).toContain('PostToolUse');
      expect(HOOKS_STOP_TIP).toContain('Stop');
      expect(HOOKS_ENABLE_TIP).toContain('config.toml [[hooks]]');
    });
  });

  describe('showHooksSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeHooksHost();
      showHooksSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
        'extensions',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });


    it('works without session', async () => {
      const host = makeHooksHost({ hasSession: false });
      showHooksSettings(host);
      selectHooksAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('/ext hooks');
      expect(text).not.toContain('Live registry (HookEngine)');
    });
  });
});

describe('host-settings', () => {
  function makeHostHost(options: {
    hasSession?: boolean;
    serverUrl?: string;
    harness?: ReturnType<typeof createLioraHarness>;
    lastStepTtft?: {
      ms: number;
      turnId?: number;
      step?: number;
      atMs: number;
      requestBuildMs?: number;
      serverFirstTokenMs?: number;
    } | null;
    lastStepTtftMsWindow?: readonly number[] | null;
  } = {}) {
    const transcriptContainer = { addChild: vi.fn() };
    const requireSession = vi.fn(() => {
      if (options.hasSession === false) {
        throw new Error('no session');
      }
      return { id: 'ses_host_panel', workDir: '/tmp/superliora' };
    });
    const harness =
      options.harness ??
      createLioraHarness({
        homeDir: '/tmp/superliora-home',
        configPath: '/tmp/superliora-home/config.toml',
      });
    return {
      state: {
        transcriptContainer,
        centerModalStack: [] as readonly unknown[],
        appState: {
          workDir: '/tmp/superliora',
          lastStepTtft: options.lastStepTtft ?? null,
          lastStepTtftMsWindow: options.lastStepTtftMsWindow ?? null,
        },
        renderer: { invalidateFrame: vi.fn() },
      },
      harness,
      requireSession,
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      mountEditorReplacement: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectHostAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('host settings tips', () => {
    it('exports sovereign umbrella, TTFT, and future host tips (glance copy, not menu rows)', () => {
      expect(HOST_SOVEREIGN_UMBRELLA_TIP).toContain('SUPERLIORA_SOVEREIGN=1');
      expect(HOST_TTFT_TIP).toContain('TTFT');
      expect(HOST_FUTURE_TIP).toContain('config [host]');
    });
  });

  describe('showHostSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeHostHost();
      showHostSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
        'dirs-list',
        'dirs-add',
        'dirs-remove',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('mounts read-only host panel for in-process default', async () => {
      const prior = process.env['SUPERLIORA_SERVER_URL'];
      delete process.env['SUPERLIORA_SERVER_URL'];
      const host = makeHostHost();
      showHostSettings(host);
      selectHostAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain('Mode: in-process');
      expect(lines).toContain('Transport: SDK in-process RPC');
      expect(lines).toContain('Session: ses_host_panel');
      expect(lines).toContain('Config: /tmp/superliora-home/config.toml');
      expect(lines).toContain('Client env: SUPERLIORA_SERVER_URL unset');
      expect(lines).toContain('TTFT p50: complete a turn to capture live samples');
      expect(lines).toContain('Rolling window up to 20 steps');
      if (prior != null) process.env['SUPERLIORA_SERVER_URL'] = prior;
    });

    it('surfaces live TTFT sample from appState when a step completed with timing', async () => {
      const host = makeHostHost({
        lastStepTtft: { ms: 180, turnId: 4, step: 1, atMs: Date.now() },
      });
      showHostSettings(host);
      selectHostAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain('Last TTFT: 180ms (turn 4 step 1) · in-process path');
      expect(lines).not.toContain('TTFT p50 in-process vs server path');
    });

    it('surfaces TTFT api+client split when appState sample has stream timing parts', async () => {
      const host = makeHostHost({
        lastStepTtft: {
          ms: 420,
          turnId: 5,
          step: 0,
          atMs: Date.now(),
          requestBuildMs: 40,
          serverFirstTokenMs: 380,
        },
      });
      showHostSettings(host);
      selectHostAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain(
        'Last TTFT: 420ms (api 380ms + client 40ms) (turn 5 step 0) · in-process path',
      );
    });

    it('surfaces TTFT p50 from appState rolling window', async () => {
      const host = makeHostHost({
        lastStepTtft: { ms: 300, turnId: 2, step: 1, atMs: Date.now() },
        lastStepTtftMsWindow: [100, 200, 300],
      });
      showHostSettings(host);
      selectHostAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain('TTFT p50: 200ms (n=3, window≤20) · in-process path');
    });

    it('reports configured server URL while runtime stays in-process', async () => {
      const prior = process.env['SUPERLIORA_SERVER_URL'];
      process.env['SUPERLIORA_SERVER_URL'] = 'http://127.0.0.1:58627';
      const home = await mkdtemp(join(tmpdir(), 'liora-host-settings-'));
      const host = makeHostHost({
        harness: createLioraHarness({
          homeDir: home,
          configPath: join(home, 'config.toml'),
        }),
      });
      showHostSettings(host);
      selectHostAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain('Mode: in-process');
      expect(lines).toContain('http://127.0.0.1:58627');
      expect(lines).toContain('not active');
      expect(lines).toContain('Client env: SUPERLIORA_SERVER_URL=http://127.0.0.1:58627');
      await rm(home, { recursive: true, force: true });
      if (prior != null) {
        process.env['SUPERLIORA_SERVER_URL'] = prior;
      } else {
        delete process.env['SUPERLIORA_SERVER_URL'];
      }
    });

    it('documents sovereign umbrella soft gates and live status when env is set', async () => {
      const prev = process.env['SUPERLIORA_SOVEREIGN'];
      process.env['SUPERLIORA_SOVEREIGN'] = '1';
      try {
        const host = makeHostHost();
        showHostSettings(host);
        selectHostAction(host, 'status');
        await vi.waitFor(() => {
          expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
        });
        const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
          .calls[0]?.[0] as UsagePanelComponent;
        const lines = panel.snapshotBodyLines(1).join('\n');
        expect(lines).toContain('SUPERLIORA_SOVEREIGN=1');
        expect(lines).toContain('core profile');
        expect(lines).toContain('hide-legacy');
        expect(lines).toContain('── Session (live) ─');
        expect(lines).toContain('Sovereign umbrella: ON');
        expect(lines).toContain('· core profile: ON');
        expect(lines).toContain('· hide-legacy: ON');
        expect(lines).toContain('· codemap warm: ON');
      } finally {
        if (prev === undefined) delete process.env['SUPERLIORA_SOVEREIGN'];
        else process.env['SUPERLIORA_SOVEREIGN'] = prev;
      }
    });
  });
});

describe('keybindings-settings', () => {
  function makeKeybindingsHost() {
    return {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        renderer: { invalidateFrame: vi.fn() },
      },
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectKeybindingsAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  function panelLines(host: SlashCommandHost): string {
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    return panel.snapshotBodyLines(1).join('\n');
  }

  describe('keybindings settings tips', () => {
    it('exports registry, help, command hub, and future editor tips (glance copy, not menu rows)', () => {
      expect(KEYBINDINGS_REGISTRY_TIP).toContain('keymap.ts');
      expect(KEYBINDINGS_REGISTRY_TIP).toContain('SSOT');
      expect(KEYBINDINGS_HELP_TIP).toContain('/help');
      expect(KEYBINDINGS_COMMAND_HUB_TIP).toContain('Ctrl-K');
      expect(KEYBINDINGS_COMMAND_HUB_TIP).toContain('?');
      expect(KEYBINDINGS_FUTURE_EDITOR_TIP).toContain('Custom keybinding editor');
      expect(KEYBINDINGS_FUTURE_EDITOR_TIP).toContain('Settings → Editor');
    });
  });

  describe('showKeybindingsSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeKeybindingsHost();
      showKeybindingsSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
        'help',
        'command-hub',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('mounts read-only keybindings panel for status', () => {
      const host = makeKeybindingsHost();
      showKeybindingsSettings(host);
      selectKeybindingsAction(host, 'status');

      const lines = panelLines(host);
      expect(lines).toContain('Keyboard / Keybindings (read-only)');
      expect(lines).toContain('Live registry (keymap.ts)');
      expect(lines).toContain('Plan / Agents / Transcript samples');
      expect(lines).toContain('/help');
      expect(lines).toContain('Ctrl-C');
    });
  });
});

describe('mcp-settings', () => {
  function makeMcpSettingsHost(
    options: {
      hasSession?: boolean;
      servers?: Array<{
        name: string;
        transport: string;
        status: string;
        toolCount: number;
      }>;
    } = {},
  ) {
    const transcriptContainer = { addChild: vi.fn() };
    const mountCenterModal = vi.fn();
    const listMcpServers = vi.fn(async () => options.servers ?? []);
    return {
      harness: { homeDir: '/home/.superliora' },
      state: {
        centerModalStack: [],
        transcriptContainer,
        appState: { workDir: '/tmp/ws' },
        renderer: { invalidateFrame: vi.fn() },
      },
      mountCenterModal,
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
      requireSession:
        options.hasSession === false
          ? vi.fn(() => {
              throw new Error('no active session');
            })
          : vi.fn(() => ({ listMcpServers, workDir: '/tmp/ws' })),
    } as unknown as SlashCommandHost;
  }

  function selectMcpAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('mcp settings tips', () => {
    it('exports config scopes, OAuth, and allowlist tips (glance copy, not menu rows)', () => {
      expect(MCP_CONFIG_SCOPES_TIP).toContain('mcp.json');
      expect(MCP_CONFIG_SCOPES_TIP).toContain('.superliora');
      expect(MCP_OAUTH_TIP).toContain('/mcp-config login');
      expect(MCP_ALLOWLIST_TIP).toContain('enabledTools');
    });
  });

  describe('showMcpSettings', () => {
    it('mounts ChoicePicker with status, manage, and read-only tip actions — tip-free', () => {
      const host = makeMcpSettingsHost();
      showMcpSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
        'manage',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('mounts glance panel with live listMcpServers count', async () => {
      const host = makeMcpSettingsHost({
        servers: [
          { name: 'demo', transport: 'stdio', status: 'connected', toolCount: 4 },
          { name: 'off', transport: 'http', status: 'disabled', toolCount: 0 },
        ],
      });
      showMcpSettings(host);
      selectMcpAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      expect(host.requireSession().listMcpServers).toHaveBeenCalled();
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('Live session: 2 server(s)');
      expect(text).toContain('1 connected');
      expect(text).toContain('demo — connected');
    });

    it('works without session', async () => {
      const host = makeMcpSettingsHost({ hasSession: false });
      showMcpSettings(host);
      selectMcpAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('open a session to inspect MCP connection status');
    });
  });
});

describe('media-settings', () => {
  function makeMediaHost() {
    return {
      harness: {
        homeDir: '/home/.superliora',
        configPath: '/home/.superliora/config.toml',
        getConfig: vi.fn(async () => ({ media: { nonVisionFallback: 'block' } })),
      },
      state: {
        appState: {
          model: 'text-only',
          nonVisionFallbackPolicy: 'analyze',
          availableModels: {
            'text-only': {
              provider: 'test',
              model: 'text-only',
              maxContextSize: 128_000,
              capabilities: ['tool_use'],
            },
          },
        },
        transcriptContainer: { addChild: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        renderer: { invalidateFrame: vi.fn() },
      },
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectMediaAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('media settings tips', () => {
    it('still exports tip strings for glance/status (not menu rows)', () => {
      expect(MEDIA_ANALYZE_TIP).toContain('analyze');
      expect(MEDIA_ANALYZE_TIP).toContain('vision-capable');
      expect(MEDIA_PATH_TIP).toContain('path');
      expect(MEDIA_PATH_TIP).toContain('pointer');
      expect(MEDIA_BLOCK_TIP).toContain('block');
      expect(MEDIA_BLOCK_TIP).toContain('image_in');
    });
  });

  describe('showMediaSettings', () => {
    it('mounts ChoicePicker with real actions only (no tip rows)', () => {
      const host = makeMediaHost();
      showMediaSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'presets',
        'status',
        'change-policy',
        'analyzer-image',
        'analyzer-video',
        'analyzer-audio',
        'analyzer-pdf',
        'change-model',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('lists per-kind analyzer rows with the current override', () => {
      const host = makeMediaHost();
      host.state.appState.mediaAnalyzerModels = { pdf: 'commandcode/z-ai/glm-5.3-flash' };
      showMediaSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      const options = (picker as unknown as { opts: { options: readonly { value: string; label: string }[] } })
        .opts.options;
      const pdfRow = options.find((o) => o.value === 'analyzer-pdf');
      const imageRow = options.find((o) => o.value === 'analyzer-image');
      expect(pdfRow?.label).toContain('commandcode/z-ai/glm-5.3-flash');
      expect(imageRow?.label).toContain('Auto');
    });

    it('mounts read-only media panel with live config policy', async () => {
      const host = makeMediaHost();
      showMediaSettings(host);
      selectMediaAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('Fallback policy: block');
      expect(host.harness.getConfig).toHaveBeenCalledWith({ reload: true });
    });
  });
});

describe('network-settings', () => {
  function makeNetworkHost() {
    return {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        renderer: { invalidateFrame: vi.fn() },
      },
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectNetworkAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  function panelLines(host: SlashCommandHost): string {
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    return panel.snapshotBodyLines(1).join('\n');
  }

  describe('network settings tips', () => {
    it('exports proxy, NO_PROXY, and SOCKS tips (glance copy, not menu rows)', () => {
      expect(NETWORK_PROXY_TIP).toContain('HTTP_PROXY');
      expect(NETWORK_PROXY_TIP).toContain('HTTPS_PROXY');
      expect(NETWORK_NO_PROXY_TIP).toContain('NO_PROXY');
      expect(NETWORK_NO_PROXY_TIP).toContain('localhost');
      expect(NETWORK_SOCKS_TIP).toContain('SOCKS');
      expect(NETWORK_SOCKS_TIP).toContain('MCP stdio');
    });
  });

  describe('showNetworkSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeNetworkHost();
      showNetworkSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('reports HTTPS_PROXY when env is set', () => {
      const prior = process.env['HTTPS_PROXY'];
      process.env['HTTPS_PROXY'] = 'http://proxy.example.test:8080';
      const host = makeNetworkHost();

      showNetworkSettings(host);
      selectNetworkAction(host, 'status');

      const lines = panelLines(host);
      expect(lines).toContain('Network / Proxy (read-only)');
      expect(lines).toContain('HTTPS_PROXY=http://proxy.example.test:8080');
      expect(lines).toContain('ACTIVE');

      if (prior != null) process.env['HTTPS_PROXY'] = prior;
      else delete process.env['HTTPS_PROXY'];
    });

    it('shows HTTP_PROXY and NO_PROXY on separate env lines', () => {
      const priorHttp = process.env['HTTP_PROXY'];
      const priorNo = process.env['NO_PROXY'];
      process.env['HTTP_PROXY'] = 'http://corp.example.test:8080';
      process.env['NO_PROXY'] = 'localhost,.internal';
      delete process.env['HTTPS_PROXY'];

      const host = makeNetworkHost();

      showNetworkSettings(host);
      selectNetworkAction(host, 'status');

      const lines = panelLines(host);
      expect(lines).toContain('Process env (live)');
      expect(lines).toContain('HTTP_PROXY=http://corp.example.test:8080');
      expect(lines).toContain('NO_PROXY=localhost,.internal');
      expect(lines).toContain('HTTPS_PROXY: unset');

      if (priorHttp != null) process.env['HTTP_PROXY'] = priorHttp;
      else delete process.env['HTTP_PROXY'];
      if (priorNo != null) process.env['NO_PROXY'] = priorNo;
      else delete process.env['NO_PROXY'];
    });

    it('re-reads process env on each buildLines call', () => {
      const prior = process.env['HTTPS_PROXY'];
      delete process.env['HTTPS_PROXY'];

      const host = makeNetworkHost();

      showNetworkSettings(host);
      selectNetworkAction(host, 'status');
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;

      expect(panel.snapshotBodyLines(1).join('\n')).toContain('not configured');

      process.env['HTTPS_PROXY'] = 'http://live.example.test:9999';
      expect(panel.snapshotBodyLines(1).join('\n')).toContain('HTTPS_PROXY=http://live.example.test:9999');

      if (prior != null) process.env['HTTPS_PROXY'] = prior;
      else delete process.env['HTTPS_PROXY'];
    });

    it('reports direct connections when no proxy env is set', () => {
      const priorHttp = process.env['HTTP_PROXY'];
      const priorHttps = process.env['HTTPS_PROXY'];
      const priorAll = process.env['ALL_PROXY'];
      delete process.env['HTTP_PROXY'];
      delete process.env['HTTPS_PROXY'];
      delete process.env['ALL_PROXY'];

      const host = makeNetworkHost();

      showNetworkSettings(host);
      selectNetworkAction(host, 'status');
      expect(panelLines(host)).toContain('not configured');

      if (priorHttp != null) process.env['HTTP_PROXY'] = priorHttp;
      if (priorHttps != null) process.env['HTTPS_PROXY'] = priorHttps;
      if (priorAll != null) process.env['ALL_PROXY'] = priorAll;
    });
  });
});

describe('never-halt-settings', () => {
  function makeHost(options: {
    circuitBreakers?: {
      closed: number;
      open: number;
      halfOpen: number;
      lastTripReason?: string;
      scopes?: ReadonlyArray<{
        id: string;
        state: string;
        failures: number;
        lastTripReason?: string;
      }>;
    } | null;
    hasSession?: boolean;
    getStatus?: () => Promise<Record<string, unknown>>;
  } = {}) {
    const session = {
      getStatus:
        options.getStatus ??
        vi.fn(async () => ({
          circuitBreakers: {
            closed: 1,
            open: 0,
            halfOpen: 0,
          },
        })),
    };
    return {
      state: {
        appState: {
          circuitBreakers: options.circuitBreakers ?? null,
          availableProviders: [],
          availableModels: {},
          model: '',
          runtimeDegraded: null,
        },
        transcriptContainer: { addChild: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        renderer: { invalidateFrame: vi.fn() },
      },
      requireSession:
        options.hasSession === false
          ? vi.fn(() => {
              throw new Error('no session');
            })
          : vi.fn(() => session),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectNeverHaltAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('never-halt settings tips', () => {
    it('exports search fallback, oauth, intervention, and breaker tips (glance copy, not menu rows)', () => {
      expect(NEVER_HALT_SEARCH_FALLBACK_TIP).toContain('free fallback');
      expect(NEVER_HALT_SEARCH_FALLBACK_TIP).toContain('Settings → Search');
      expect(NEVER_HALT_OAUTH_TIP).toContain('ensureFresh');
      expect(NEVER_HALT_OAUTH_TIP).toContain('Settings → Accounts');
      expect(NEVER_HALT_INTERVENTION_TIP).toContain('Jobs and independent tools');
      expect(NEVER_HALT_INTERVENTION_TIP).toContain('parallel');
      expect(NEVER_HALT_BREAKER_TIP).toContain('half-open');
      expect(NEVER_HALT_BREAKER_TIP).toContain('runtime.degraded');
    });
  });

  describe('showNeverHaltSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeHost();
      showNeverHaltSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('uses AppState circuitBreakers when getStatus is unavailable', async () => {
      const host = makeHost({
        hasSession: false,
        circuitBreakers: {
          closed: 2,
          open: 1,
          halfOpen: 0,
          lastTripReason: 'provider 429 burst',
          scopes: [{ id: 'llm:primary', state: 'open', failures: 4, lastTripReason: '429 burst' }],
        },
      });
      showNeverHaltSettings(host);
      selectNeverHaltAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.render(100).join('\n');
      expect(text).toContain('Last trip: provider 429 burst');
      expect(text).toContain('llm:primary: open');
    });

    it('prefers live getStatus over AppState registry snapshot', async () => {
      const host = makeHost({
        circuitBreakers: {
          closed: 0,
          open: 9,
          halfOpen: 0,
          lastTripReason: 'stale trip',
        },
        getStatus: vi.fn(async () => ({
          circuitBreakers: {
            closed: 3,
            open: 0,
            halfOpen: 1,
            lastTripReason: 'live trip',
          },
        })),
      });
      showNeverHaltSettings(host);
      selectNeverHaltAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.render(100).join('\n');
      expect(text).toContain('1 half');
      expect(text).toContain('Last trip: live trip');
      expect(text).not.toContain('stale trip');
    });

    it('shows live intervention queue depth from getStatus', async () => {
      const host = makeHost({
        getStatus: vi.fn(async () => ({
          circuitBreakers: { closed: 1, open: 0, halfOpen: 0 },
          pendingInterventions: 2,
          staleInterventions: 1,
          oldestInterventionAgeMs: 125_000,
        })),
      });
      showNeverHaltSettings(host);
      selectNeverHaltAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.render(100).join('\n');
      expect(text).toContain('── Session (live) ─');
      expect(text).toContain('Never-Halt queue: 2 pending');
      expect(text).toContain('Goal/Jobs continue');
      expect(text).toContain('stale×1');
    });

    it('surfaces ask-mode Fleet continue in the permission queue section', async () => {
      const host = makeHost();
      showNeverHaltSettings(host);
      selectNeverHaltAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.render(100).join('\n');
      expect(text).toContain('Ask mode: one approval waits in Ops tray');
      expect(text).toContain('Independent tool_calls proceed in parallel');
    });

    it('shows clear queue when getStatus reports zero pending interventions', async () => {
      const host = makeHost({
        getStatus: vi.fn(async () => ({
          circuitBreakers: { closed: 1, open: 0, halfOpen: 0 },
          pendingInterventions: 0,
        })),
      });
      showNeverHaltSettings(host);
      selectNeverHaltAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.render(100).join('\n');
      expect(text).toContain('Live queue: (clear)');
    });
  });
});

describe('persona-settings', () => {
  function makePersonaHost(
    options: {
      persona?: {
        name?: string;
        preset?: string;
        tone?: string;
        personality?: string;
        instructions?: string;
      };
      configError?: boolean;
    } = {},
  ) {
    const transcriptContainer = { addChild: vi.fn() };
    return {
      harness: {
        homeDir: '/home/.superliora',
        configPath: '/home/.superliora/config.toml',
        getConfig: options.configError
          ? vi.fn(async () => {
              throw new Error('config read failed');
            })
          : vi.fn(async () => ({ persona: options.persona })),
      },
      state: {
        transcriptContainer,
        appState: {},
        renderer: { invalidateFrame: vi.fn() },
        centerModalStack: [] as readonly unknown[],
      },
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectPersonaAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('persona glance', () => {
    it('formats active persona name from config', () => {
      expect(formatActivePersonaLine({ name: 'Liora' })).toBe('Active persona: Liora');
      expect(formatActivePersonaLine({ preset: 'mentor' })).toBe(
        'Active persona: mentor (preset)',
      );
      expect(formatActivePersonaLine(undefined)).toBe(
        'Active persona: Liora (default preset)',
      );
      expect(formatActivePersonaLine({ preset: 'none' })).toBe(
        'Active persona: disabled (preset = none)',
      );
      expect(formatActivePersonaLine({ name: 'old label', preset: 'none' })).toBe(
        'Active persona: disabled (preset = none)',
      );
    });
  });

  describe('persona settings', () => {
    it('mounts ChoicePicker then panel with live active name', async () => {
      const host = makePersonaHost({ persona: { name: 'Coach', preset: 'mentor' } });
      showPersonaSettings(host);
      selectPersonaAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('Active persona: Coach');
      expect(text).toContain('efficient');
      expect(text).toContain('mentor');
      expect(host.harness.getConfig).toHaveBeenCalledWith({ reload: true });
    });

    it('renders when config load fails', async () => {
      const host = makePersonaHost({ configError: true });
      showPersonaSettings(host);
      selectPersonaAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      expect(panel.snapshotBodyLines(1).join('\n')).toContain('config read failed');
    });

    it('marks implicit Liora as current in the preset picker', async () => {
      const host = makePersonaHost();
      showPersonaSettings(host);
      selectPersonaAction(host, 'preset');

      await vi.waitFor(() => {
        expect((host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
      });

      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      expect((picker as unknown as { opts: { currentValue?: string } }).opts.currentValue).toBe(
        'liora',
      );
    });
  });
});

describe('premium-settings', () => {
  function makeHost(options: {
    premiumQualityMode?: boolean;
    appearance?: typeof DEFAULT_APPEARANCE_PREFERENCES;
    diagnostics?: RendererDiagnosticsSnapshot;
    getStatus?: () => Promise<{ premiumQualityMode?: boolean }>;
    hasSession?: boolean;
  } = {}) {
    const session = {
      getStatus:
        options.getStatus ??
        vi.fn(async () => ({
          premiumQualityMode: options.premiumQualityMode === true,
        })),
    };

    return {
      state: {
        appState: {
          premiumQualityMode: options.premiumQualityMode === true,
          appearance: options.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
        },
        transcriptContainer: { addChild: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        renderer: {
          invalidateFrame: vi.fn(),
          nativeRuntime:
            options.diagnostics !== undefined
              ? { diagnostics: options.diagnostics }
              : undefined,
        },
      },
      session: options.hasSession === false ? undefined : session,
      requireSession:
        options.hasSession === false
          ? vi.fn(() => {
              throw new Error('no session');
            })
          : vi.fn(() => session),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
      showNotice: vi.fn(),
      showError: vi.fn(),
      setAppState: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectPremiumAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  const ENV_KEYS = ['TERM', 'CI', 'NO_COLOR', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT'] as const;


  describe('showPremiumSettings', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      for (const key of ENV_KEYS) delete process.env[key];
      process.env['TERM'] = 'xterm-256color';
      setAppearanceRenderQuality('full');
      setAppearanceRenderHealth('healthy');
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      setAppearanceRenderQuality('full');
      setAppearanceRenderHealth('healthy');
    });

    it('mounts ChoicePicker with live PQ actions (no tip rows)', () => {
      const host = makeHost();
      showPremiumSettings(host);
      expect(host.mountCenterModal).toHaveBeenCalledOnce();
      const options = (
        (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
          opts: { options: readonly { value: string }[] };
        }
      ).opts.options;
      expect(options.map((o) => o.value)).toEqual([
        'presets',
        'status',
        'pq-on',
        'pq-off',
        'transcript-detail',
        'appearance',
      ]);
    });

    it('inherits PREMIUM list chrome instead of a stub ↑↓ · Enter · Esc hint', () => {
      const host = makeHost();
      showPremiumSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      expectPremiumPickerChrome(picker!);
    });

    it('renders live Visual Quality + motion budget lines when session is wired', async () => {
      setAppearanceRenderQuality('balanced');
      setAppearanceRenderHealth('watch');

      const host = makeHost({
        premiumQualityMode: true,
        appearance: {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          profile: 'premium',
          particles: 'premium',
          animationFps: 60,
        },
        diagnostics: {
          frames: 2,
          avgFrameBudgetRatio: 0.85,
          quality: { level: 'balanced' },
        } as RendererDiagnosticsSnapshot,
      });

      showPremiumSettings(host);
      selectPremiumAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('── Session (live) ─');
      expect(text).toContain('Visual Quality: ON');
      expect(text).toContain('profile premium');
      expect(text).toContain('Render quality: balanced');
      expect(text).toContain('frame health: watch');
      expect(text).toContain('Motion budget:');
      expect(text).toContain('frame budget 85% avg');
    });

    it('still renders from appState when session is unavailable', async () => {
      const host = makeHost({ hasSession: false, premiumQualityMode: false });
      showPremiumSettings(host);
      selectPremiumAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain('Visual Quality: OFF');
      expect(text).toContain('awaiting first frame');
    });
  });
});

describe('providers-api-settings', () => {
  function makeProvidersHost(options?: {
    readonly session?: {
      getStatus: () => Promise<{ model?: string; providerRouteStatus?: unknown }>;
      getTools?: () => Promise<Array<{ name: string; active: boolean }>>;
    };
    readonly providers?: Record<string, unknown>;
  }) {
    return {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        renderer: { invalidateFrame: vi.fn() },
        appState: {
          model: 'kimi-k2',
          availableModels: {
            'kimi-k2': {
              displayName: 'Kimi K2',
              model: 'kimi-k2-upstream',
              provider: 'moonshot',
              maxContextSize: 256_000,
            },
          },
          availableProviders: { moonshot: {} },
        },
      },
      harness: {
        getConfig: vi.fn(async () => ({
          providers: options?.providers ?? {},
        })),
        setConfig: vi.fn(async () => undefined),
      },
      authFlow: {
        refreshConfigAfterLogin: vi.fn(async () => undefined),
      },
      requireSession: () => {
        if (options?.session === undefined) {
          throw new Error('no session');
        }
        return options.session;
      },
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectProvidersAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  function panelLines(host: SlashCommandHost): string {
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    return panel.snapshotBodyLines(1).join('\n');
  }

  describe('providers settings tips', () => {
    it('exports /login, API key env, and PreferXai tips (glance copy, not menu rows)', () => {
      expect(PROVIDERS_LOGIN_TIP).toContain('/login');
      expect(PROVIDERS_LOGIN_TIP).toContain('Settings → Accounts');
      expect(PROVIDERS_API_KEY_ENVS_TIP).toContain('KIMI_API_KEY');
      expect(PROVIDERS_API_KEY_ENVS_TIP).toContain('ANTHROPIC_API_KEY');
      expect(PROVIDERS_API_KEY_ENVS_TIP).toContain('config.toml');
      expect(SEARCH_PREFER_XAI_TIP).toContain('PreferXai');
      expect(SEARCH_PREFER_XAI_TIP).toContain('XAI_API_KEY');
    });
  });

  describe('showProvidersApiSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', async () => {
      const host = makeProvidersHost();
      showProvidersApiSettings(host);
      await vi.waitFor(() => {
        expect(host.mountCenterModal).toHaveBeenCalled();
      });
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
        'login',
        'model',
        'search',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('adds xAI route switch when xai-grok is configured', async () => {
      const host = makeProvidersHost({
        providers: {
          'xai-grok': {
            type: 'openai',
            baseUrl: 'https://cli-chat-proxy.grok.com/v1',
            oauth: { storage: 'file', key: 'xai-grok' },
          },
        },
      });
      showProvidersApiSettings(host);
      await vi.waitFor(() => {
        expect(host.mountCenterModal).toHaveBeenCalled();
      });
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
        'login',
        'xai-route',
        'model',
        'search',
      ]);
    });

    it('mounts read-only providers panel when status is selected', async () => {
      const host = makeProvidersHost();
      showProvidersApiSettings(host);
      await vi.waitFor(() => {
        expect(host.mountCenterModal).toHaveBeenCalled();
      });
      selectProvidersAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const lines = panelLines(host);
      expect(lines).toContain('Providers & API (read-only)');
      expect(lines).toContain('/login');
      expect(lines).toContain('W11 OSS absorb');
      expect(lines).toContain('no active session');
    });

    it('wires live provider/model from session.getStatus', async () => {
      const host = makeProvidersHost({
        session: {
          getStatus: async () => ({
            model: 'kimi-k2',
            providerRouteStatus: { primary: true },
          }),
          getTools: async () => [{ name: 'WebSearch', active: true }],
        },
      });
      showProvidersApiSettings(host);
      await vi.waitFor(() => {
        expect(host.mountCenterModal).toHaveBeenCalled();
      });
      selectProvidersAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const lines = panelLines(host);
      expect(lines).toContain('── Session (live) ─');
      expect(lines).toContain('Active model: Kimi K2 (kimi-k2) · live session confirms');
      expect(lines).toContain('Active provider: moonshot · upstream kimi-k2-upstream');
      expect(lines).toContain('Route: primary');
      expect(lines).toContain('PreferXai');
    });

    it('re-reads process env on each buildLines call', async () => {
      const prior = process.env['ANTHROPIC_API_KEY'];
      delete process.env['ANTHROPIC_API_KEY'];

      const host = makeProvidersHost();
      showProvidersApiSettings(host);
      await vi.waitFor(() => {
        expect(host.mountCenterModal).toHaveBeenCalled();
      });
      selectProvidersAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      expect(panel.snapshotBodyLines(1).join('\n')).toContain(
        'No common provider API keys detected',
      );

      process.env['ANTHROPIC_API_KEY'] = 'secret';
      const updated = panel.snapshotBodyLines(1).join('\n');
      expect(updated).toContain('Anthropic');
      expect(updated).not.toContain('secret');

      if (prior != null) process.env['ANTHROPIC_API_KEY'] = prior;
      else delete process.env['ANTHROPIC_API_KEY'];
    });
  });
});

describe('search-settings', () => {
  function makeHost(options: {
    getStatus?: () => Promise<Record<string, unknown>>;
    getConfig?: () => Promise<Record<string, unknown>>;
    hasSession?: boolean;
  } = {}) {
    const session = {
      getStatus:
        options.getStatus ??
        vi.fn(async () => ({
          usage: {
            searchNeverEmpty: { hardFailCount: 0, softDegradeCount: 1 },
            localResearchCache: { hitRate: 0.8, hits: 4, misses: 1 },
          },
        })),
    };
    const addChild = vi.fn();
    return {
      state: {
        theme: currentTheme,
        transcriptContainer: { addChild },
        ui: { requestRender: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        appState: { searchCascade: undefined },
      },
      harness: {
        getConfig:
          options.getConfig ??
          vi.fn(async () => ({
            research: {
              localSearch: { enabled: true },
              search: {
                freeFallback: true,
                strategy: 'parallel',
                browserEscalate: false,
                preferXai: false,
              },
            },
          })),
        setConfig: vi.fn(),
      },
      requireSession:
        options.hasSession === false
          ? vi.fn(() => {
              throw new Error('no session');
            })
          : vi.fn(() => session),
      showStatus: vi.fn(),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      mountEditorReplacement: vi.fn(),
      restoreEditor: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  describe('search strategy / browser escalate helpers', () => {
    it('builds setConfig patches and resolves defaults', () => {
      expect(buildSearchStrategyConfigPatch('parallel')).toEqual({
        research: { search: { strategy: 'parallel' } },
      });
      expect(buildSearchBrowserEscalateConfigPatch(false)).toEqual({
        research: { search: { browserEscalate: false } },
      });
      expect(buildSearchPreferXaiConfigPatch(false)).toEqual({
        research: { search: { preferXai: false } },
      });
      expect(resolveSearchStrategy(undefined)).toBe('auto');
      expect(resolveSearchBrowserEscalate(undefined)).toBe(true);
      expect(resolveSearchPreferXai(undefined)).toBe(true);
      expect(formatSearchStrategyLine('auto')).toContain('auto');
      expect(formatSearchBrowserEscalateLine(false)).toContain('off');
      expect(formatSearchPreferXaiLine(false)).toContain('off');
      expect(buildSearchSearxngUrlConfigPatch('https://searx.example.com')).toEqual({
        research: { localSearch: { searxngUrl: 'https://searx.example.com' } },
      });
      expect(isValidSearxngUrl('https://searx.example.com')).toBe(true);
      expect(isValidSearxngUrl('not-a-url')).toBe(false);
    });
  });

  describe('showSearchSettings status panel', () => {
    it('wires live never-empty and LocalResearchCache hit from getStatus', async () => {
      const host = makeHost();
      showSearchSettings(host);

      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      (picker as unknown as { opts: { onSelect: (value: string) => void } }).opts.onSelect('status');
      await vi.waitFor(() => {
        expect((host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls.length)
          .toBeGreaterThan(0);
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls.at(-1)?.[0] as UsagePanelComponent;
      const text = panel.render(100).join('\n');
      expect(text).toContain('Never-empty: hard-fail 0 · soft-degrade 1');
      expect(text).toContain('Free-only KPI: soft 100% · hard-fail 0 · target ≥99%');
      expect(text).toContain('LocalResearchCache: hit 80% · 4/5 lookups');
      expect(text).toContain('Strategy: parallel');
      expect(text).toContain('Browser escalate (Ch4/Ch5): off');
      expect(text).toContain('PreferXai (Grok Build first): off');
    });

    it('writes strategy via setConfig from nested strategy picker', async () => {
      const host = makeHost();
      showSearchSettings(host);
      const root = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      (root as unknown as { opts: { onSelect: (value: string) => void } }).opts.onSelect('strategy');

      await vi.waitFor(() => {
        expect((host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
          1,
        );
      });
      const strategyPicker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
        | ChoicePickerComponent
        | undefined;
      (strategyPicker as unknown as { opts: { onSelect: (value: string) => void } }).opts.onSelect(
        'fallback',
      );
      await vi.waitFor(() => {
        expect(host.harness.setConfig).toHaveBeenCalledWith({
          research: { search: { strategy: 'fallback' } },
        });
      });
    });
  });
});

describe('security-settings', () => {
  function makeSecurityHost(options: {
    hasSession?: boolean;
    permissionMode?: string;
    workDir?: string;
    sandboxProfile?: 'off' | 'workspace' | 'read-only';
  } = {}) {
    const transcriptContainer = { addChild: vi.fn() };
    const setConfig = vi.fn(async () => undefined);
    const setSandboxProfile = vi.fn(async () => undefined);
    const setSandboxEnforcement = vi.fn(async () => undefined);
    const requireSession = vi.fn(() => {
      if (options.hasSession === false) {
        throw new Error('no session');
      }
      return {
        getStatus: vi.fn(async () => ({ permission: options.permissionMode ?? 'auto' })),
        listMcpServers: vi.fn(async () => [{ status: 'connected' }]),
        getResumeState: vi.fn(() => ({
          sessionMetadata: {
            custom: { sandboxProfile: options.sandboxProfile ?? 'workspace' },
          },
        })),
        setSandboxProfile,
        setSandboxEnforcement,
      };
    });
    return {
      state: {
        transcriptContainer,
        centerModalStack: [] as readonly unknown[],
        appState: {
          permissionMode: options.permissionMode ?? 'auto',
          workDir: options.workDir ?? '/tmp/superliora-security',
          additionalDirs: [],
        },
        renderer: { invalidateFrame: vi.fn() },
      },
      requireSession,
      harness: { setConfig },
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
      _setConfig: setConfig,
      _setSandboxProfile: setSandboxProfile,
      _setSandboxEnforcement: setSandboxEnforcement,
    } as unknown as SlashCommandHost & {
      _setConfig: typeof setConfig;
      _setSandboxProfile: typeof setSandboxProfile;
      _setSandboxEnforcement: typeof setSandboxEnforcement;
    };
  }

  async function waitForPicker(host: SlashCommandHost): Promise<ChoicePickerComponent> {
    await vi.waitFor(() => {
      expect(host.mountCenterModal).toHaveBeenCalled();
    });
    return (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as ChoicePickerComponent;
  }

  function selectSecurityAction(picker: ChoicePickerComponent, value: string): void {
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('security settings tips', () => {
    it('exports sandbox, redaction, and MCP allowlist tips (glance copy)', () => {
      expect(SECURITY_SANDBOX_TIP).toContain('sandboxProfile');
      expect(SECURITY_SANDBOX_TIP).toContain('read-only');
      expect(SECURITY_SANDBOX_TIP).toContain('not OS isolation');
      expect(SECURITY_NOT_OS_SANDBOX).toContain('Not an OS sandbox');
      expect(SECURITY_REDACTION_TIP).toContain('redactSecretsInText');
      expect(SECURITY_REDACTION_TIP).toContain('redteam-soft');
      expect(SECURITY_MCP_ALLOWLIST_TIP).toContain('enabledTools');
      expect(SECURITY_MCP_ALLOWLIST_TIP).toContain('disabledTools');
    });
  });

  describe('showSecuritySettings', () => {
    it('mounts ChoicePicker with status and three sandbox profiles — PREMIUM currentValue, no tip-only rows', async () => {
      const host = makeSecurityHost({ sandboxProfile: 'workspace' });
      showSecuritySettings(host);
      const picker = await waitForPicker(host);
      const opts = (
        picker as unknown as {
          opts: {
            currentValue?: string;
            options: readonly { value: string; label: string }[];
          };
        }
      ).opts;
      expect(opts.options.map((o) => o.value)).toEqual([
        'status',
        'off',
        'workspace',
        'read-only',
        'enforcement-lexical',
        'enforcement-process',
      ]);
      expect(opts.options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
      expect(opts.currentValue).toBe('workspace');
      expect(opts.options.every((o) => !o.label.includes('●'))).toBe(true);
    });

    it('defaults currentValue to off when session metadata has no sandbox profile', async () => {
      const host = makeSecurityHost({ hasSession: false });
      showSecuritySettings(host);
      const picker = await waitForPicker(host);
      const opts = (picker as unknown as { opts: { currentValue?: string } }).opts;
      expect(opts.currentValue).toBe('off');
    });

    it('persists sandbox profile via setConfig and live session setSandboxProfile', async () => {
      const host = makeSecurityHost({ sandboxProfile: 'off' });
      showSecuritySettings(host);
      const picker = await waitForPicker(host);
      selectSecurityAction(picker, 'workspace');
      await vi.waitFor(() => {
        expect(host._setConfig).toHaveBeenCalledWith({ sandboxProfile: 'workspace' });
      });
      await vi.waitFor(() => {
        expect(host._setSandboxProfile).toHaveBeenCalledWith('workspace');
      });
      expect(host.showStatus).toHaveBeenCalled();
      const statusMsg = String((host.showStatus as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? '');
      expect(statusMsg).toMatch(/Path sandbox|OS isolation/i);
    });

    it('persists process enforcement and raises off profile to workspace', async () => {
      const host = makeSecurityHost({ sandboxProfile: 'off' });
      showSecuritySettings(host);
      const picker = await waitForPicker(host);
      selectSecurityAction(picker, 'enforcement-process');
      await vi.waitFor(() => {
        expect(host._setConfig).toHaveBeenCalledWith({
          sandboxProfile: 'workspace',
          sandboxEnforcement: 'process',
        });
      });
      await vi.waitFor(() => {
        expect(host._setSandboxProfile).toHaveBeenCalledWith('workspace');
        expect(host._setSandboxEnforcement).toHaveBeenCalledWith('process');
      });
    });

    it('mounts security panel for status action with workspace profile', async () => {
      const host = makeSecurityHost();
      showSecuritySettings(host);
      const picker = await waitForPicker(host);
      selectSecurityAction(picker, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain('§9.2');
      expect(lines).toContain('Sandbox profile: workspace');
      expect(lines).toContain('Not an OS sandbox');
      expect(lines).toContain('redactSecretsInText');
      expect(lines).toContain('enabledTools');
      expect(lines).toContain('/tmp/superliora-security');
    });

    it('renders security panel without session when unavailable', async () => {
      const host = makeSecurityHost({ hasSession: false });
      showSecuritySettings(host);
      const picker = await waitForPicker(host);
      selectSecurityAction(picker, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain('no active session');
      expect(lines).toContain('Permission mode');
    });
  });
});

describe('settings-hub-jumps', () => {
  describe('SETTINGS_SEARCH_KEYWORDS', () => {
    it('covers every SettingsSelection value', () => {
      for (const option of SETTINGS_OPTIONS) {
        expect(SETTINGS_SEARCH_KEYWORDS).toHaveProperty(option.value);
      }
    });

    it('includes operator aliases for cache, index, security, and search', () => {
      expect(SETTINGS_SEARCH_KEYWORDS.cache).toContain('freeze');
      expect(SETTINGS_SEARCH_KEYWORDS.index).toContain('fts');
      expect(SETTINGS_SEARCH_KEYWORDS.security).toContain('redaction');
      expect(SETTINGS_SEARCH_KEYWORDS.search).toContain('ddg');
    });
  });

  describe('buildSettingsJumpHubItems', () => {
    it('includes browse-all and search-only pane jumps', () => {
      const items = buildSettingsJumpHubItems();
      expect(items[0]?.id).toBe('settings.open');
      expect(items.some((item) => item.id === 'settings.cache' && item.searchOnly === true)).toBe(
        true,
      );
      expect(items.some((item) => item.id === 'settings.search' && item.keywords?.includes('ddg'))).toBe(
        true,
      );
    });

    it('surfaces cache when Hub filter query is freeze', () => {
      const items = buildDefaultCommandHubItems({});
      const matched = filterHubItems(items, 'freeze');
      expect(matched.some((item) => item.id === 'settings.cache')).toBe(true);
      expect(matched.some((item) => item.id === 'settings.open')).toBe(true);
    });

    it('maps settings hub ids for slash and nested picker behavior', () => {
      expect(commandHubActionToSlash('settings.open')).toBe('/settings');
      expect(commandHubActionToSlash('settings.cache')).toBeUndefined();
      expect(commandHubNestsPicker('settings.security')).toBe(true);
    });
  });
});

describe('settings-inventory', () => {
  describe('settings inventory SSOT', () => {
    it('has no duplicate or orphan picker values', () => {
      const values = SETTINGS_OPTIONS.map((option) => option.value);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
      expect(values.length).toBeGreaterThan(30);
    });

    it('lists every entry without harness-only orphan footnotes', () => {
      const host = {
        state: {
          transcriptContainer: { addChild: vi.fn() },
          renderer: { invalidateFrame: vi.fn() },
        },
      } as unknown as SlashCommandHost;

      showSettingsInventory(host);
      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as UsagePanelComponent;
      const text = panel.snapshotBodyLines(1).join('\n');
      expect(text).toContain(`${String(SETTINGS_OPTIONS.length)} entries`);
      expect(text).not.toContain('Harness sub-panel also lists');
      for (const option of SETTINGS_OPTIONS) {
        expect(text).toContain(option.value);
      }
    });
  });
});

describe('settings-no-tip-rows', () => {
  const CONFIG_ROOT = join(import.meta.dirname, '../../../src/tui/commands/config');

  function walkTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) out.push(...walkTsFiles(full));
      else if (name.endsWith('-settings.ts') || name.endsWith('settings.ts')) out.push(full);
    }
    return out;
  }

  describe('settings panes have no tip-only menu rows', () => {
    it('contains zero value: tip-* option declarations under commands/config', () => {
      const files = walkTsFiles(CONFIG_ROOT);
      expect(files.length).toBeGreaterThan(10);
      const hits: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        const re = /value:\s*'tip-[^']+'/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          hits.push(`${file}:${m[0]}`);
        }
      }
      expect(hits).toEqual([]);
    });
  });
});

describe('storage-settings', () => {
  function makeStorageHost(options: {
    home: string;
    configPath: string;
    sessionDir?: string;
    listSessions?: () => Promise<readonly unknown[]>;
  }): SlashCommandHost {
    return {
      harness: {
        homeDir: options.home,
        configPath: options.configPath,
        listSessions: options.listSessions ?? vi.fn(async () => []),
      },
      state: {
        transcriptContainer: { addChild: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        appState: { workDir: '/tmp/ws' },
        renderer: { invalidateFrame: vi.fn() },
      },
      requireSession: vi.fn(() => ({
        workDir: '/tmp/ws',
        summary: {
          sessionDir: options.sessionDir,
          workDir: '/tmp/ws',
        },
      })),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      mountEditorReplacement: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectStorageAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  describe('storage settings tips', () => {
    it('exports home, retention, and logs tips (glance copy, not menu rows)', () => {
      expect(STORAGE_HOME_TIP).toContain('SUPERLIORA_HOME');
      expect(STORAGE_RETENTION_TIP).toContain('wire.jsonl');
      expect(STORAGE_LOGS_TIP).toContain('log-level');
    });
  });

  describe('storage settings', () => {
    it('resolveStoragePaths uses live session dir for journal + tool-results', () => {
      const home = '/tmp/superliora-home';
      const sessionDir = join(home, 'sessions', 'abc123', 'ses_live');
      const paths = resolveStoragePaths({
        homeDir: home,
        configPath: join(home, 'config.toml'),
        sessionDir,
      });
      expect(paths.sessionsDir).toBe(join(home, 'sessions'));
      expect(paths.journalPath).toBe(join(sessionDir, 'agents/main/wire.jsonl'));
      expect(paths.toolResultsDir).toBe(join(sessionDir, 'agents/main/tool-results'));
    });

    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeStorageHost({
        home: '/tmp/home',
        configPath: '/tmp/home/config.toml',
      });
      showStorageSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual(['status', 'gc', 'move']);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });


    it('mounts read-only storage panel with live harness paths', async () => {
      const originalHome = process.env['SUPERLIORA_HOME'];
      const home = await mkdtemp(join(tmpdir(), 'liora-storage-settings-'));
      process.env['SUPERLIORA_HOME'] = home;
      const sessionDir = join(home, 'sessions', 'bucket', 'ses_a');
      const configPath = join(home, 'config.toml');

      const host = makeStorageHost({
        home,
        configPath,
        sessionDir,
        listSessions: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]),
      });

      showStorageSettings(host);
      selectStorageAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const lines = panel.snapshotBodyLines(1).join('\n');
      expect(lines).toContain('── Storage');
      expect(lines).toMatch(/Volume:/);
      expect(lines).toContain(`Home: ${home}`);
      expect(lines).toContain(`Config: ${configPath}`);
      expect(lines).toContain(`Sessions: ${join(home, 'sessions')}/`);
      expect(lines).toContain(`Journal: ${join(sessionDir, 'agents/main/wire.jsonl')}`);
      expect(lines).toContain(`Tool results: ${join(sessionDir, 'agents/main/tool-results')}/`);
      expect(lines).toContain('SUPERLIORA_HOME override');
      expect(lines).toContain('2 session(s)');

      await rm(home, { recursive: true, force: true });
      if (originalHome === undefined) delete process.env['SUPERLIORA_HOME'];
      else process.env['SUPERLIORA_HOME'] = originalHome;
    });
  });
});

describe('telemetry-settings', () => {
  function makeHost(options: {
    telemetry?: boolean;
    setConfig?: ReturnType<typeof vi.fn>;
  } = {}) {
    return {
      state: {
        theme: currentTheme,
        transcriptContainer: { addChild: vi.fn() },
        ui: { requestRender: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        appState: {},
      },
      harness: {
        homeDir: '/home/.superliora',
        configPath: '/home/.superliora/config.toml',
        getConfig: vi.fn(async () => ({ telemetry: options.telemetry ?? false })),
        setConfig: options.setConfig ?? vi.fn(async () => ({ telemetry: true })),
      },
      showStatus: vi.fn(),
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      mountEditorReplacement: vi.fn(),
      restoreEditor: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function pickerFromHost(host: SlashCommandHost): ChoicePickerComponent {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    return picker as ChoicePickerComponent;
  }

  function selectPickerOption(host: SlashCommandHost, value: string): void {
    const picker = pickerFromHost(host);
    (picker as unknown as { opts: { onSelect: (v: string) => void } }).opts.onSelect(value);
  }

  describe('telemetry-settings', () => {
    it('mounts ChoicePicker with status and toggles (no tip rows)', () => {
      const host = makeHost();
      showTelemetrySettings(host);
      expect(host.mountCenterModal).toHaveBeenCalledOnce();
      const picker = pickerFromHost(host);
      const labels = (picker as unknown as { opts: { options: { label: string }[] } }).opts.options.map(
        (option) => option.label,
      );
      expect(labels).toContain('Telemetry status');
      expect(labels).toContain('Telemetry ON (opt-in)');
      expect(labels).toContain('Telemetry OFF (ZDR default)');
    });

    it('renders status panel from harness config + live glance', async () => {
      const host = makeHost({ telemetry: false });
      showTelemetrySettings(host);
      selectPickerOption(host, 'status');
      await vi.waitFor(() =>
        expect((host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock.calls.length)
          .toBeGreaterThan(0),
      );

      const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as UsagePanelComponent;
      const body = panel.snapshotBodyLines(0).join('\n');
      expect(body).toContain('Telemetry');
      expect(body).toContain('Config opt-in:');
      expect(body).toContain('Live sink:');
      expect(body).toContain('Local-only posture');
      expect(body).toContain('config.toml');
      expect(body).toContain('SUPERLIORA_TELEMETRY');
    });

    it('writes telemetry ON via setConfig', async () => {
      const setConfig = vi.fn(async () => ({ telemetry: true }));
      const host = makeHost({ setConfig });
      showTelemetrySettings(host);
      selectPickerOption(host, 'on');
      await vi.waitFor(() => expect(setConfig).toHaveBeenCalledWith({ telemetry: true }));
      expect(host.showStatus).toHaveBeenCalledWith(
        expect.stringContaining('Telemetry ON'),
        'success',
      );
    });

    it('writes telemetry OFF via setConfig', async () => {
      const setConfig = vi.fn(async () => ({ telemetry: false }));
      const host = makeHost({ setConfig });
      showTelemetrySettings(host);
      selectPickerOption(host, 'off');
      await vi.waitFor(() => expect(setConfig).toHaveBeenCalledWith({ telemetry: false }));
      expect(host.showStatus).toHaveBeenCalledWith(
        expect.stringContaining('Telemetry OFF'),
        'warning',
      );
    });

  });
});

describe('usage-settings', () => {
  function makeUsageHost(options: {
    sessionCostUsd?: number;
    contextUsage?: number;
    contextTokens?: number;
    maxContextTokens?: number;
    getStatus?: () => Promise<{
      usage: {
        total: {
          inputOther: number;
          inputCacheRead: number;
          inputCacheCreation: number;
          output: number;
        };
      };
      cacheHitRate: number;
      contextUsage: number;
      contextTokens: number;
      maxContextTokens: number;
    }>;
    requireSessionError?: Error;
  } = {}) {
    const requireSessionError = options.requireSessionError;
    const requireSession =
      requireSessionError !== undefined
        ? vi.fn(() => {
            throw requireSessionError;
          })
        : vi.fn(() => ({
            getStatus:
              options.getStatus ??
              (async () => ({
                usage: {
                  total: {
                    inputOther: 5_000,
                    inputCacheRead: 0,
                    inputCacheCreation: 0,
                    output: 200,
                  },
                },
                cacheHitRate: 0.95,
                contextUsage: 0.25,
                contextTokens: 32_000,
                maxContextTokens: 128_000,
              })),
          }));

    return {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        centerModalStack: [] as readonly unknown[],
        appState: {
          sessionCostUsd: options.sessionCostUsd ?? 0.42,
          contextUsage: options.contextUsage ?? 0.1,
          contextTokens: options.contextTokens ?? 1_000,
          maxContextTokens: options.maxContextTokens ?? 128_000,
        },
        renderer: { invalidateFrame: vi.fn() },
      },
      requireSession,
      mountCenterModal: vi.fn(),
      closeCenterModal: vi.fn(),
      restoreEditor: vi.fn(),
      showStatus: vi.fn(),
    } as unknown as SlashCommandHost;
  }

  function selectUsageAction(host: SlashCommandHost, value: string): void {
    const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ChoicePickerComponent
      | undefined;
    expect(picker).toBeDefined();
    (picker as unknown as { opts: { onSelect: (action: string) => void } }).opts.onSelect(value);
  }

  function panelText(host: SlashCommandHost): string {
    const panel = (host.state.transcriptContainer.addChild as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as UsagePanelComponent;
    return panel.snapshotBodyLines(1).join('\n');
  }

  describe('usage settings tips', () => {
    it('exports token, quota, and context tips (glance copy, not menu rows)', () => {
      expect(USAGE_TOKEN_TIP).toContain('getStatus().usage');
      expect(USAGE_TOKEN_TIP).toContain('best-effort');
      expect(USAGE_QUOTA_TIP).toContain('/usage');
      expect(USAGE_QUOTA_TIP).toContain('Settings → Accounts');
      expect(USAGE_CONTEXT_TIP).toContain('contextUsage');
      expect(USAGE_CONTEXT_TIP).toContain('/status');
    });
  });

  describe('showUsageSettings', () => {
    it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
      const host = makeUsageHost();
      showUsageSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      const options = (picker as unknown as { opts: { options: readonly { value: string }[] } }).opts
        .options;
      expect(options.map((o) => o.value)).toEqual([
        'status',
        'quota',
      ]);
      expect(options.every((o) => !o.value.startsWith('tip-'))).toBe(true);
    });

    it('inherits PREMIUM list chrome instead of a stub ↑↓ · Enter · Esc hint', () => {
      const host = makeUsageHost();
      showUsageSettings(host);
      const picker = (host.mountCenterModal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        | ChoicePickerComponent
        | undefined;
      expect(picker).toBeDefined();
      expectPremiumPickerChrome(picker!);
    });

    it('wires live token/$ from session.getStatus', async () => {
      const host = makeUsageHost({ sessionCostUsd: 0.42 });
      showUsageSettings(host);
      selectUsageAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const text = panelText(host);
      expect(text).toContain('Session: live getStatus');
      expect(text).toContain('in 5.0K');
      expect(text).toContain('$0.420');
    });

    it('falls back when getStatus is unavailable', async () => {
      const host = makeUsageHost({
        sessionCostUsd: undefined,
        requireSessionError: new Error('no session'),
      });
      showUsageSettings(host);
      selectUsageAction(host, 'status');
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      expect(panelText(host)).toContain('no session');
    });
  });
});
