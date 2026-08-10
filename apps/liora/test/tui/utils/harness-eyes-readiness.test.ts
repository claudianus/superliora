import { describe, expect, it } from 'vitest';

import {
  asideEyeFromSidecarStatus,
  browserEyeFromSetupResult,
  computerEyeFromCuaStatus,
  formatHarnessEyesReadiness,
} from '#/tui/utils/harness-eyes-readiness';

describe('harness-eyes-readiness', () => {
  it('maps browser setup result to OK/MISSING lines', () => {
    const ok = browserEyeFromSetupResult({
      ok: true,
      code: 0,
      stdout: 'primary ready\nsecondary ready',
      stderr: '',
      command: ['info'],
    });
    expect(ok.ok).toBe(true);
    expect(ok.title).toBe('Browser-use');
    expect(ok.detail).toContain('ready');

    const bad = browserEyeFromSetupResult({
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'missing cloak',
      command: ['info'],
      error: 'not installed',
    });
    expect(bad.ok).toBe(false);
    expect(bad.hint).toContain('browser-use install');
  });

  it('maps cua-driver status', () => {
    const installed = computerEyeFromCuaStatus({ installed: true, version: 'cua-driver 1.2.3' });
    expect(installed.ok).toBe(true);
    expect(installed.detail).toContain('1.2.3');

    const missing = computerEyeFromCuaStatus({ installed: false, error: 'ENOENT' });
    expect(missing.ok).toBe(false);
    expect(missing.hint).toContain('computer-use install');
  });

  it('maps optional Aside sidecar without treating it as required', () => {
    const ready = asideEyeFromSidecarStatus({
      cliPath: '/opt/aside',
      mcpRegistered: true,
      mcpEnabled: true,
      mcpCommand: '/opt/aside',
      mcpJsonPath: '/tmp/mcp.json',
      ready: true,
    });
    expect(ready.ok).toBe(true);
    expect(ready.id).toBe('aside-sidecar');

    const missingCli = asideEyeFromSidecarStatus({
      cliPath: undefined,
      mcpRegistered: false,
      mcpEnabled: false,
      mcpCommand: undefined,
      mcpJsonPath: '/tmp/mcp.json',
      ready: false,
    });
    expect(missingCli.ok).toBe(false);
    expect(missingCli.hint).toContain('aside enable');
  });

  it('formats a multi-line readiness report', () => {
    const text = formatHarnessEyesReadiness({
      generatedAt: '2026-07-26T00:00:00.000Z',
      lines: [
        browserEyeFromSetupResult({
          ok: true,
          code: 0,
          stdout: 'ok',
          stderr: '',
          command: [],
        }),
        computerEyeFromCuaStatus({ installed: false, error: 'missing' }),
        asideEyeFromSidecarStatus({
          cliPath: undefined,
          mcpRegistered: false,
          mcpEnabled: false,
          mcpCommand: undefined,
          mcpJsonPath: '/tmp/mcp.json',
          ready: false,
        }),
      ],
    });
    expect(text).toContain('Harness eyes readiness');
    expect(text).toContain('Browser-use: OK');
    expect(text).toContain('Computer-use: MISSING');
    expect(text).toContain('Aside MCP sidecar: MISSING');
    expect(text).toContain('liora browser-use aside enable');
    expect(text).toContain('liora browser-use doctor');
  });
});
