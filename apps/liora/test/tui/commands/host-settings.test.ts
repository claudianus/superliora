import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLioraHarness } from '@superliora/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  HOST_FUTURE_TIP,
  HOST_SOVEREIGN_UMBRELLA_TIP,
  HOST_TTFT_TIP,
  showHostSettings,
} from '#/tui/commands/config/host/host-settings';
import type { ChoicePickerComponent } from '#/tui/components/dialogs/picker/choice-picker';
import type { SlashCommandHost } from '#/tui/commands/hub/dispatch';
import { UsagePanelComponent } from '#/tui/components/messages/usage-panel/index';

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
