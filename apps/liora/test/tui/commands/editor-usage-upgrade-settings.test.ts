import { describe, expect, it, vi } from 'vitest';

import { showEditorSettings } from '#/tui/commands/config/editor/editor-settings';
import { showUpgradeSettings } from '#/tui/commands/config/upgrade/upgrade-settings';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';
import {
  buildEditorSettingsLines,
  formatExternalEditorLine,
  formatInputModeLine,
  loadEditorGlance,
} from '#/tui/utils/editor/editor-glance';
import {
  buildUsageSettingsLines,
  loadUsageSettingsGlance,
} from '#/tui/utils/usage/usage-settings-glance';
import {
  AUTO_UPDATE_DISABLE_ENV,
  buildUpgradeSettingsLines,
  formatEffectiveAutoUpdateLine,
  isAutoUpdateDisabledByEnv,
  loadUpgradeGlance,
} from '#/tui/utils/upgrade/upgrade-glance';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';

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
  it('mounts live inputMode and editor from appState', () => {
    const host = {
      state: {
        appState: {
          inputMode: 'bash' as const,
          editorCommand: 'nvim',
        },
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as unknown as SlashCommandHost;

    showEditorSettings(host);
    const text = panelText(host);
    expect(text).toContain('TUI input: bash');
    expect(text).toContain('External editor: nvim · resolved nvim');
    expect(text).toContain('Ctrl+G');
  });
});

describe('upgrade settings panel', () => {
  it('mounts live auto-update config and env status', () => {
    const host = {
      state: {
        appState: {
          version: '2.0.0',
          upgrade: { autoInstall: true },
          updateNotice: null,
        },
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as unknown as SlashCommandHost;

    showUpgradeSettings(host);
    const text = panelText(host);
    expect(text).toContain('Running version: 2.0.0');
    expect(text).toContain('auto_install: ON');
    expect(text).toContain('/upgrade');
  });
});
