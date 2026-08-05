import { describe, expect, it, vi } from 'vitest';

import {
  showUsageSettings,
  USAGE_CONTEXT_TIP,
  USAGE_QUOTA_TIP,
  USAGE_TOKEN_TIP,
} from '#/tui/commands/config/upgrade/usage-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

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
