/**
 * Covers: Ch5 research bridge status + soft native-messaging handshake.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CHROME_EXT_BRIDGE_ENV,
  CHROME_RESEARCH_BRIDGE_ENV,
  NATIVE_HOST_ID,
  NATIVE_HOST_SMOKE_CACHE_TTL_MS,
  NATIVE_HOST_SMOKE_SKIP_ENV,
  buildResearchBridgeStatus,
  clearResearchBridgeSmokeCache,
  formatResearchBridgeHandshakeLine,
  isResearchBridgeEnabled,
  probeNativeHostSmoke,
  researchBridgeCh5Tip,
  resolveNativeHostManifestPath,
  resolveResearchBridgeUrl,
} from '../../../src/tools/providers/research-bridge-status';

describe('research-bridge-status', () => {
  const savedManifest = process.env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST'];

  afterEach(() => {
    clearResearchBridgeSmokeCache();
    if (savedManifest === undefined) {
      delete process.env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST'];
    } else {
      process.env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST'] = savedManifest;
    }
  });

  it('is disabled by default', () => {
    expect(isResearchBridgeEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(buildResearchBridgeStatus({ env: {} as NodeJS.ProcessEnv }).enabled).toBe(false);
    expect(buildResearchBridgeStatus({ env: {} as NodeJS.ProcessEnv }).nativeHost.handshake).toBe(
      'off',
    );
  });

  it('enables on primary env gate', () => {
    const env = { [CHROME_RESEARCH_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv;
    expect(isResearchBridgeEnabled(env)).toBe(true);
    const status = buildResearchBridgeStatus({ env });
    expect(status.enabled).toBe(true);
    expect(status.ready).toBe(true);
    expect(status.nativeHost.handshake).toBe('env-gated');
  });

  it('accepts legacy env alias', () => {
    const env = { [CHROME_EXT_BRIDGE_ENV]: '1' } as NodeJS.ProcessEnv;
    expect(isResearchBridgeEnabled(env)).toBe(true);
  });

  it('detects manifest-present when override manifest exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-bridge-'));
    const manifestPath = join(dir, `${NATIVE_HOST_ID}.json`);
    writeFileSync(manifestPath, '{}', 'utf8');
    process.env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST'] = manifestPath;

    const agentCoreRoot = mkdtempSync(join(tmpdir(), 'sl-agent-core-empty-'));

    const env = {
      [CHROME_RESEARCH_BRIDGE_ENV]: '1',
      SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: manifestPath,
    } as NodeJS.ProcessEnv;
    const status = buildResearchBridgeStatus({ env, agentCoreRoot, probeSmoke: false });
    expect(status.nativeHost.handshake).toBe('manifest-present');
    expect(status.nativeHost.manifestPath).toBe(manifestPath);
  });

  it('detects host-script-ready when manifest + stub script exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-bridge-'));
    const manifestPath = join(dir, `${NATIVE_HOST_ID}.json`);
    writeFileSync(manifestPath, '{}', 'utf8');
    process.env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST'] = manifestPath;

    const agentCoreRoot = mkdtempSync(join(tmpdir(), 'sl-agent-core-'));
    mkdirSync(join(agentCoreRoot, 'scripts'), { recursive: true });
    writeFileSync(join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs'), '// stub', 'utf8');

    const env = {
      [CHROME_RESEARCH_BRIDGE_ENV]: '1',
      SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: manifestPath,
    } as NodeJS.ProcessEnv;
    const status = buildResearchBridgeStatus({ env, agentCoreRoot, probeSmoke: false });
    expect(status.nativeHost.handshake).toBe('host-script-ready');
  });

  it('promotes to smoke-verified when mocked smoke succeeds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-bridge-'));
    const manifestPath = join(dir, `${NATIVE_HOST_ID}.json`);
    writeFileSync(manifestPath, '{}', 'utf8');
    process.env['SUPERLIORA_RESEARCH_BRIDGE_MANIFEST'] = manifestPath;

    const agentCoreRoot = mkdtempSync(join(tmpdir(), 'sl-agent-core-'));
    const scriptPath = join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs');
    mkdirSync(join(agentCoreRoot, 'scripts'), { recursive: true });
    writeFileSync(scriptPath, '// stub', 'utf8');

    const env = {
      [CHROME_RESEARCH_BRIDGE_ENV]: '1',
      SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: manifestPath,
    } as NodeJS.ProcessEnv;

    let spawnCalls = 0;
    const status = buildResearchBridgeStatus({
      env,
      agentCoreRoot,
      smokeDeps: {
        now: () => 1_000,
        spawnSync: () => {
          spawnCalls += 1;
          return {
            status: 0,
            stdout: 'research-bridge-native-host smoke ok (0.1.0-stub)\n',
            stderr: '',
            pid: 1,
            output: [
              null,
              'research-bridge-native-host smoke ok (0.1.0-stub)\n',
              '',
            ],
            signal: null,
            error: undefined,
          };
        },
      },
    });

    expect(spawnCalls).toBe(1);
    expect(status.nativeHost.handshake).toBe('smoke-verified');
    expect(status.nativeHost.smoke?.ok).toBe(true);
    expect(status.nativeHost.smoke?.version).toBe('0.1.0-stub');
    expect(formatResearchBridgeHandshakeLine(status.nativeHost)).toContain('smoke verified');
  });

  it('caches smoke probe within TTL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-bridge-'));
    const manifestPath = join(dir, `${NATIVE_HOST_ID}.json`);
    writeFileSync(manifestPath, '{}', 'utf8');

    const agentCoreRoot = mkdtempSync(join(tmpdir(), 'sl-agent-core-'));
    mkdirSync(join(agentCoreRoot, 'scripts'), { recursive: true });
    writeFileSync(join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs'), '// stub', 'utf8');

    const env = {
      [CHROME_RESEARCH_BRIDGE_ENV]: '1',
      SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: manifestPath,
    } as NodeJS.ProcessEnv;

    let now = 5_000;
    let spawnCalls = 0;
    const smokeDeps = {
      now: () => now,
      spawnSync: () => {
        spawnCalls += 1;
        return {
          status: 0,
          stdout: 'research-bridge-native-host smoke ok (cached)\n',
          stderr: '',
          pid: 1,
          output: [null, 'research-bridge-native-host smoke ok (cached)\n', ''],
          signal: null,
          error: undefined,
        };
      },
    };

    buildResearchBridgeStatus({ env, agentCoreRoot, smokeDeps });
    now += NATIVE_HOST_SMOKE_CACHE_TTL_MS - 1;
    buildResearchBridgeStatus({ env, agentCoreRoot, smokeDeps });
    expect(spawnCalls).toBe(1);

    now += 2;
    buildResearchBridgeStatus({ env, agentCoreRoot, smokeDeps });
    expect(spawnCalls).toBe(2);
  });

  it('keeps host-script-ready when mocked smoke fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-bridge-'));
    const manifestPath = join(dir, `${NATIVE_HOST_ID}.json`);
    writeFileSync(manifestPath, '{}', 'utf8');

    const agentCoreRoot = mkdtempSync(join(tmpdir(), 'sl-agent-core-'));
    mkdirSync(join(agentCoreRoot, 'scripts'), { recursive: true });
    writeFileSync(join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs'), '// stub', 'utf8');

    const env = {
      [CHROME_RESEARCH_BRIDGE_ENV]: '1',
      SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: manifestPath,
    } as NodeJS.ProcessEnv;

    const status = buildResearchBridgeStatus({
      env,
      agentCoreRoot,
      smokeDeps: {
        spawnSync: () => ({
          status: 1,
          stdout: '',
          stderr: 'handshake failed',
          pid: 1,
          output: [null, '', 'handshake failed'],
          signal: null,
          error: undefined,
        }),
      },
    });

    expect(status.nativeHost.handshake).toBe('host-script-ready');
    expect(status.nativeHost.smoke?.ok).toBe(false);
    expect(status.hint).toContain('smoke failed');
  });

  it('skips smoke when SUPERLIORA_RESEARCH_BRIDGE_SKIP_SMOKE=1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sl-bridge-'));
    const manifestPath = join(dir, `${NATIVE_HOST_ID}.json`);
    writeFileSync(manifestPath, '{}', 'utf8');

    const agentCoreRoot = mkdtempSync(join(tmpdir(), 'sl-agent-core-'));
    mkdirSync(join(agentCoreRoot, 'scripts'), { recursive: true });
    writeFileSync(join(agentCoreRoot, 'scripts/research-bridge-native-host.mjs'), '// stub', 'utf8');

    const env = {
      [CHROME_RESEARCH_BRIDGE_ENV]: '1',
      [NATIVE_HOST_SMOKE_SKIP_ENV]: '1',
      SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: manifestPath,
    } as NodeJS.ProcessEnv;

    let spawnCalls = 0;
    const status = buildResearchBridgeStatus({
      env,
      agentCoreRoot,
      smokeDeps: {
        spawnSync: () => {
          spawnCalls += 1;
          return { status: 0, stdout: '', stderr: '', pid: 1, output: [null, '', ''], signal: null };
        },
      },
    });

    expect(spawnCalls).toBe(0);
    expect(status.nativeHost.handshake).toBe('host-script-ready');
    expect(status.nativeHost.smoke).toBeUndefined();
  });

  it('probeNativeHostSmoke rejects empty stdout even on exit 0', () => {
    const probe = probeNativeHostSmoke('/tmp/host.mjs', {} as NodeJS.ProcessEnv, {
      spawnSync: () => ({
        status: 0,
        stdout: '',
        stderr: '',
        pid: 1,
        output: [null, '', ''],
        signal: null,
      }),
    });
    expect(probe.ok).toBe(false);
  });

  it('formats handshake lines for Settings', () => {
    expect(formatResearchBridgeHandshakeLine({ handshake: 'env-gated' })).toContain('env-gated');
    expect(formatResearchBridgeHandshakeLine({ handshake: 'host-script-ready' })).toContain(
      'ready',
    );
  });

  it('exposes operator tip with primary env name', () => {
    expect(researchBridgeCh5Tip()).toContain(CHROME_RESEARCH_BRIDGE_ENV);
    expect(researchBridgeCh5Tip()).toContain(NATIVE_HOST_ID);
  });

  it('resolves bridge URL override', () => {
    expect(
      resolveResearchBridgeUrl({
        SUPERLIORA_CHROME_EXT_URL: 'http://127.0.0.1:40000/search',
      } as NodeJS.ProcessEnv),
    ).toBe('http://127.0.0.1:40000/search');
  });

  it('uses override manifest env for path resolution', () => {
    expect(
      resolveNativeHostManifestPath({
        SUPERLIORA_RESEARCH_BRIDGE_MANIFEST: '/tmp/custom.json',
      } as NodeJS.ProcessEnv),
    ).toBe('/tmp/custom.json');
  });
});
