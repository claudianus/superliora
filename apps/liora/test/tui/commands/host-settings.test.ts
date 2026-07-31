import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLioraHarness } from '@superliora/sdk';
import { describe, expect, it, vi } from 'vitest';

import { showHostSettings } from '#/tui/commands/config/host-settings';

function makeHostHost(options: {
  hasSession?: boolean;
  serverUrl?: string;
  harness?: ReturnType<typeof createLioraHarness>;
  lastStepTtft?: { ms: number; turnId?: number; step?: number; atMs: number } | null;
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
      appState: {
        workDir: '/tmp/superliora',
        lastStepTtft: options.lastStepTtft ?? null,
      },
      renderer: { invalidateFrame: vi.fn() },
    },
    harness,
    requireSession,
  } as never;
}

describe('host settings', () => {
  it('mounts read-only host panel for in-process default', async () => {
    const prior = process.env.SUPERLIORA_SERVER_URL;
    delete process.env.SUPERLIORA_SERVER_URL;
    const host = makeHostHost();
    showHostSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const lines = panel.buildLines(1).join('\n');
    expect(lines).toContain('Mode: in-process');
    expect(lines).toContain('Transport: SDK in-process RPC');
    expect(lines).toContain('Session: ses_host_panel');
    expect(lines).toContain('Config: /tmp/superliora-home/config.toml');
    expect(lines).toContain('Client env: SUPERLIORA_SERVER_URL unset');
    expect(lines).toContain('TTFT p50 in-process vs server path');
    expect(lines).toContain('complete a turn to capture a live sample');
    if (prior != null) process.env.SUPERLIORA_SERVER_URL = prior;
  });

  it('surfaces live TTFT sample from appState when a step completed with timing', async () => {
    const host = makeHostHost({
      lastStepTtft: { ms: 180, turnId: 4, step: 1, atMs: Date.now() },
    });
    showHostSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const lines = panel.buildLines(1).join('\n');
    expect(lines).toContain('Last TTFT: 180ms (turn 4 step 1) · in-process path');
    expect(lines).not.toContain('TTFT p50 in-process vs server path');
  });

  it('reports configured server URL while runtime stays in-process', async () => {
    const prior = process.env.SUPERLIORA_SERVER_URL;
    process.env.SUPERLIORA_SERVER_URL = 'http://127.0.0.1:58627';
    const home = await mkdtemp(join(tmpdir(), 'liora-host-settings-'));
    const host = makeHostHost({
      harness: createLioraHarness({
        homeDir: home,
        configPath: join(home, 'config.toml'),
      }),
    });
    showHostSettings(host);
    await vi.waitFor(() => {
      expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
    });
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };
    const lines = panel.buildLines(1).join('\n');
    expect(lines).toContain('Mode: in-process');
    expect(lines).toContain('http://127.0.0.1:58627');
    expect(lines).toContain('not active');
    expect(lines).toContain('Client env: SUPERLIORA_SERVER_URL=http://127.0.0.1:58627');
    await rm(home, { recursive: true, force: true });
    if (prior != null) {
      process.env.SUPERLIORA_SERVER_URL = prior;
    } else {
      delete process.env.SUPERLIORA_SERVER_URL;
    }
  });

  it('documents sovereign umbrella soft gates and live status when env is set', async () => {
    const prev = process.env.SUPERLIORA_SOVEREIGN;
    process.env.SUPERLIORA_SOVEREIGN = '1';
    try {
      const host = makeHostHost();
      showHostSettings(host);
      await vi.waitFor(() => {
        expect(host.state.transcriptContainer.addChild).toHaveBeenCalled();
      });
      const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
        buildLines: (n: number) => string[];
      };
      const lines = panel.buildLines(1).join('\n');
      expect(lines).toContain('SUPERLIORA_SOVEREIGN=1');
      expect(lines).toContain('core profile');
      expect(lines).toContain('hide legacy');
      expect(lines).toContain('dual-emit');
      expect(lines).toContain('── Session (live) ─');
      expect(lines).toContain('Sovereign umbrella: ON');
      expect(lines).toContain('· core profile: ON');
      expect(lines).toContain('· hide-legacy: ON');
      expect(lines).toContain('· codemap warm: ON');
      expect(lines).toContain('· mission dual-emit: ON');
      expect(lines).toContain('· fleet dual-emit: ON');
    } finally {
      if (prev === undefined) delete process.env.SUPERLIORA_SOVEREIGN;
      else process.env.SUPERLIORA_SOVEREIGN = prev;
    }
  });
});
