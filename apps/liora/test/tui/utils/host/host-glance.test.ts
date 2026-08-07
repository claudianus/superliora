import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLioraHarness, SDKRpcClient } from '@superliora/sdk';
import { describe, expect, it } from 'vitest';

import {
  appendHostTtftMsSample,
  buildHostSettingsLines,
  computeHostTtftP50Ms,
  formatHostTtftLine,
  formatHostTtftP50Line,
  formatHostSovereignUmbrellaStatusLine,
  HOST_SOVEREIGN_UMBRELLA_TIP,
  HOST_TTFT_WINDOW_MAX,
  isInProcessHarness,
  isSovereignUmbrellaEnabled,
  loadHostGlance,
  readLocalServerDaemon,
  resolveHostServerUrlFromEnv,
} from '#/tui/utils/host/host-glance';
import { buildHostSessionLiveLines } from '#/tui/utils/host/sovereign-umbrella-glance';

describe('host-glance', () => {
  it('resolveHostServerUrlFromEnv prefers SUPERLIORA_SERVER_URL over legacy', () => {
    expect(
      resolveHostServerUrlFromEnv({
        SUPERLIORA_SERVER_URL: 'http://superliora.test:1',
        KIMI_SERVER_URL: 'http://kimi.test:2',
      }),
    ).toEqual({ url: 'http://superliora.test:1', source: 'SUPERLIORA_SERVER_URL' });
  });

  it('resolveHostServerUrlFromEnv returns undefined when unset', () => {
    expect(resolveHostServerUrlFromEnv({})).toBeUndefined();
  });

  it('isInProcessHarness is true for createLioraHarness default', () => {
    const harness = createLioraHarness({ homeDir: '/tmp/host-glance-home' });
    expect(isInProcessHarness(harness)).toBe(true);
    expect((harness as unknown as { rpc?: unknown }).rpc).toBeInstanceOf(SDKRpcClient);
  });

  it('loadHostGlance reports in-process runtime with session + config paths', () => {
    const harness = createLioraHarness({
      homeDir: '/tmp/host-glance-home',
      configPath: '/tmp/host-glance-home/config.toml',
    });
    const glance = loadHostGlance({
      harness,
      sessionId: 'ses_test',
      workDir: '/tmp/ws',
      env: {},
    });
    expect(glance.runtimeMode).toBe('in-process');
    expect(glance.sessionLine).toContain('ses_test');
    expect(glance.sessionLine).toContain('/tmp/ws');
    expect(glance.configPath).toBe('/tmp/host-glance-home/config.toml');
    expect(glance.transportLine).toContain('in-process RPC');
  });

  it('loadHostGlance surfaces configured server URL without switching runtime mode', () => {
    const harness = createLioraHarness({ homeDir: '/tmp/host-glance-home' });
    const glance = loadHostGlance({
      harness,
      env: { SUPERLIORA_SERVER_URL: 'http://127.0.0.1:58627' },
    });
    expect(glance.runtimeMode).toBe('in-process');
    expect(glance.configuredServerUrl).toBe('http://127.0.0.1:58627');
    expect(glance.transportLine).toContain('SUPERLIORA_SERVER_URL=http://127.0.0.1:58627');
    expect(glance.transportLine).toContain('not active');
  });

  it('buildHostSettingsLines includes runtime status not tip-only', () => {
    const lines = buildHostSettingsLines({
      runtimeMode: 'in-process',
      transportLine: 'Transport: SDK in-process RPC · ui_mode=shell',
      sessionLine: 'Session: ses_x · /tmp/ws',
      configPath: '/tmp/config.toml',
      homeDir: '/tmp/home',
      uiMode: 'shell',
    }).join('\n');
    expect(lines).toContain('Mode: in-process');
    expect(lines).toContain('Session: ses_x');
    expect(lines).toContain('Config: /tmp/config.toml');
    expect(lines).toContain('Local server daemon: not running');
    expect(lines).toContain('TTFT p50: complete a turn to capture live samples');
    expect(lines).toContain('Rolling window up to 20 steps');
  });

  it('formatHostTtftLine renders last-step sample for Host status', () => {
    expect(formatHostTtftLine({ ms: 250, turnId: 2, step: 1 }, 'in-process')).toBe(
      'Last TTFT: 250ms (turn 2 step 1) · in-process path',
    );
    expect(formatHostTtftLine({ ms: 1500 }, 'server')).toBe('Last TTFT: 1.5s · server client path');
  });

  it('formatHostTtftLine includes api+client split when stream timing is present', () => {
    expect(
      formatHostTtftLine(
        {
          ms: 420,
          turnId: 2,
          step: 1,
          requestBuildMs: 40,
          serverFirstTokenMs: 380,
        },
        'in-process',
      ),
    ).toBe(
      'Last TTFT: 420ms (api 380ms + client 40ms) (turn 2 step 1) · in-process path',
    );
  });

  it('buildHostSettingsLines surfaces live TTFT sample and hides future stub', () => {
    const lines = buildHostSettingsLines({
      runtimeMode: 'in-process',
      transportLine: 'Transport: SDK in-process RPC · ui_mode=shell',
      configPath: '/tmp/config.toml',
      homeDir: '/tmp/home',
      uiMode: 'shell',
      lastStepTtft: { ms: 320, turnId: 1, step: 0 },
    }).join('\n');
    expect(lines).toContain('Last TTFT: 320ms (turn 1 step 0) · in-process path');
    expect(lines).not.toContain('TTFT p50 in-process vs server path');
  });

  it('buildHostSettingsLines shows TTFT split when sample includes build/server parts', () => {
    const lines = buildHostSettingsLines({
      runtimeMode: 'in-process',
      transportLine: 'Transport: SDK in-process RPC · ui_mode=shell',
      configPath: '/tmp/config.toml',
      homeDir: '/tmp/home',
      uiMode: 'shell',
      lastStepTtft: {
        ms: 500,
        turnId: 3,
        step: 0,
        requestBuildMs: 50,
        serverFirstTokenMs: 450,
      },
    }).join('\n');
    expect(lines).toContain('Last TTFT: 500ms (api 450ms + client 50ms) (turn 3 step 0)');
  });

  it('appendHostTtftMsSample caps at HOST_TTFT_WINDOW_MAX and drops oldest', () => {
    let window: number[] = [];
    for (let i = 0; i < HOST_TTFT_WINDOW_MAX + 3; i += 1) {
      window = appendHostTtftMsSample(window, i * 10);
    }
    expect(window).toHaveLength(HOST_TTFT_WINDOW_MAX);
    expect(window[0]).toBe(30);
    expect(window.at(-1)).toBe((HOST_TTFT_WINDOW_MAX + 2) * 10);
  });

  it('computeHostTtftP50Ms returns median for odd and even windows', () => {
    expect(computeHostTtftP50Ms([])).toBeUndefined();
    expect(computeHostTtftP50Ms([100])).toBe(100);
    expect(computeHostTtftP50Ms([100, 200, 300])).toBe(200);
    expect(computeHostTtftP50Ms([100, 200, 300, 400])).toBe(250);
  });

  it('formatHostTtftP50Line renders n and path', () => {
    expect(formatHostTtftP50Line([100, 200, 300], 'in-process')).toBe(
      `TTFT p50: 200ms (n=3, window≤${String(HOST_TTFT_WINDOW_MAX)}) · in-process path`,
    );
  });

  it('buildHostSettingsLines surfaces TTFT p50 from rolling window', () => {
    const lines = buildHostSettingsLines({
      runtimeMode: 'in-process',
      transportLine: 'Transport: SDK in-process RPC · ui_mode=shell',
      configPath: '/tmp/config.toml',
      homeDir: '/tmp/home',
      uiMode: 'shell',
      lastStepTtft: { ms: 300, turnId: 2, step: 1 },
      lastStepTtftMsWindow: [100, 200, 300],
    }).join('\n');
    expect(lines).toContain('Last TTFT: 300ms (turn 2 step 1)');
    expect(lines).toContain(
      `TTFT p50: 200ms (n=3, window≤${String(HOST_TTFT_WINDOW_MAX)}) · in-process path`,
    );
    expect(lines).not.toContain('complete a turn to capture live samples');
  });

  it('loadHostGlance forwards lastStepTtft when provided', () => {
    const harness = createLioraHarness({ homeDir: '/tmp/host-glance-home' });
    const glance = loadHostGlance({
      harness,
      lastStepTtft: { ms: 90, turnId: 3, step: 2 },
    });
    expect(glance.lastStepTtft).toEqual({ ms: 90, turnId: 3, step: 2 });
  });

  it('readLocalServerDaemon reads live lock when pid matches', async () => {
    const home = await mkdtemp(join(tmpdir(), 'liora-host-lock-'));
    await mkdir(join(home, 'server'), { recursive: true });
    await writeFile(
      join(home, 'server', 'lock'),
      JSON.stringify({ pid: process.pid, port: 58627, host: '127.0.0.1' }),
      'utf8',
    );
    expect(readLocalServerDaemon(home)).toEqual({
      origin: 'http://127.0.0.1:58627',
      port: 58627,
      pid: process.pid,
    });
    await rm(home, { recursive: true, force: true });
  });

  it('HOST_SOVEREIGN_UMBRELLA_TIP documents all umbrella soft gates', () => {
    expect(HOST_SOVEREIGN_UMBRELLA_TIP).toContain('SUPERLIORA_SOVEREIGN=1');
    expect(HOST_SOVEREIGN_UMBRELLA_TIP).toContain('core profile');
    expect(HOST_SOVEREIGN_UMBRELLA_TIP).toContain('Legacy compat aliases hide by product default');
    expect(HOST_SOVEREIGN_UMBRELLA_TIP).toContain('codemap');
  });

  it('isSovereignUmbrellaEnabled detects SUPERLIORA_SOVEREIGN=1', () => {
    expect(isSovereignUmbrellaEnabled({})).toBe(false);
    expect(isSovereignUmbrellaEnabled({ SUPERLIORA_SOVEREIGN: '1' })).toBe(true);
    expect(isSovereignUmbrellaEnabled({ SUPERLIORA_SOVEREIGN: 'true' })).toBe(true);
    expect(formatHostSovereignUmbrellaStatusLine({ SUPERLIORA_SOVEREIGN: '1' })).toContain(
      'Sovereign umbrella: ON',
    );
    expect(formatHostSovereignUmbrellaStatusLine({})).toBeUndefined();
  });

  it('buildHostSettingsLines surfaces umbrella tip and live Session gate checklist when active', () => {
    const base = {
      runtimeMode: 'in-process' as const,
      transportLine: 'Transport: SDK in-process RPC · ui_mode=shell',
      configPath: '/tmp/config.toml',
      homeDir: '/tmp/home',
      uiMode: 'shell',
    };
    const idle = buildHostSettingsLines(base).join('\n');
    expect(idle).toContain(HOST_SOVEREIGN_UMBRELLA_TIP);
    expect(idle).not.toContain('Sovereign umbrella: ON');
    expect(idle).not.toContain('── Session (live) ─');

    const sessionLive = buildHostSessionLiveLines({ env: { SUPERLIORA_SOVEREIGN: '1' } });
    const active = buildHostSettingsLines({
      ...base,
      sovereignUmbrellaActive: true,
      sessionLiveLines: sessionLive,
    }).join('\n');
    expect(active).toContain('── Session (live) ─');
    expect(active).toContain('Sovereign umbrella: ON');
    expect(active).toContain('· core profile: ON');
    expect(active).toContain('· hide-legacy: ON');
    expect(active).toContain('· codemap warm: ON');
    const statusIdx = active.indexOf('── Status ─');
    const liveIdx = active.indexOf('── Session (live) ─');
    expect(liveIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeGreaterThan(liveIdx);
  });

  it('loadHostGlance forwards sovereignUmbrellaActive from env', () => {
    const harness = createLioraHarness({ homeDir: '/tmp/host-glance-home' });
    const glance = loadHostGlance({
      harness,
      env: { SUPERLIORA_SOVEREIGN: '1' },
    });
    expect(glance.sovereignUmbrellaActive).toBe(true);
  });
});
