import { describe, expect, it } from 'vitest';
import {
  getTelemetryRuntimeGlance,
  initializeTelemetry,
  resetDefaultTelemetryClientForTests,
  shutdownTelemetry,
  TELEMETRY_ENDPOINT,
} from '@superliora/telemetry';

import {
  buildTelemetryConfigPatch,
  buildTelemetrySettingsLines,
  isTelemetryDisabledByEnv,
  loadTelemetryGlance,
} from '#/tui/utils/telemetry/telemetry-glance';

describe('telemetry-glance', () => {
  it('builds harness.setConfig patch for telemetry boolean', () => {
    expect(buildTelemetryConfigPatch(true)).toEqual({ telemetry: true });
    expect(buildTelemetryConfigPatch(false)).toEqual({ telemetry: false });
  });

  it('shows OFF as ZDR-friendly default', () => {
    const lines = buildTelemetrySettingsLines(
      loadTelemetryGlance({
        configEnabled: false,
        configPath: '/home/.superliora/config.toml',
      }),
    );
    expect(lines.join('\n')).toContain('Config opt-in: OFF');
    expect(lines.join('\n')).toContain('Live sink: OFF');
    expect(lines.join('\n')).toContain('ZDR-friendly');
    expect(lines.join('\n')).toContain('Settings → Telemetry ON/OFF');
  });

  it('shows config ON with live sink when runtime is attached', async () => {
    resetDefaultTelemetryClientForTests();
    const homeDir = await import('node:fs/promises').then((fs) =>
      fs.mkdtemp('/tmp/superliora-telemetry-glance-'),
    );
    initializeTelemetry({
      homeDir,
      deviceId: 'dev-test',
      enabled: true,
      appName: 'liora-cli',
      version: '0.0.0-test',
    });

    const glance = loadTelemetryGlance({
      configEnabled: true,
      configPath: '/tmp/config.toml',
    });
    expect(glance.liveEnabled).toBe(true);
    expect(glance.endpoint).toBe(TELEMETRY_ENDPOINT);

    const lines = buildTelemetrySettingsLines(glance);
    expect(lines.join('\n')).toContain('Config opt-in: ON');
    expect(lines.join('\n')).toContain('Live sink: ON');
    expect(lines.join('\n')).toContain(`Endpoint (live): ${TELEMETRY_ENDPOINT}`);
    expect(lines.join('\n')).toContain('/tmp/config.toml');

    await shutdownTelemetry();
    resetDefaultTelemetryClientForTests();
  });

  it('notes env disable override and effective forced OFF', () => {
    const lines = buildTelemetrySettingsLines(
      loadTelemetryGlance({
        configEnabled: true,
        configPath: '/tmp/config.toml',
        env: { KIMI_DISABLE_TELEMETRY: '1' },
      }),
    );
    expect(lines.join('\n')).toContain('KIMI_DISABLE_TELEMETRY=1');
    expect(lines.join('\n')).toContain('Effective: forced OFF');
  });

  it('shows SUPERLIORA_TELEMETRY opt-in marker when set', () => {
    const lines = buildTelemetrySettingsLines(
      loadTelemetryGlance({
        configEnabled: false,
        configPath: '/tmp/config.toml',
        env: { SUPERLIORA_TELEMETRY: '1' },
      }),
    );
    expect(lines.join('\n')).toContain('SUPERLIORA_TELEMETRY set');
  });

  it('detects KIMI_DISABLE_TELEMETRY truthy values', () => {
    expect(isTelemetryDisabledByEnv({ KIMI_DISABLE_TELEMETRY: '1' })).toBe(true);
    expect(isTelemetryDisabledByEnv({ KIMI_DISABLE_TELEMETRY: 'yes' })).toBe(true);
    expect(isTelemetryDisabledByEnv({})).toBe(false);
  });

  it('reports no live sink before initializeTelemetry', () => {
    resetDefaultTelemetryClientForTests();
    expect(getTelemetryRuntimeGlance()).toEqual({ liveEnabled: false });
  });
});
