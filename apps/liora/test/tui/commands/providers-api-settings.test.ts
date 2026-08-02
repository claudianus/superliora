import { describe, expect, it, vi } from 'vitest';

import {
  PROVIDERS_API_KEY_ENVS_TIP,
  PROVIDERS_LOGIN_TIP,
  SEARCH_PREFER_XAI_TIP,
  showProvidersApiSettings,
} from '#/tui/commands/config/providers/providers-api-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

function makeProvidersHost(options?: {
  readonly session?: {
    getStatus: () => Promise<{ model?: string; providerRouteStatus?: unknown }>;
    getTools?: () => Promise<Array<{ name: string; active: boolean }>>;
  };
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
  it('mounts ChoicePicker with status and read-only tip actions — tip-free', () => {
    const host = makeProvidersHost();
    showProvidersApiSettings(host);
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

  it('mounts read-only providers panel when status is selected', async () => {
    const host = makeProvidersHost();
    showProvidersApiSettings(host);
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
