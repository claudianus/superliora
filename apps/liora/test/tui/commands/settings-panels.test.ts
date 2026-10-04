/** Combined settings-panel tests that share a vi.mock boundary (none). Nested describe per former file. */
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  showAppearanceSettings,
  showTranscriptDetailPicker,
} from '#/tui/commands/config/appearance/appearance-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import { currentTheme, lightColors } from '#/tui/theme';
import { invalidatePromptCache, showCacheSettings } from '#/tui/commands/config/cache/cache-settings';


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




import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLioraHarness } from '@superliora/sdk';
import {
  showHostSettings,
} from '#/tui/commands/config/host/host-settings';
import {
  showKeybindingsSettings,
} from '#/tui/commands/config/keybindings/keybindings-settings';


import {
  showNetworkSettings,
} from '#/tui/commands/config/network/network-settings';




import {
  showProvidersApiSettings,
} from '#/tui/commands/config/providers/providers-api-settings';


import {
  showSecuritySettings,
} from '#/tui/commands/config/security/security-settings';
import { filterHubItems } from '#/tui/components/dialogs/command-hub/command-hub-filter';
import { buildDefaultCommandHubItems } from '#/tui/components/dialogs/command-hub/index';
import { commandHubNestsPicker } from '#/tui/components/dialogs/command-hub/command-hub-behavior';
import { commandHubActionToSlash } from '#/tui/utils/command/command-hub-actions';
import { buildSettingsJumpHubItems } from '#/tui/commands/config/settings-hub-jumps';
import { SETTINGS_SEARCH_KEYWORDS } from '#/tui/commands/config/settings-keywords';
import { SETTINGS_OPTIONS } from '#/tui/components/dialogs/picker/settings-selector';

import { readdirSync, readFileSync, statSync } from 'node:fs';
import {
  showStorageSettings,
} from '#/tui/commands/config/storage/storage-settings';
import { resolveStoragePaths } from '#/tui/utils/storage/storage-glance';
import { showTelemetrySettings } from '#/tui/commands/config/telemetry/telemetry-settings';
import {
  showUsageSettings,
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
      expect(glance.contextLine).toMatch(/42\.0%.*84\.0K.*200\.0K/);
    });
    it.each([undefined, 0, -1])('omits unknown context when the maximum is %s', (maxContextTokens) => {
      const glance = loadUsageSettingsGlance({
        contextUsage: 0,
        contextTokens: 0,
        maxContextTokens,
      });
      expect(glance.contextLine).toBeUndefined();
      expect(buildUsageSettingsLines(glance).join('\n')).not.toContain('Context:');
    });

    it('does not replace an unknown live maximum with a stale cached window', () => {
      const glance = loadUsageSettingsGlance({
        status: { contextUsage: 0, contextTokens: 0, maxContextTokens: 0 },
        contextUsage: 0.5,
        contextTokens: 100_000,
        maxContextTokens: 200_000,
      });
      expect(glance.hasLiveSession).toBe(true);
      expect(glance.contextLine).toBeUndefined();
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
      expect(lines).toContain('Agents / Transcript samples');
      expect(lines).toContain('/help');
      expect(lines).toContain(process.platform === 'darwin' ? 'Cmd-C' : 'Ctrl-C');
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




describe('providers-api-settings', () => {
  function makeProvidersHost(options?: {
    readonly session?: {
      getStatus: () => Promise<{ model?: string; providerRouteStatus?: unknown }>;
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
      expect(options.some((option) => option.value === 'xai-route')).toBe(true);
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
      expect(lines).toContain('no active session');
    });

    it('wires live provider/model from session.getStatus', async () => {
      const host = makeProvidersHost({
        session: {
          getStatus: async () => ({
            model: 'kimi-k2',
            providerRouteStatus: { primary: true },
          }),
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
      await vi.waitFor(() => {
        const status = String((host.showStatus as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] ?? '');
        expect(status).toContain('Native Bash requires Docker; no host fallback');
        expect(status).toContain('Host application, plugins, and raw Kaos remain trusted');
        expect(status).not.toContain('Job Object');
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
      expect(lines).toContain('Sandbox profile: workspace');
      expect(lines).toContain('Not an OS sandbox');
      expect(lines).toContain('redactSecretsInText');
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

    it('includes operator aliases for cache, security, and hard limits', () => {
      expect(SETTINGS_SEARCH_KEYWORDS.cache).toContain('freeze');
      expect(SETTINGS_SEARCH_KEYWORDS.security).toContain('redaction');
      expect(SETTINGS_SEARCH_KEYWORDS.limits).toContain('steps');
    });
  });

  describe('buildSettingsJumpHubItems', () => {
    it('includes browse-all and search-only pane jumps', () => {
      const items = buildSettingsJumpHubItems();
      expect(items[0]?.id).toBe('settings.open');
      expect(items.some((item) => item.id === 'settings.cache' && item.searchOnly === true)).toBe(
        true,
      );
      expect(items.some((item) => item.id === 'settings.limits' && item.keywords?.includes('steps'))).toBe(
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
